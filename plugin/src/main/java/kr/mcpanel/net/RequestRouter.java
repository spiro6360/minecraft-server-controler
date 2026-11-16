package kr.mcpanel.net;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.mcpanel.WebPanelPlugin;
import kr.mcpanel.service.InventoryService;
import kr.mcpanel.service.PlayerService;
import kr.mcpanel.service.ServerService;
import kr.mcpanel.sync.ConsoleCapture;
import kr.mcpanel.sync.InventoryWatcher;
import kr.mcpanel.util.Json;
import org.bukkit.Bukkit;
import org.java_websocket.WebSocket;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 웹사이트 요청(action)을 알맞은 서비스로 연결한다.
 * Bukkit API 는 메인 스레드에서만 안전하므로 모든 처리를 메인 스레드로 넘겨서 실행한다.
 */
public final class RequestRouter {

    @FunctionalInterface
    private interface Handler {
        JsonElement handle(Session session, JsonObject data) throws Exception;
    }

    private final WebPanelPlugin plugin;
    private final InventoryWatcher watcher;
    private final Map<String, Handler> handlers = new HashMap<>();
    private PanelServer server;

    public RequestRouter(WebPanelPlugin plugin, ServerService serverService, PlayerService playerService,
                         InventoryService inventoryService, InventoryWatcher watcher, ConsoleCapture console) {
        this.plugin = plugin;
        this.watcher = watcher;

        handlers.put("ping", (s, d) -> new JsonObject());

        // ----- 서버
        handlers.put("server.status", (s, d) -> serverService.status());
        handlers.put("server.settings", (s, d) -> serverService.settings());
        handlers.put("server.setting", (s, d) -> {
            serverService.applySetting(Json.str(d, "key"), Json.str(d, "world"), d.get("value"));
            return serverService.settings();
        });
        handlers.put("server.gamerule", (s, d) -> {
            serverService.setGameRule(Json.str(d, "world"), Json.str(d, "rule"), Json.str(d, "value"));
            return serverService.settings();
        });
        handlers.put("server.properties.get", (s, d) -> serverService.readProperties());
        handlers.put("server.properties.set", (s, d) -> {
            serverService.writeProperties(d.getAsJsonObject("values"));
            return serverService.readProperties();
        });
        handlers.put("server.save", (s, d) -> {
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "save-all");
            return new JsonObject();
        });
        handlers.put("server.stop", (s, d) -> {
            Bukkit.getScheduler().runTaskLater(plugin, Bukkit::shutdown, 20L);
            return new JsonObject();
        });

        // ----- 콘솔
        handlers.put("console.history", (s, d) -> console.history());
        handlers.put("console.command", (s, d) -> {
            String cmd = Json.str(d, "command").trim();
            if (cmd.startsWith("/")) cmd = cmd.substring(1);
            if (cmd.isEmpty()) throw new IllegalArgumentException("명령어가 비어 있습니다");
            plugin.getLogger().info("[웹 콘솔] > " + cmd);
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd);
            return new JsonObject();
        });

        // ----- 플레이어
        handlers.put("players.list", (s, d) -> playerService.list());
        handlers.put("player.action", (s, d) -> {
            playerService.action(uuid(d), Json.str(d, "type"), d.get("value"));
            return playerService.list();
        });

        // ----- 인벤토리 / 엔더상자
        handlers.put("registry.items", (s, d) -> inventoryService.registry());
        handlers.put("inv.get", (s, d) -> inventoryService.snapshot(uuid(d), Json.str(d, "type")));
        handlers.put("inv.subscribe", (s, d) -> {
            UUID id = uuid(d);
            JsonObject both = new JsonObject();
            both.add("inventory", inventoryService.snapshot(id, InventoryService.INVENTORY));
            both.add("ender", inventoryService.snapshot(id, InventoryService.ENDER));
            s.inventorySubscriptions().add(id.toString());
            watcher.prime(id, both);
            return both;
        });
        handlers.put("inv.unsubscribe", (s, d) -> {
            s.inventorySubscriptions().remove(uuid(d).toString());
            return new JsonObject();
        });
        handlers.put("inv.set", (s, d) -> {
            UUID id = uuid(d);
            String type = Json.str(d, "type");
            inventoryService.setSlot(id, type, Json.integer(d, "slot"),
                    d.has("item") && d.get("item").isJsonObject() ? d.getAsJsonObject("item") : null);
            return inventoryService.snapshot(id, type);
        });
        handlers.put("inv.move", (s, d) -> {
            UUID from = uuid(d);
            UUID to = d.has("toUuid") ? UUID.fromString(Json.str(d, "toUuid")) : from;
            inventoryService.move(from, Json.str(d, "fromType"), Json.integer(d, "fromSlot"),
                    to, Json.str(d, "toType"), Json.integer(d, "toSlot"),
                    d.has("amount") ? d.get("amount").getAsInt() : -1);
            return new JsonObject();
        });
        handlers.put("inv.clear", (s, d) -> {
            UUID id = uuid(d);
            String type = Json.str(d, "type");
            inventoryService.clear(id, type);
            return inventoryService.snapshot(id, type);
        });
        handlers.put("inv.give", (s, d) -> {
            UUID id = uuid(d);
            String type = d.has("type") ? Json.str(d, "type") : InventoryService.INVENTORY;
            inventoryService.give(id, type, d.getAsJsonObject("item"));
            return inventoryService.snapshot(id, type);
        });
    }

    public void setServer(PanelServer server) {
        this.server = server;
    }

    /** WebSocket 스레드에서 호출됨 → 메인 스레드로 넘겨서 처리 후 응답. */
    public void handle(WebSocket conn, Session session, long id, String action, JsonObject data) {
        Handler handler = handlers.get(action);
        if (handler == null) {
            server.error(conn, id, "알 수 없는 요청: " + action);
            return;
        }
        if (!plugin.isEnabled()) return;
        Bukkit.getScheduler().runTask(plugin, () -> {
            try {
                server.reply(conn, id, handler.handle(session, data));
            } catch (IllegalArgumentException | IllegalStateException e) {
                server.error(conn, id, e.getMessage() == null ? "잘못된 요청" : e.getMessage());
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "웹 패널 요청 처리 중 오류: " + action, e);
                server.error(conn, id, "서버 오류: " + e.getClass().getSimpleName());
            }
        });
    }

    public void onClose(Session session) {
        session.inventorySubscriptions().clear();
    }

    private static UUID uuid(JsonObject d) {
        try {
            return UUID.fromString(Json.str(d, "uuid"));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("잘못된 플레이어 UUID");
        }
    }
}
