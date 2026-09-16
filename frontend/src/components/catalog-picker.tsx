import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, X } from "phosphor-react-native";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { haptic } from "@/src/components/ui";
import { pln } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export type CatalogPick = {
  kind: "material" | "labor";
  catalog_id: string;
  name: string;
  unit: string;
  price: number;
};

export function CatalogPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (p: CatalogPick) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"material" | "labor">("material");
  const [q, setQ] = useState("");

  const materials = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch("/materials"), enabled: visible });
  const labor = useQuery({ queryKey: ["labor-rates"], queryFn: () => apiFetch("/labor-rates"), enabled: visible });

  const list = useMemo(() => {
    const raw: any[] = (tab === "material" ? materials.data : labor.data) ?? [];
    const s = q.trim().toLowerCase();
    return raw
      .filter((x) => x.status !== "inactive")
      .filter((x) => {
        if (!s) return true;
        return `${x.name} ${x.manufacturer || ""} ${x.sku || ""} ${x.ean || ""} ${x.specs || ""}`.toLowerCase().includes(s);
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "pl"))
      .slice(0, 200);
  }, [tab, materials.data, labor.data, q]);

  const select = (item: any) => {
    haptic("success");
    onPick({
      kind: tab,
      catalog_id: item.material_id || item.labor_id,
      name: item.name,
      unit: item.unit || (tab === "labor" ? "godz" : "szt"),
      price: (tab === "material" ? item.unit_price : item.rate) || 0,
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.head}>
            <Text style={styles.title}>Wybierz z katalogu</Text>
            <Pressable onPress={onClose} hitSlop={10} testID="picker-close"><X size={24} color={colors.onSurface} weight="bold" /></Pressable>
          </View>
          <View style={styles.segment}>
            <Pressable onPress={() => setTab("material")} style={[styles.segBtn, tab === "material" && styles.segOn]} testID="picker-tab-material"><Text style={[styles.segText, tab === "material" && styles.segTextOn]}>Materiały</Text></Pressable>
            <Pressable onPress={() => setTab("labor")} style={[styles.segBtn, tab === "labor" && styles.segOn]} testID="picker-tab-labor"><Text style={[styles.segText, tab === "labor" && styles.segTextOn]}>Usługi</Text></Pressable>
          </View>
          <View style={styles.searchWrap}>
            <MagnifyingGlass size={18} color={colors.muted} weight="bold" />
            <TextInput value={q} onChangeText={setQ} placeholder="Szukaj w katalogu..." placeholderTextColor={colors.muted} style={styles.searchInput} autoFocus testID="picker-search" />
          </View>
          <FlatList
            data={list}
            keyExtractor={(i) => i.material_id || i.labor_id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 12, gap: 8 }}
            style={{ maxHeight: 460 }}
            renderItem={({ item }) => {
              const price = tab === "material" ? item.unit_price : item.rate;
              const meta = [item.manufacturer, item.sku, item.specs].filter(Boolean).join(" · ");
              return (
                <Pressable onPress={() => select(item)} style={styles.row} testID={`pick-${item.material_id || item.labor_id}`}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                    <Text style={styles.rowMeta}>{item.unit}{meta ? ` · ${meta}` : ""}</Text>
                  </View>
                  <Text style={styles.rowPrice}>{pln(price)}</Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>Brak pozycji</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 3, borderColor: colors.borderStrong, maxHeight: "88%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 2, borderColor: colors.borderStrong },
  title: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface },
  segment: { flexDirection: "row", borderWidth: 2, borderColor: colors.borderStrong, margin: 12, marginBottom: 0 },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surface },
  segOn: { backgroundColor: colors.brandSecondary },
  segText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  segTextOn: { color: "#FFFFFF" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, height: 46, backgroundColor: colors.surfaceSecondary },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, padding: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderColor: colors.borderStrong, padding: 12, backgroundColor: colors.surface },
  rowName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  rowPrice: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onSurface },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", padding: 24 },
}));
