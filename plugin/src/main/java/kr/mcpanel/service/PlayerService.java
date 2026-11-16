package kr.mcpanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.OfflinePlayer;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;

import java.util.Arrays;
import java.util.Comparator;
import java.util.UUID;

/** 플레이어 목록 조회와 관리 동작 (킥, 밴, OP, 게임모드, 회복, 텔레포트 등). */
public final class PlayerService {

    private static final int MAX_OFFLINE = 500;
    private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacyAmpersand();

    /** 접속 중인 플레이어만 (자주 갱신됨). */
    public JsonArray online() {
        JsonArray arr = new JsonArray();
        for (Player p : Bukkit.getOnlinePlayers()) {
            JsonObject o = base(p);
            o.addProperty("online", true);
            o.addProperty("health", Math.round(p.getHealth() * 10.0) / 10.0);
            AttributeInstance max = p.getAttribute(Attribute.MAX_HEALTH);
            o.addProperty("maxHealth", max != null ? max.getValue() : 20.0);
            o.addProperty("food", p.getFoodLevel());
            o.addProperty("level", p.getLevel());
            o.addProperty("gamemode", p.getGameMode().name());
            o.addProperty("ping", p.getPing());
            Location l = p.getLocation();
            o.addProperty("world", l.getWorld() != null ? l.getWorld().getName() : "");
            o.addProperty("x", l.getBlockX());
            o.addProperty("y", l.getBlockY());
            o.addProperty("z", l.getBlockZ());
            arr.add(o);
        }
        return arr;
    }

    /** 접속 중 + 접속했던 적 있는 플레이어 전체. */
    public JsonObject list() {
        JsonObject res = new JsonObject();
        res.add("online", online());
        JsonArray offline = new JsonArray();
        OfflinePlayer[] all = Bukkit.getOfflinePlayers();
        Arrays.sort(all, Comparator.comparingLong(OfflinePlayer::getLastSeen).reversed());
        int count = 0;
        for (OfflinePlayer p : all) {
            if (p.isOnline()) continue;
            if (count++ >= MAX_OFFLINE) break;
            JsonObject o = base(p);
            o.addProperty("online", false);
            o.addProperty("lastSeen", p.getLastSeen());
            offline.add(o);
        }
        res.add("offline", offline);
        return res;
    }

    private JsonObject base(OfflinePlayer p) {
        JsonObject o = new JsonObject();
        o.addProperty("uuid", p.getUniqueId().toString());
        o.addProperty("name", p.getName() != null ? p.getName() : p.getUniqueId().toString().substring(0, 8));
        o.addProperty("op", p.isOp());
        o.addProperty("whitelisted", p.isWhitelisted());
        o.addProperty("banned", p.isBanned());
        return o;
    }

    public void action(UUID uuid, String type, JsonElement value) {
        OfflinePlayer target = Bukkit.getOfflinePlayer(uuid);
        Player online = target.getPlayer();
        String name = target.getName();
        String text = value != null && !value.isJsonNull() ? value.getAsString() : "";

        switch (type) {
            case "op" -> target.setOp(true);
            case "deop" -> target.setOp(false);
            case "whitelist" -> target.setWhitelisted(true);
            case "unwhitelist" -> target.setWhitelisted(false);
            case "ban" -> {
                requireName(name);
                String reason = text.isBlank() ? "관리자에 의해 차단되었습니다" : text;
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "ban " + name + " " + reason);
            }
            case "unban" -> {
                requireName(name);
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "pardon " + name);
            }
            case "kick" -> requireOnline(online).kick(Component.text(text.isBlank() ? "관리자에 의해 추방되었습니다" : text));
            case "gamemode" -> requireOnline(online).setGameMode(ServerService.parseGameMode(text));
            case "heal" -> {
                Player p = requireOnline(online);
                AttributeInstance max = p.getAttribute(Attribute.MAX_HEALTH);
                p.setHealth(max != null ? max.getValue() : 20.0);
                p.setFireTicks(0);
                for (PotionEffect effect : p.getActivePotionEffects()) p.removePotionEffect(effect.getType());
            }
            case "feed" -> {
                Player p = requireOnline(online);
                p.setFoodLevel(20);
                p.setSaturation(20f);
            }
            case "kill" -> requireOnline(online).setHealth(0);
            case "level" -> {
                int level;
                try {
                    level = Integer.parseInt(text.trim());
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("레벨은 숫자여야 합니다");
                }
                if (level < 0 || level > 100000) throw new IllegalArgumentException("레벨은 0~100000");
                requireOnline(online).setLevel(level);
            }
            case "tpspawn" -> {
                Player p = requireOnline(online);
                p.teleportAsync(Bukkit.getWorlds().getFirst().getSpawnLocation());
            }
            case "tpto" -> {
                Player p = requireOnline(online);
                Player dest = Bukkit.getPlayer(UUID.fromString(text));
                if (dest == null) throw new IllegalArgumentException("대상 플레이어가 접속 중이 아닙니다");
                p.teleportAsync(dest.getLocation());
            }
            case "message" -> {
                if (text.isBlank()) throw new IllegalArgumentException("메시지를 입력하세요");
                requireOnline(online).sendMessage(LEGACY.deserialize(text));
            }
            default -> throw new IllegalArgumentException("알 수 없는 동작: " + type);
        }
    }

    private static Player requireOnline(Player p) {
        if (p == null) throw new IllegalStateException("플레이어가 접속 중이 아닙니다");
        return p;
    }

    private static void requireName(String name) {
        if (name == null || !name.matches("[A-Za-z0-9_]{1,16}")) {
            throw new IllegalStateException("플레이어 이름을 알 수 없습니다");
        }
    }
}
