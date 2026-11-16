package kr.mcpanel.sync;

import com.google.gson.JsonElement;
import kr.mcpanel.WebPanelPlugin;
import kr.mcpanel.net.PanelServer;
import kr.mcpanel.service.PlayerService;
import kr.mcpanel.service.ServerService;
import org.bukkit.Bukkit;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * 서버 상태(TPS, 메모리), 실시간 설정, 접속자 정보를 주기적으로 웹에 보낸다.
 * 설정/접속자는 바뀐 경우에만 보낸다. 입장/퇴장 시에는 전체 플레이어 목록을 바로 보낸다.
 */
public final class StateBroadcaster implements Runnable, Listener {

    private final WebPanelPlugin plugin;
    private final PanelServer server;
    private final ServerService serverService;
    private final PlayerService playerService;
    private String lastSettings = "";
    private String lastOnline = "";

    public StateBroadcaster(WebPanelPlugin plugin, PanelServer server, ServerService serverService, PlayerService playerService) {
        this.plugin = plugin;
        this.server = server;
        this.serverService = serverService;
        this.playerService = playerService;
    }

    @Override
    public void run() {
        if (!server.hasAuthenticatedClients()) {
            // 아무도 안 보고 있으면 다음 접속 때 전부 새로 보내도록 초기화
            lastSettings = "";
            lastOnline = "";
            return;
        }
        server.broadcastEvent("status", serverService.status());

        JsonElement settings = serverService.settings();
        String s = settings.toString();
        if (!s.equals(lastSettings)) {
            lastSettings = s;
            server.broadcastEvent("settings", settings);
        }

        JsonElement online = playerService.online();
        String o = online.toString();
        if (!o.equals(lastOnline)) {
            lastOnline = o;
            server.broadcastEvent("players.online", online);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent e) {
        pushPlayersNextTick();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent e) {
        pushPlayersNextTick();
    }

    private void pushPlayersNextTick() {
        // 퇴장 이벤트 시점에는 아직 접속 중으로 잡히므로 1틱 뒤에 보낸다
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (server.hasAuthenticatedClients()) server.broadcastEvent("players", playerService.list());
        }, 1L);
    }
}
