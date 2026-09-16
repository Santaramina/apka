import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ArrowsDownUp, FileArrowUp, FunnelSimple, GearSix, MagnifyingGlass, Plus, Power, X } from "phosphor-react-native";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Badge, Button, Card, EmptyState, Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { VoiceEditButton } from "@/src/components/voice";
import { mainCategoryLabel } from "@/src/lib/catalog";
import { pln } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

type SortKey = "name" | "price_asc" | "price_desc";

export default function Catalog() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [tab, setTab] = useState<"material" | "labor">("material");
  const [cat, setCat] = useState("all");
  const [sub, setSub] = useState("all");
  const [search, setSearch] = useState("");
  const [manufacturer, setManufacturer] = useState("all");
  const [unit, setUnit] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [showInactive, setShowInactive] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const materials = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch("/materials") });
  const labor = useQuery({ queryKey: ["labor-rates"], queryFn: () => apiFetch("/labor-rates") });

  const active = tab === "material" ? materials : labor;
  const raw: any[] = useMemo(() => active.data ?? [], [active.data]);

  const cats = useMemo(() => {
    const set = new Set<string>();
    raw.forEach((x) => x.main_category && set.add(x.main_category));
    return ["all", ...Array.from(set)];
  }, [raw]);

  const subs = useMemo(() => {
    const set = new Set<string>();
    raw.forEach((x) => { if ((cat === "all" || x.main_category === cat) && x.subcategory) set.add(x.subcategory); });
    return ["all", ...Array.from(set).sort()];
  }, [raw, cat]);

  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    raw.forEach((x) => { if (x.manufacturer) set.add(x.manufacturer); });
    return ["all", ...Array.from(set).sort()];
  }, [raw]);

  const units = useMemo(() => {
    const set = new Set<string>();
    raw.forEach((x) => { if (x.unit) set.add(x.unit); });
    return ["all", ...Array.from(set).sort()];
  }, [raw]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = raw.filter((x) => {
      if (!showInactive && x.status === "inactive") return false;
      if (cat !== "all" && x.main_category !== cat) return false;
      if (sub !== "all" && x.subcategory !== sub) return false;
      if (manufacturer !== "all" && x.manufacturer !== manufacturer) return false;
      if (unit !== "all" && x.unit !== unit) return false;
      if (q) {
        const hay = `${x.name} ${x.manufacturer || ""} ${x.sku || ""} ${x.ean || ""} ${x.specs || ""} ${x.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const priceOf = (x: any) => (tab === "material" ? x.unit_price : x.rate) || 0;
    if (sort === "name") out = out.sort((a, b) => (a.name || "").localeCompare(b.name || "", "pl"));
    else if (sort === "price_asc") out = out.sort((a, b) => priceOf(a) - priceOf(b));
    else out = out.sort((a, b) => priceOf(b) - priceOf(a));
    return out;
  }, [raw, cat, sub, manufacturer, unit, search, sort, showInactive, tab]);

  const refetchAll = () => { materials.refetch(); labor.refetch(); };

  const toggleStatus = async (item: any) => {
    const id = item.material_id || item.labor_id;
    const endpoint = tab === "material" ? "/materials" : "/labor-rates";
    const next = item.status === "inactive" ? "active" : "inactive";
    try {
      haptic("medium");
      await apiFetch(`${endpoint}/${id}/status`, { method: "PATCH", body: { status: next } });
      toast.show(next === "inactive" ? "Pozycja dezaktywowana" : "Pozycja aktywna", "success");
      refetchAll();
    } catch (e: any) { toast.show(e.message, "error"); }
  };

  const activeFilters = (cat !== "all" ? 1 : 0) + (sub !== "all" ? 1 : 0) + (manufacturer !== "all" ? 1 : 0) + (unit !== "all" ? 1 : 0) + (sort !== "name" ? 1 : 0) + (showInactive ? 1 : 0);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Baza cenowa"
        subtitle="Materiały i usługi"
        right={<Pressable onPress={() => { haptic("light"); router.push("/settings"); }} hitSlop={10} testID="open-settings-catalog"><GearSix size={26} color={colors.onSurface} weight="bold" /></Pressable>}
      />

      <View style={styles.topRow}>
        <View style={styles.segment}>
          <Pressable onPress={() => { setTab("material"); setSub("all"); setManufacturer("all"); setUnit("all"); }} style={[styles.segBtn, tab === "material" && styles.segActive]} testID="tab-materials">
            <Text style={[styles.segText, tab === "material" && styles.segTextActive]}>Materiały</Text>
          </Pressable>
          <Pressable onPress={() => { setTab("labor"); setSub("all"); setManufacturer("all"); setUnit("all"); }} style={[styles.segBtn, tab === "labor" && styles.segActive]} testID="tab-labor">
            <Text style={[styles.segText, tab === "labor" && styles.segTextActive]}>Usługi</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => { haptic("light"); router.push(`/catalog-import?type=${tab}`); }} style={styles.iconBtn} testID="open-import">
          <FileArrowUp size={22} color={colors.onSurface} weight="bold" />
        </Pressable>
        <VoiceEditButton context="catalog" onAppliedCatalog={refetchAll} compact testID="catalog-voice" />
      </View>

      <View style={styles.searchWrap}>
        <MagnifyingGlass size={18} color={colors.muted} weight="bold" />
        <TextInput value={search} onChangeText={setSearch} placeholder="Szukaj: nazwa, producent, SKU, EAN, parametr..." placeholderTextColor={colors.muted} style={styles.searchInput} testID="catalog-search" />
        {search ? <Pressable onPress={() => setSearch("")} hitSlop={8} testID="catalog-search-clear"><X size={18} color={colors.muted} weight="bold" /></Pressable> : null}
      </View>

      <View style={styles.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {cats.map((t) => (
            <Pressable key={t} onPress={() => { haptic("light"); setCat(t); setSub("all"); }} style={[styles.chip, cat === t && styles.chipActive]} testID={`cat-${t}`}>
              <Text style={[styles.chipText, cat === t && styles.chipTextActive]} numberOfLines={1}>{t === "all" ? "Wszystkie" : mainCategoryLabel(t)}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => { haptic("light"); setFiltersOpen(true); }} style={[styles.chip, styles.filterChip]} testID="open-filters">
            <FunnelSimple size={16} color={colors.onSurface} weight="bold" />
            <Text style={styles.chipText}>Filtry{activeFilters ? ` (${activeFilters})` : ""}</Text>
          </Pressable>
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
          const net = tab === "material" ? item.unit_price : item.rate;
          const vat = item.vat_rate ?? 23;
          const gross = tab === "material" ? Math.round((net || 0) * (1 + vat / 100) * 100) / 100 : null;
          const meta = [item.manufacturer, item.sku, item.ean, item.specs].filter(Boolean).join(" · ");
          const inactive = item.status === "inactive";
          const dateTxt = item.price_updated_at ? String(item.price_updated_at).slice(0, 10) : null;
          return (
            <Card onPress={() => router.push(`/catalog-form?type=${tab}&id=${id}`)} testID={`catalog-item-${id}`} style={{ padding: 0, opacity: inactive ? 0.55 : 1 }}>
              <View style={styles.itemRow}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.itemUnit}>{item.unit}{item.subcategory ? ` · ${item.subcategory}` : ""}</Text>
                  {meta ? <Text style={styles.itemSpecs} numberOfLines={1}>{meta}</Text> : null}
                  <View style={styles.itemMetaRow}>
                    {item.price_source_label ? <Text style={styles.srcTxt}>źródło: {item.price_source_label}</Text> : null}
                    {dateTxt ? <Text style={styles.srcTxt}>· {dateTxt}</Text> : null}
                  </View>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Money style={styles.itemPrice}>{pln(net)}</Money>
                  {gross != null ? <Text style={styles.grossTxt}>brutto {pln(gross)}</Text> : null}
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 2 }}>
                    {item.price_is_example ? <Badge label="przykładowa" kind="warning" /> : null}
                    {inactive ? <Badge label="nieaktywna" kind="danger" /> : null}
                    <Pressable onPress={() => toggleStatus(item)} hitSlop={8} testID={`toggle-status-${id}`}>
                      <Power size={20} color={inactive ? colors.muted : colors.success} weight="bold" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={active.isLoading ? <Loading /> : <EmptyState title="Brak pozycji" subtitle={search || cat !== "all" ? "Zmień filtry lub wyszukiwanie" : "Dodaj pozycję przyciskiem poniżej"} />}
      />

      <Pressable onPress={() => { haptic("light"); router.push(`/catalog-form?type=${tab}`); }} style={styles.fab} testID="add-catalog-fab">
        <Plus size={22} color={colors.onBrandPrimary} weight="bold" />
        <Text style={styles.fabText}>DODAJ</Text>
      </Pressable>

      {/* ADVANCED FILTERS SHEET */}
      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Filtry i sortowanie</Text>
              <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10} testID="close-filters"><X size={24} color={colors.onSurface} weight="bold" /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
              <View style={{ gap: 8 }}>
                <View style={styles.fRow}><ArrowsDownUp size={16} color={colors.onSurface} weight="bold" /><Text style={styles.fLabel}>Sortowanie</Text></View>
                <View style={styles.wrap}>
                  {([["name", "Nazwa A-Z"], ["price_asc", "Cena ↑"], ["price_desc", "Cena ↓"]] as [SortKey, string][]).map(([k, l]) => (
                    <Pressable key={k} onPress={() => setSort(k)} style={[styles.fChip, sort === k && styles.fChipOn]} testID={`sort-${k}`}><Text style={[styles.fChipText, sort === k && styles.fChipTextOn]}>{l}</Text></Pressable>
                  ))}
                </View>
              </View>

              {tab === "material" ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.fLabel}>Producent</Text>
                  <View style={styles.wrap}>
                    {manufacturers.map((m) => (
                      <Pressable key={m} onPress={() => setManufacturer(m)} style={[styles.fChip, manufacturer === m && styles.fChipOn]} testID={`man-${m}`}><Text style={[styles.fChipText, manufacturer === m && styles.fChipTextOn]}>{m === "all" ? "Wszyscy" : m}</Text></Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ gap: 8 }}>
                <Text style={styles.fLabel}>Jednostka</Text>
                <View style={styles.wrap}>
                  {units.map((u) => (
                    <Pressable key={u} onPress={() => setUnit(u)} style={[styles.fChip, unit === u && styles.fChipOn]} testID={`unit-${u}`}><Text style={[styles.fChipText, unit === u && styles.fChipTextOn]}>{u === "all" ? "Wszystkie" : u}</Text></Pressable>
                  ))}
                </View>
              </View>

              <Pressable onPress={() => setShowInactive((v) => !v)} style={[styles.toggleRow, showInactive && styles.toggleRowOn]} testID="toggle-inactive">
                <Text style={styles.fLabel}>Pokaż nieaktywne</Text>
                <View style={[styles.switch, showInactive && styles.switchOn]}><View style={[styles.knob, showInactive && styles.knobOn]} /></View>
              </Pressable>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Button label="Wyczyść" variant="secondary" onPress={() => { setCat("all"); setSub("all"); setManufacturer("all"); setUnit("all"); setSort("name"); setShowInactive(false); }} testID="clear-filters" /></View>
                <View style={{ flex: 1 }}><Button label="Zastosuj" onPress={() => setFiltersOpen(false)} testID="apply-filters" /></View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  iconBtn: { width: 44, height: 44, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, height: 46, backgroundColor: colors.surfaceSecondary },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, padding: 0 },
  chipWrap: { height: 52, justifyContent: "center" },
  subWrap: { height: 44, justifyContent: "center" },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, maxWidth: 220 },
  chipActive: { backgroundColor: colors.brandPrimary },
  filterChip: { flexDirection: "row", gap: 6, backgroundColor: colors.surfaceSecondary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },
  subChip: { flexShrink: 0, height: 30, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  subActive: { backgroundColor: colors.surfaceInverse },
  subText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurface },
  subTextActive: { color: colors.onSurfaceInverse },
  itemRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  itemMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  itemUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textTransform: "uppercase" },
  itemSpecs: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  srcTxt: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  itemPrice: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  grossTxt: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  fab: { position: "absolute", right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 20, height: 56 },
  fabText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 3, borderColor: colors.borderStrong, maxHeight: "85%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 2, borderColor: colors.borderStrong },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface },
  fRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fChip: { height: 40, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  fChipOn: { backgroundColor: colors.brandPrimary },
  fChipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  fChipTextOn: { color: colors.onBrandPrimary },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 2, borderColor: colors.borderStrong, padding: 12, backgroundColor: colors.surfaceSecondary },
  toggleRowOn: { backgroundColor: colors.brandSecondary },
  switch: { width: 48, height: 28, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: "center", padding: 2 },
  switchOn: { backgroundColor: colors.brandPrimary },
  knob: { width: 18, height: 18, backgroundColor: colors.borderStrong },
  knobOn: { alignSelf: "flex-end", backgroundColor: colors.onBrandPrimary },
}));
