package kr.mcpanel.sync;

import com.google.gson.JsonObject;
import kr.mcpanel.net.PanelServer;
import kr.mcpanel.service.InventoryService;
import org.java_websocket.WebSocket;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 웹에서 보고 있는 플레이어의 인벤토리/엔더상자를 일정 주기로 확인해서,
 * 바뀐 경우에만 해당 화면을 보고 있는 웹 연결에 "inv" 이벤트로 보낸다.
 * (인게임에서 아이템을 줍거나 버려도 웹 화면이 바로 바뀌는 원리)
 */
public final class InventoryWatcher implements Runnable {

    private final InventoryService inventoryService;
    private final Map<String, String> lastSnapshots = new HashMap<>();
    private PanelServer server;

    public InventoryWatcher(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    public void setServer(PanelServer server) {
        this.server = server;
    }

    /** 구독 직후의 상태를 기억해 두어 같은 내용을 한 번 더 보내지 않게 한다. */
    public void prime(UUID uuid, JsonObject both) {
        lastSnapshots.put(uuid + ":" + InventoryService.INVENTORY, both.get("inventory").toString());
        lastSnapshots.put(uuid + ":" + InventoryService.ENDER, both.get("ender").toString());
    }

    @Override
    public void run() {
        if (server == null) return;
        Set<String> watched = new HashSet<>();
        for (WebSocket conn : server.getConnections()) {
            kr.mcpanel.net.Session s = conn.getAttachment();
            if (s != null && s.isAuthenticated()) watched.addAll(s.inventorySubscriptions());
        }
        lastSnapshots.keySet().removeIf(k -> !watched.contains(k.substring(0, k.indexOf(':'))));

        for (String uuidStr : watched) {
            UUID uuid = UUID.fromString(uuidStr);
            for (String type : new String[]{InventoryService.INVENTORY, InventoryService.ENDER}) {
                JsonObject snap = inventoryService.snapshot(uuid, type);
                String text = snap.toString();
                String key = uuidStr + ":" + type;
                if (!text.equals(lastSnapshots.get(key))) {
                    lastSnapshots.put(key, text);
                    server.broadcastEvent("inv", snap, s -> s.inventorySubscriptions().contains(uuidStr));
                }
            }
        }
    }
}
