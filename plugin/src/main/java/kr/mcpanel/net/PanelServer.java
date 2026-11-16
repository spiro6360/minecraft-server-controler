package kr.mcpanel.net;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;
import org.java_websocket.framing.CloseFrame;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import java.util.logging.Logger;

/**
 * 웹사이트와 통신하는 WebSocket 서버.
 *
 * 메시지 형식
 *   요청:   {"id": 1, "action": "players.list", "data": {...}}
 *   응답:   {"id": 1, "ok": true, "data": {...}}  /  {"id": 1, "ok": false, "error": "..."}
 *   이벤트: {"event": "status", "data": {...}}   (서버가 먼저 보내는 실시간 알림)
 *
 * 첫 메시지는 반드시 {"action":"auth","data":{"token":"..."}} 이어야 한다.
 */
public final class PanelServer extends WebSocketServer {

    private static final long AUTH_TIMEOUT_SECONDS = 10;
    private static final int MAX_MESSAGE_CHARS = 512 * 1024;

    private final byte[] tokenBytes;
    private final List<String> allowedOrigins;
    private final int maxFailures;
    private final long blockMillis;
    private final RequestRouter router;
    private final Logger logger;

    private final Map<String, Integer> failures = new ConcurrentHashMap<>();
    private final Map<String, Long> blockedUntil = new ConcurrentHashMap<>();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "WebPanel-timer");
        t.setDaemon(true);
        return t;
    });

    public PanelServer(InetSocketAddress address, String token, List<String> allowedOrigins,
                       int maxFailures, int blockMinutes, RequestRouter router, Logger logger) {
        super(address);
        this.tokenBytes = token.getBytes(StandardCharsets.UTF_8);
        this.allowedOrigins = allowedOrigins;
        this.maxFailures = Math.max(1, maxFailures);
        this.blockMillis = Math.max(1, blockMinutes) * 60_000L;
        this.router = router;
        this.logger = logger;
        setReuseAddr(true);
        setConnectionLostTimeout(30);
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        String ip = resolveIp(conn, handshake);
        Long until = blockedUntil.get(ip);
        if (until != null && until > System.currentTimeMillis()) {
            conn.close(CloseFrame.POLICY_VALIDATION, "too many failed logins");
            return;
        }
        String origin = handshake.getFieldValue("Origin");
        if (!originAllowed(origin)) {
            logger.warning("허용되지 않은 Origin 에서 접속 시도 차단: " + origin + " (" + ip + ")");
            conn.close(CloseFrame.POLICY_VALIDATION, "origin not allowed");
            return;
        }
        Session session = new Session(ip);
        conn.setAttachment(session);
        timer.schedule(() -> {
            if (conn.isOpen() && !session.isAuthenticated()) {
                conn.close(CloseFrame.POLICY_VALIDATION, "auth timeout");
            }
        }, AUTH_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        Session session = conn.getAttachment();
        if (session == null) return;
        if (message.length() > MAX_MESSAGE_CHARS) {
            conn.close(CloseFrame.TOOBIG, "message too big");
            return;
        }
        JsonObject req;
        try {
            req = JsonParser.parseString(message).getAsJsonObject();
        } catch (Exception e) {
            conn.close(CloseFrame.UNEXPECTED_CONDITION, "bad json");
            return;
        }
        long id = req.has("id") ? req.get("id").getAsLong() : 0;
        String action = req.has("action") ? req.get("action").getAsString() : "";
        JsonObject data = req.has("data") && req.get("data").isJsonObject()
                ? req.getAsJsonObject("data") : new JsonObject();

        if (!session.isAuthenticated()) {
            handleAuth(conn, session, id, action, data);
            return;
        }
        router.handle(conn, session, id, action, data);
    }

    private void handleAuth(WebSocket conn, Session session, long id, String action, JsonObject data) {
        if (!"auth".equals(action) || !data.has("token")) {
            conn.close(CloseFrame.POLICY_VALIDATION, "auth required");
            return;
        }
        byte[] given = data.get("token").getAsString().getBytes(StandardCharsets.UTF_8);
        if (MessageDigest.isEqual(given, tokenBytes)) {
            session.setAuthenticated(true);
            failures.remove(session.ip());
            logger.info("웹 패널 로그인 성공 (" + session.ip() + ")");
            reply(conn, id, new JsonObject());
        } else {
            int count = failures.merge(session.ip(), 1, Integer::sum);
            logger.warning("웹 패널 로그인 실패 " + count + "회 (" + session.ip() + ")");
            if (count >= maxFailures) {
                blockedUntil.put(session.ip(), System.currentTimeMillis() + blockMillis);
                failures.remove(session.ip());
                logger.warning("로그인 실패가 많아 IP 차단: " + session.ip());
            }
            error(conn, id, "토큰이 올바르지 않습니다");
            conn.close(CloseFrame.POLICY_VALIDATION, "invalid token");
        }
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        Session session = conn.getAttachment();
        if (session != null) router.onClose(session);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn == null) {
            logger.severe("WebSocket 서버 오류 (포트가 이미 사용 중일 수 있음): " + ex.getMessage());
        }
    }

    @Override
    public void onStart() {
        // 시작 로그는 플러그인 본체에서 출력
    }

    // ---------------------------------------------------------------- 보내기

    public void reply(WebSocket conn, long id, JsonElement data) {
        JsonObject res = new JsonObject();
        res.addProperty("id", id);
        res.addProperty("ok", true);
        res.add("data", data);
        sendSafe(conn, res.toString());
    }

    public void error(WebSocket conn, long id, String message) {
        JsonObject res = new JsonObject();
        res.addProperty("id", id);
        res.addProperty("ok", false);
        res.addProperty("error", message);
        sendSafe(conn, res.toString());
    }

    /** 로그인한 모든 연결에 이벤트를 보낸다. */
    public void broadcastEvent(String event, JsonElement data) {
        broadcastEvent(event, data, s -> true);
    }

    /** 로그인한 연결 중 조건에 맞는 연결에만 이벤트를 보낸다. */
    public void broadcastEvent(String event, JsonElement data, Predicate<Session> filter) {
        JsonObject msg = new JsonObject();
        msg.addProperty("event", event);
        msg.add("data", data);
        String text = msg.toString();
        for (WebSocket conn : getConnections()) {
            Session s = conn.getAttachment();
            if (s != null && s.isAuthenticated() && filter.test(s)) {
                sendSafe(conn, text);
            }
        }
    }

    public boolean hasAuthenticatedClients() {
        for (WebSocket conn : getConnections()) {
            Session s = conn.getAttachment();
            if (s != null && s.isAuthenticated()) return true;
        }
        return false;
    }

    private void sendSafe(WebSocket conn, String text) {
        try {
            if (conn.isOpen()) conn.send(text);
        } catch (Exception ignored) {
            // 연결이 끊기는 중이면 무시
        }
    }

    // ---------------------------------------------------------------- 보조

    private boolean originAllowed(String origin) {
        if (allowedOrigins == null || allowedOrigins.isEmpty() || allowedOrigins.contains("*")) return true;
        if (origin == null) return false;
        for (String allowed : allowedOrigins) {
            if (allowed.equalsIgnoreCase(origin.trim())) return true;
        }
        return false;
    }

    /**
     * 접속한 사람의 IP. Cloudflare Tunnel 을 거치면 실제 IP 는 CF-Connecting-IP 헤더에 담긴다.
     * 헤더 위조를 막기 위해 직접 연결이 이 컴퓨터(루프백)에서 온 경우에만 헤더를 믿는다.
     */
    private String resolveIp(WebSocket conn, ClientHandshake handshake) {
        InetSocketAddress remote = conn.getRemoteSocketAddress();
        String direct = remote != null ? remote.getAddress().getHostAddress() : "unknown";
        boolean loopback = remote != null && remote.getAddress().isLoopbackAddress();
        if (loopback) {
            String cf = handshake.getFieldValue("CF-Connecting-IP");
            if (cf != null && !cf.isBlank()) return cf.trim();
        }
        return direct;
    }
}
