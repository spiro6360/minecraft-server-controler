package kr.mcpanel;

import kr.mcpanel.net.PanelServer;
import kr.mcpanel.net.RequestRouter;
import kr.mcpanel.service.InventoryService;
import kr.mcpanel.service.PlayerService;
import kr.mcpanel.service.ServerService;
import kr.mcpanel.sync.ConsoleCapture;
import kr.mcpanel.sync.InventoryWatcher;
import kr.mcpanel.sync.StateBroadcaster;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.InetSocketAddress;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;

/**
 * 플러그인 진입점.
 * 인게임 명령어는 하나도 없고, WebSocket 서버를 열어서 웹사이트의 요청만 처리한다.
 */
public final class WebPanelPlugin extends JavaPlugin {

    private PanelServer panelServer;
    private ConsoleCapture consoleCapture;
    private InventoryWatcher inventoryWatcher;
    private StateBroadcaster stateBroadcaster;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        String token = ensureToken();

        String host = getConfig().getString("host", "127.0.0.1");
        int port = getConfig().getInt("port", 8765);
        List<String> origins = getConfig().getStringList("allowed-origins");
        int maxFailures = getConfig().getInt("auth.max-failures", 5);
        int blockMinutes = getConfig().getInt("auth.block-minutes", 15);

        ServerService serverService = new ServerService(this);
        PlayerService playerService = new PlayerService();
        InventoryService inventoryService = new InventoryService();

        consoleCapture = new ConsoleCapture(getConfig().getInt("console-buffer-lines", 500));
        inventoryWatcher = new InventoryWatcher(inventoryService);

        RequestRouter router = new RequestRouter(this, serverService, playerService,
                inventoryService, inventoryWatcher, consoleCapture);

        panelServer = new PanelServer(new InetSocketAddress(host, port), token, origins,
                maxFailures, blockMinutes, router, getLogger());
        router.setServer(panelServer);
        inventoryWatcher.setServer(panelServer);
        consoleCapture.setServer(panelServer);

        stateBroadcaster = new StateBroadcaster(this, panelServer, serverService, playerService);

        panelServer.start();
        consoleCapture.install();

        long invTicks = Math.max(1, getConfig().getLong("sync.inventory-interval-ticks", 5));
        long statusTicks = Math.max(10, getConfig().getLong("sync.status-interval-ticks", 40));
        getServer().getScheduler().runTaskTimer(this, inventoryWatcher, invTicks, invTicks);
        getServer().getScheduler().runTaskTimer(this, stateBroadcaster, statusTicks, statusTicks);
        getServer().getPluginManager().registerEvents(stateBroadcaster, this);

        getLogger().info("WebPanel WebSocket 서버 시작: ws://" + host + ":" + port);
    }

    @Override
    public void onDisable() {
        if (consoleCapture != null) consoleCapture.uninstall();
        if (panelServer != null) {
            try {
                panelServer.stop(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /** 토큰이 비어 있으면 새로 만들어 저장하고 콘솔에 한 번 보여준다. */
    private String ensureToken() {
        String token = getConfig().getString("token", "");
        if (token == null || token.isBlank()) {
            byte[] bytes = new byte[24];
            new SecureRandom().nextBytes(bytes);
            token = HexFormat.of().formatHex(bytes);
            getConfig().set("token", token);
            saveConfig();
            getLogger().warning("============================================");
            getLogger().warning(" WebPanel 로그인 토큰이 새로 만들어졌습니다:");
            getLogger().warning(" " + token);
            getLogger().warning(" (plugins/WebPanel/config.yml 에도 저장됨)");
            getLogger().warning("============================================");
        }
        return token;
    }
}
