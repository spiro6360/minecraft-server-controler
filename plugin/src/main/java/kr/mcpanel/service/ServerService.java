package kr.mcpanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.mcpanel.WebPanelPlugin;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.World;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 서버 상태 조회, 실시간 설정 변경, server.properties 편집. */
public final class ServerService {

    private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacyAmpersand();
    private final WebPanelPlugin plugin;
    private final Path propertiesFile = Path.of("server.properties");

    public ServerService(WebPanelPlugin plugin) {
        this.plugin = plugin;
    }

    // ------------------------------------------------------------- 상태

    public JsonObject status() {
        Runtime rt = Runtime.getRuntime();
        JsonObject o = new JsonObject();
        double[] tps = Bukkit.getTPS();
        JsonArray tpsArr = new JsonArray();
        for (double t : tps) tpsArr.add(Math.round(Math.min(t, 20.0) * 100.0) / 100.0);
        o.add("tps", tpsArr);
        o.addProperty("mspt", Math.round(Bukkit.getAverageTickTime() * 100.0) / 100.0);
        o.addProperty("memoryUsed", (rt.totalMemory() - rt.freeMemory()) / 1048576);
        o.addProperty("memoryMax", rt.maxMemory() / 1048576);
        o.addProperty("online", Bukkit.getOnlinePlayers().size());
        o.addProperty("maxPlayers", Bukkit.getMaxPlayers());
        o.addProperty("version", Bukkit.getMinecraftVersion());
        o.addProperty("software", Bukkit.getName() + " " + Bukkit.getVersion());
        o.addProperty("uptimeSeconds", ManagementFactory.getRuntimeMXBean().getUptime() / 1000);
        JsonArray worlds = new JsonArray();
        for (World w : Bukkit.getWorlds()) {
            JsonObject wo = new JsonObject();
            wo.addProperty("name", w.getName());
            wo.addProperty("players", w.getPlayers().size());
            wo.addProperty("entities", w.getEntityCount());
            wo.addProperty("chunks", w.getChunkCount());
            worlds.add(wo);
        }
        o.add("worlds", worlds);
        return o;
    }

    // ------------------------------------------------------------- 실시간 설정

    public JsonObject settings() {
        JsonObject o = new JsonObject();
        o.addProperty("motd", LEGACY.serialize(Bukkit.motd()));
        o.addProperty("maxPlayers", Bukkit.getMaxPlayers());
        o.addProperty("whitelist", Bukkit.hasWhitelist());
        o.addProperty("whitelistEnforced", Bukkit.isWhitelistEnforced());
        o.addProperty("defaultGameMode", Bukkit.getDefaultGameMode().name());
        o.addProperty("viewDistance", Bukkit.getViewDistance());
        o.addProperty("simulationDistance", Bukkit.getSimulationDistance());
        JsonArray worlds = new JsonArray();
        for (World w : Bukkit.getWorlds()) {
            JsonObject wo = new JsonObject();
            wo.addProperty("name", w.getName());
            wo.addProperty("environment", w.getEnvironment().name());
            wo.addProperty("difficulty", w.getDifficulty().name());
            wo.addProperty("time", w.getTime());
            wo.addProperty("fullTime", w.getFullTime());
            wo.addProperty("weather", w.isThundering() ? "thunder" : w.hasStorm() ? "rain" : "clear");
            wo.addProperty("pvp", w.getPVP());
            JsonObject rules = new JsonObject();
            for (GameRule<?> rule : Registry.GAME_RULE) {
                String name = rule.getKey().getKey();
                Object value = w.getGameRuleValue(rule);
                if (value instanceof Boolean b) rules.addProperty(name, b);
                else if (value instanceof Number n) rules.addProperty(name, n);
                else if (value != null) rules.addProperty(name, value.toString());
            }
            wo.add("gamerules", rules);
            worlds.add(wo);
        }
        o.add("worlds", worlds);
        return o;
    }

    public void applySetting(String key, String worldName, JsonElement value) {
        if (value == null || value.isJsonNull()) throw new IllegalArgumentException("값이 필요합니다");
        switch (key) {
            case "motd" -> Bukkit.motd(LEGACY.deserialize(value.getAsString()));
            case "maxPlayers" -> {
                int max = value.getAsInt();
                if (max < 0 || max > 10000) throw new IllegalArgumentException("최대 인원은 0~10000");
                Bukkit.setMaxPlayers(max);
            }
            case "whitelist" -> Bukkit.setWhitelist(value.getAsBoolean());
            case "whitelistEnforced" -> Bukkit.setWhitelistEnforced(value.getAsBoolean());
            case "defaultGameMode" -> Bukkit.setDefaultGameMode(parseGameMode(value.getAsString()));
            case "difficulty" -> world(worldName).setDifficulty(parseDifficulty(value.getAsString()));
            case "time" -> world(worldName).setTime(parseTime(value.getAsString()));
            case "weather" -> {
                World w = world(worldName);
                switch (value.getAsString()) {
                    case "clear" -> {
                        w.setStorm(false);
                        w.setThundering(false);
                        w.setClearWeatherDuration(6000);
                    }
                    case "rain" -> {
                        w.setStorm(true);
                        w.setThundering(false);
                    }
                    case "thunder" -> {
                        w.setStorm(true);
                        w.setThundering(true);
                    }
                    default -> throw new IllegalArgumentException("날씨는 clear / rain / thunder");
                }
            }
            case "pvp" -> world(worldName).setPVP(value.getAsBoolean());
            default -> throw new IllegalArgumentException("알 수 없는 설정: " + key);
        }
    }

    @SuppressWarnings("unchecked")
    public void setGameRule(String worldName, String ruleName, String value) {
        World w = world(worldName);
        NamespacedKey key = NamespacedKey.fromString(ruleName);
        GameRule<?> rule = key != null ? Registry.GAME_RULE.get(key) : null;
        if (rule == null) throw new IllegalArgumentException("알 수 없는 게임 규칙: " + ruleName);
        if (rule.getType() == Boolean.class) {
            if (!value.equalsIgnoreCase("true") && !value.equalsIgnoreCase("false")) {
                throw new IllegalArgumentException("true 또는 false 여야 합니다");
            }
            w.setGameRule((GameRule<Boolean>) rule, Boolean.parseBoolean(value));
        } else if (rule.getType() == Integer.class) {
            try {
                w.setGameRule((GameRule<Integer>) rule, Integer.parseInt(value.trim()));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("숫자여야 합니다");
            }
        } else {
            throw new IllegalArgumentException("지원하지 않는 규칙 형식");
        }
    }

    // ------------------------------------------------------------- server.properties

    public JsonObject readProperties() throws IOException {
        JsonArray arr = new JsonArray();
        if (Files.exists(propertiesFile)) {
            for (String line : Files.readAllLines(propertiesFile, StandardCharsets.UTF_8)) {
                if (line.isBlank() || line.startsWith("#")) continue;
                int eq = line.indexOf('=');
                if (eq < 0) continue;
                JsonObject p = new JsonObject();
                p.addProperty("key", line.substring(0, eq).trim());
                p.addProperty("value", line.substring(eq + 1));
                arr.add(p);
            }
        }
        JsonObject o = new JsonObject();
        o.add("properties", arr);
        return o;
    }

    /** 바뀐 키의 줄만 교체하고 주석과 나머지 줄은 그대로 둔다. 서버 재시작 후 적용된다. */
    public void writeProperties(JsonObject values) throws IOException {
        if (values == null || values.size() == 0) return;
        List<String> lines = Files.exists(propertiesFile)
                ? new ArrayList<>(Files.readAllLines(propertiesFile, StandardCharsets.UTF_8))
                : new ArrayList<>();
        for (Map.Entry<String, JsonElement> e : values.entrySet()) {
            String key = e.getKey();
            String val = e.getValue().isJsonNull() ? "" : e.getValue().getAsString();
            if (!key.matches("[A-Za-z0-9._\\-]+")) throw new IllegalArgumentException("잘못된 키: " + key);
            if (val.contains("\n") || val.contains("\r")) throw new IllegalArgumentException("값에 줄바꿈 불가: " + key);
            boolean replaced = false;
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i);
                if (line.startsWith("#")) continue;
                int eq = line.indexOf('=');
                if (eq > 0 && line.substring(0, eq).trim().equals(key)) {
                    lines.set(i, key + "=" + val);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) lines.add(key + "=" + val);
        }
        Files.write(propertiesFile, lines, StandardCharsets.UTF_8);
        plugin.getLogger().info("웹 패널에서 server.properties 수정됨 (재시작 후 적용): " + values.keySet());
    }

    // ------------------------------------------------------------- 보조

    private static World world(String name) {
        if (name == null) throw new IllegalArgumentException("월드 이름이 필요합니다");
        World w = Bukkit.getWorld(name);
        if (w == null) throw new IllegalArgumentException("월드를 찾을 수 없음: " + name);
        return w;
    }

    static GameMode parseGameMode(String s) {
        try {
            return GameMode.valueOf(s.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("게임모드는 SURVIVAL / CREATIVE / ADVENTURE / SPECTATOR");
        }
    }

    private static Difficulty parseDifficulty(String s) {
        try {
            return Difficulty.valueOf(s.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("난이도는 PEACEFUL / EASY / NORMAL / HARD");
        }
    }

    private static long parseTime(String s) {
        return switch (s.toLowerCase(Locale.ROOT)) {
            case "day" -> 1000;
            case "noon" -> 6000;
            case "night" -> 13000;
            case "midnight" -> 18000;
            default -> {
                try {
                    long t = Long.parseLong(s.trim());
                    if (t < 0 || t > 23999) throw new IllegalArgumentException("시간은 0~23999");
                    yield t;
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("시간은 day / noon / night / midnight 또는 0~23999");
                }
            }
        };
    }
}
