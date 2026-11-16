package kr.mcpanel.net;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** WebSocket 연결 하나에 붙는 정보 (로그인 여부, 구독 중인 인벤토리 등). */
public final class Session {

    private final String ip;
    private volatile boolean authenticated;
    /** "uuid:inventory" / "uuid:ender" 형태의 구독 키 */
    private final Set<String> inventorySubscriptions = ConcurrentHashMap.newKeySet();

    public Session(String ip) {
        this.ip = ip;
    }

    public String ip() {
        return ip;
    }

    public boolean isAuthenticated() {
        return authenticated;
    }

    public void setAuthenticated(boolean authenticated) {
        this.authenticated = authenticated;
    }

    public Set<String> inventorySubscriptions() {
        return inventorySubscriptions;
    }
}
