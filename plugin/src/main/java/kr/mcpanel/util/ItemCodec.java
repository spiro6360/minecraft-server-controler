package kr.mcpanel.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * ItemStack ↔ JSON 변환.
 * "data" 에는 아이템 전체(모든 컴포넌트)를 Base64 로 담아서, 웹에서 일부만 고쳐도 나머지 정보가 보존되게 한다.
 * 이름/설명에는 &a 같은 색 코드를 쓸 수 있다.
 */
public final class ItemCodec {

    private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacyAmpersand();
    private static final int MAX_AMOUNT = 99;

    private ItemCodec() {
    }

    public static Registry<Enchantment> enchantments() {
        return RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);
    }

    public static JsonElement toJson(ItemStack item) {
        if (item == null || item.getType().isAir() || item.getAmount() <= 0) return com.google.gson.JsonNull.INSTANCE;
        JsonObject o = new JsonObject();
        o.addProperty("id", item.getType().getKey().asString());
        o.addProperty("amount", item.getAmount());
        o.addProperty("maxStack", item.getMaxStackSize());
        ItemMeta meta = item.getItemMeta();
        if (meta != null) {
            if (meta.hasCustomName() && meta.customName() != null) {
                o.addProperty("name", LEGACY.serialize(meta.customName()));
            }
            List<Component> lore = meta.lore();
            if (lore != null && !lore.isEmpty()) {
                JsonArray arr = new JsonArray();
                for (Component line : lore) arr.add(LEGACY.serialize(line));
                o.add("lore", arr);
            }
            Map<Enchantment, Integer> enchants = meta instanceof EnchantmentStorageMeta book
                    ? book.getStoredEnchants() : meta.getEnchants();
            if (!enchants.isEmpty()) {
                JsonObject en = new JsonObject();
                for (Map.Entry<Enchantment, Integer> e : enchants.entrySet()) {
                    en.addProperty(e.getKey().getKey().asString(), e.getValue());
                }
                o.add("enchants", en);
            }
            if (meta instanceof Damageable dmg) {
                int maxDamage = dmg.hasMaxDamage() ? dmg.getMaxDamage() : item.getType().getMaxDurability();
                if (maxDamage > 0) {
                    o.addProperty("damage", dmg.getDamage());
                    o.addProperty("maxDamage", maxDamage);
                }
            }
        }
        o.addProperty("data", Base64.getEncoder().encodeToString(item.serializeAsBytes()));
        return o;
    }

    /** JSON 으로부터 아이템을 만든다. JSON 에 들어 있는 항목만 바꾸고 나머지는 data 의 원본을 유지한다. */
    public static ItemStack fromJson(JsonObject o) {
        ItemStack item = null;
        if (o.has("data") && !o.get("data").isJsonNull()) {
            try {
                item = ItemStack.deserializeBytes(Base64.getDecoder().decode(o.get("data").getAsString()));
            } catch (Exception e) {
                throw new IllegalArgumentException("아이템 데이터가 손상되었습니다");
            }
        }
        if (o.has("id")) {
            Material material = Material.matchMaterial(o.get("id").getAsString());
            if (material == null || !material.isItem() || material.isAir()) {
                throw new IllegalArgumentException("알 수 없는 아이템: " + o.get("id").getAsString());
            }
            if (item == null) item = new ItemStack(material);
            else if (item.getType() != material) item = item.withType(material);
        }
        if (item == null) throw new IllegalArgumentException("아이템 종류(id)가 필요합니다");

        if (o.has("amount")) {
            int amount = o.get("amount").getAsInt();
            if (amount < 1 || amount > MAX_AMOUNT) throw new IllegalArgumentException("개수는 1~" + MAX_AMOUNT);
            item.setAmount(amount);
        }

        ItemMeta meta = item.getItemMeta();
        if (meta == null) return item;

        if (o.has("name")) {
            String name = o.get("name").isJsonNull() ? "" : o.get("name").getAsString();
            meta.customName(name.isBlank() ? null : LEGACY.deserialize(name));
        }
        if (o.has("lore")) {
            List<Component> lore = new ArrayList<>();
            if (o.get("lore").isJsonArray()) {
                for (JsonElement line : o.getAsJsonArray("lore")) lore.add(LEGACY.deserialize(line.getAsString()));
            }
            meta.lore(lore.isEmpty() ? null : lore);
        }
        if (o.has("enchants") && o.get("enchants").isJsonObject()) {
            Registry<Enchantment> registry = enchantments();
            if (meta instanceof EnchantmentStorageMeta book) {
                for (Enchantment e : new ArrayList<>(book.getStoredEnchants().keySet())) book.removeStoredEnchant(e);
            } else {
                for (Enchantment e : new ArrayList<>(meta.getEnchants().keySet())) meta.removeEnchant(e);
            }
            for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("enchants").entrySet()) {
                NamespacedKey key = NamespacedKey.fromString(e.getKey());
                Enchantment ench = key != null ? registry.get(key) : null;
                if (ench == null) throw new IllegalArgumentException("알 수 없는 마법부여: " + e.getKey());
                int level = e.getValue().getAsInt();
                if (level < 1 || level > 255) throw new IllegalArgumentException("마법부여 레벨은 1~255");
                if (meta instanceof EnchantmentStorageMeta book) book.addStoredEnchant(ench, level, true);
                else meta.addEnchant(ench, level, true);
            }
        }
        if (o.has("damage") && meta instanceof Damageable dmg) {
            dmg.setDamage(Math.max(0, o.get("damage").getAsInt()));
        }
        item.setItemMeta(meta);
        return item;
    }
}
