package kr.mcpanel.util;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/** 요청 JSON 에서 값을 꺼낼 때 쓰는 짧은 도우미. 값이 없으면 알기 쉬운 오류를 낸다. */
public final class Json {

    private Json() {
    }

    public static String str(JsonObject o, String key) {
        JsonElement e = o.get(key);
        if (e == null || e.isJsonNull()) throw new IllegalArgumentException("'" + key + "' 값이 필요합니다");
        return e.getAsString();
    }

    public static String strOr(JsonObject o, String key, String fallback) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? fallback : e.getAsString();
    }

    public static int integer(JsonObject o, String key) {
        JsonElement e = o.get(key);
        if (e == null || e.isJsonNull()) throw new IllegalArgumentException("'" + key + "' 값이 필요합니다");
        try {
            return e.getAsInt();
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("'" + key + "' 는 숫자여야 합니다");
        }
    }
}
