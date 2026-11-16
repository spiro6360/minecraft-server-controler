package kr.mcpanel.service;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import kr.mcpanel.util.ItemCodec;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.Map;
import java.util.UUID;

/**
 * 플레이어 인벤토리 / 엔더상자 조회와 수정.
 *
 * 인벤토리 칸 번호 (마인크래프트 내부 번호 그대로)
 *   0~8   핫바
 *   9~35  가방
 *   36~39 갑옷 (36 신발, 37 바지, 38 흉갑, 39 투구)
 *   40    왼손
 * 엔더상자: 0~26
 */
public final class InventoryService {

    public static final String INVENTORY = "inventory";
    public static final String ENDER = "ender";

    private JsonObject registryCache;

    private Inventory inventory(UUID uuid, String type) {
        Player p = Bukkit.getPlayer(uuid);
        if (p == null) throw new IllegalStateException("플레이어가 접속 중일 때만 인벤토리를 수정할 수 있습니다");
        return switch (type) {
            case INVENTORY -> p.getInventory();
            case ENDER -> p.getEnderChest();
            default -> throw new IllegalArgumentException("type 은 inventory 또는 ender");
        };
    }

    private static int size(String type) {
        return INVENTORY.equals(type) ? 41 : 27;
    }

    public JsonObject snapshot(UUID uuid, String type) {
        if (!INVENTORY.equals(type) && !ENDER.equals(type)) throw new IllegalArgumentException("type 은 inventory 또는 ender");
        JsonObject o = new JsonObject();
        o.addProperty("uuid", uuid.toString());
        o.addProperty("type", type);
        Player p = Bukkit.getPlayer(uuid);
        o.addProperty("online", p != null);
        JsonArray items = new JsonArray();
        if (p != null) {
            Inventory inv = inventory(uuid, type);
            int n = size(type);
            for (int i = 0; i < n; i++) items.add(ItemCodec.toJson(inv.getItem(i)));
        }
        o.add("items", items);
        return o;
    }

    public void setSlot(UUID uuid, String type, int slot, JsonObject item) {
        Inventory inv = inventory(uuid, type);
        checkSlot(type, slot);
        inv.setItem(slot, item == null ? null : ItemCodec.fromJson(item));
    }

    /**
     * 칸 이동. 같은 아이템이면 합치고, 다르면 서로 바꾼다.
     * amount 가 0보다 크고 원래 개수보다 적으면 그만큼만 빈 칸(또는 같은 아이템 칸)으로 나눠 옮긴다.
     */
    public void move(UUID fromUuid, String fromType, int fromSlot, UUID toUuid, String toType, int toSlot, int amount) {
        Inventory src = inventory(fromUuid, fromType);
        Inventory dst = inventory(toUuid, toType);
        checkSlot(fromType, fromSlot);
        checkSlot(toType, toSlot);
        if (src == dst && fromSlot == toSlot) return;

        ItemStack a = src.getItem(fromSlot);
        ItemStack b = dst.getItem(toSlot);
        if (a == null || a.getType().isAir()) return;

        int moving = amount > 0 && amount < a.getAmount() ? amount : a.getAmount();
        boolean emptyTarget = b == null || b.getType().isAir();

        if (emptyTarget) {
            ItemStack moved = a.clone();
            moved.setAmount(moving);
            dst.setItem(toSlot, moved);
            a.setAmount(a.getAmount() - moving);
            src.setItem(fromSlot, a.getAmount() > 0 ? a : null);
        } else if (b.isSimilar(a)) {
            int space = Math.max(0, b.getMaxStackSize() - b.getAmount());
            int n = Math.min(space, moving);
            if (n == 0) return;
            b.setAmount(b.getAmount() + n);
            dst.setItem(toSlot, b);
            a.setAmount(a.getAmount() - n);
            src.setItem(fromSlot, a.getAmount() > 0 ? a : null);
        } else {
            if (moving != a.getAmount()) throw new IllegalArgumentException("다른 아이템이 있는 칸으로는 일부만 옮길 수 없습니다");
            src.setItem(fromSlot, b);
            dst.setItem(toSlot, a);
        }
    }

    public void clear(UUID uuid, String type) {
        inventory(uuid, type).clear();
    }

    public void give(UUID uuid, String type, JsonObject item) {
        if (item == null) throw new IllegalArgumentException("아이템이 필요합니다");
        Inventory inv = inventory(uuid, type);
        ItemStack stack = ItemCodec.fromJson(item);
        Map<Integer, ItemStack> left = inv.addItem(stack);
        if (!left.isEmpty()) {
            int n = left.values().stream().mapToInt(ItemStack::getAmount).sum();
            throw new IllegalStateException("공간이 부족해서 " + n + "개는 넣지 못했습니다");
        }
    }

    /** 웹의 아이템 선택 목록용: 모든 아이템 id 와 마법부여 목록. */
    public JsonObject registry() {
        if (registryCache != null) return registryCache;
        JsonArray items = new JsonArray();
        for (Material m : Material.values()) {
            if (m.isLegacy() || !m.isItem() || m.isAir()) continue;
            items.add(m.getKey().asString());
        }
        JsonArray enchants = new JsonArray();
        for (Enchantment e : ItemCodec.enchantments()) {
            JsonObject eo = new JsonObject();
            eo.addProperty("id", e.getKey().asString());
            eo.addProperty("maxLevel", e.getMaxLevel());
            enchants.add(eo);
        }
        JsonObject o = new JsonObject();
        o.add("items", items);
        o.add("enchants", enchants);
        registryCache = o;
        return o;
    }

    private static void checkSlot(String type, int slot) {
        if (slot < 0 || slot >= size(type)) throw new IllegalArgumentException("잘못된 칸 번호: " + slot);
    }
}
