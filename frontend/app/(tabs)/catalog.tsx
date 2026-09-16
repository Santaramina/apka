import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { GearSix, MagnifyingGlass, Plus, X } from "phosphor-react-native";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Badge, Card, EmptyState, Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { VoiceEditButton } from "@/src/components/voice";
import { tradeLabel } from "@/src/lib/catalog";
import { pln } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Catalog() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<"material" | "labor">("material");
  const [trade, setTrade] = useState("all");
  const [sub, setSub] = useState("all");
  const [search, setSearch] = useState("");

  const materials = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch("/materials") });
  const labor = useQuery({ queryKey: ["labor-rates"], queryFn: () => apiFetch("/labor-rates") });

  const active = tab === "material" ? materials : labor;
  const raw: any[] = useMemo(() => active.data ?? [], [active.data]);

  // Branże obecne w danych (dynamiczne)
  const trades = useMemo(() => {
    const set = new Set<string>();
    raw.forEach((x) => x.trade && set.add(x.trade));
    return ["all", ...Array.from(set)];
  }, [raw]);

  // Podkategorie dla wybranej branży
  const subs = useMemo(() => {
    const set = new Set<string>();
    raw.forEach((x) => { if ((trade === "all" || x.trade === trade) && x.subcategory) set.add(x.subcategory); });
    return ["all", ...Array.from(set).sort()];
  }, [raw, trade]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return raw.filter((x) => {
      if (trade !== "all" && x.trade !== trade) return false;
      if (sub !== "all" && x.subcategory !== sub) return false;
      if (q) {
        const hay = `${x.name} ${x.manufacturer || ""} ${x.sku || ""} ${x.specs || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [raw, trade, sub, search]);

  const refetchAll = () => { materials.refetch(); labor.refetch(); };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Baza cenowa"
        subtitle="Materiały i robocizna"
        right={
          <Pressable onPress={() => { haptic("light"); router.push("/settings"); }} hitSlop={10} testID="open-settings-catalog">
            <GearSix size={26} color={colors.onSurface} weight="bold" />
          </Pressable>
        }
      />

      <View style={styles.topRow}>
        <View style={styles.segment}>
          <Pressable onPress={() => { setTab("material"); setSub("all"); }} style={[styles.segBtn, tab === "material" && styles.segActive]} testID="tab-materials">
            <Text style={[styles.segText, tab === "material" && styles.segTextActive]}>Materiały</Text>
          </Pressable>
          <Pressable onPress={() => { setTab("labor"); setSub("all"); }} style={[styles.segBtn, tab === "labor" && styles.segActive]} testID="tab-labor">
            <Text style={[styles.segText, tab === "labor" && styles.segTextActive]}>Robocizna</Text>
          </Pressable>
        </View>
        <VoiceEditButton context="catalog" onAppliedCatalog={refetchAll} compact testID="catalog-voice" />
      </View>

      <View style={styles.searchWrap}>
        <MagnifyingGlass size={18} color={colors.muted} weight="bold" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Szukaj: nazwa, producent, SKU, parametr..."
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          testID="catalog-search"
        />
        {search ? <Pressable onPress={() => setSearch("")} hitSlop={8} testID="catalog-search-clear"><X size={18} color={colors.muted} weight="bold" /></Pressable> : null}
      </View>

      <View style={styles.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {trades.map((t) => (
            <Pressable key={t} onPress={() => { haptic("light"); setTrade(t); setSub("all"); }} style={[styles.chip, trade === t && styles.chipActive]} testID={`trade-${t}`}>
              <Text style={[styles.chipText, trade === t && styles.chipTextActive]}>{t === "all" ? "Wszystkie" : tradeLabel(t)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {subs.length > 1 ? (
        <View style={styles.subWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {subs.map((s) => (
              <Pressable key={s} onPress={() => { haptic("light"); setSub(s); }} style={[styles.subChip, sub === s && styles.subActive]} testID={`sub-${s}`}>
                <Text style={[styles.subText, sub === s && styles.subTextActive]}>{s === "all" ? "Wszystkie kategorie" : s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <FlatList
        data={list}
        keyExtractor={(i) => i.material_id || i.labor_id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 10 }}
        refreshControl={<RefreshControl refreshing={active.isRefetching} onRefresh={refetchAll} tintColor={colors.brandPrimary} />}
        renderItem={({ item }) => {
          const id = item.material_id || item.labor_id;
          const price = tab === "material" ? item.unit_price : item.rate;
          const meta = [item.manufacturer, item.sku, item.specs].filter(Boolean).join(" · ");
          return (
            <Card onPress={() => router.push(`/catalog-form?type=${tab}&id=${id}`)} testID={`catalog-item-${id}`} style={{ padding: 0 }}>
              <View style={styles.itemRow}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                  <View style={styles.itemMetaRow}>
                    <Text style={styles.itemUnit}>{item.unit}{item.subcategory ? ` · ${item.subcategory}` : ""}</Text>
                  </View>
                  {meta ? <Text style={styles.itemSpecs} numberOfLines={1}>{meta}</Text> : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Money style={styles.itemPrice}>{pln(price)}</Money>
                  {item.price_is_example ? <Badge label="przykładowa" kind="warning" /> : null}
                </View>
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={active.isLoading ? <Loading /> : <EmptyState title="Brak pozycji" subtitle={search || trade !== "all" ? "Zmień filtry lub wyszukiwanie" : "Dodaj pozycję przyciskiem poniżej"} />}
      />

      <Pressable onPress={() => { haptic("light"); router.push(`/catalog-form?type=${tab}`); }} style={styles.fab} testID="add-catalog-fab">
        <Plus size={22} color={colors.onBrandPrimary} weight="bold" />
        <Text style={styles.fabText}>DODAJ</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12 },
  segment: { flex: 1, flexDirection: "row", borderWidth: 2, borderColor: colors.borderStrong },
  segBtn: { flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surface },
  segActive: { backgroundColor: colors.brandSecondary },
  segText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  segTextActive: { color: "#FFFFFF" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, height: 46, backgroundColor: colors.surfaceSecondary },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, padding: 0 },
  chipWrap: { height: 52, justifyContent: "center" },
  subWrap: { height: 44, justifyContent: "center" },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },
  subChip: { flexShrink: 0, height: 30, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  subActive: { backgroundColor: colors.surfaceInverse },
  subText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurface },
  subTextActive: { color: colors.onSurfaceInverse },
  itemRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  itemMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textTransform: "uppercase" },
  itemSpecs: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  itemPrice: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  fab: { position: "absolute", right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 20, height: 56 },
  fabText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },
}));
