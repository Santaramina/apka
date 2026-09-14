import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { GearSix, Plus } from "phosphor-react-native";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Card, EmptyState, Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { pln } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

const CATS = [
  { key: "all", label: "Wszystkie" },
  { key: "elektryka", label: "Elektryka" },
  { key: "hydraulika", label: "Hydraulika" },
  { key: "wykonczenia", label: "Wykończenia" },
  { key: "ogolnobudowlana", label: "Ogólnobud." },
];

export default function Catalog() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<"material" | "labor">("material");
  const [cat, setCat] = useState("all");

  const materials = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch("/materials") });
  const labor = useQuery({ queryKey: ["labor-rates"], queryFn: () => apiFetch("/labor-rates") });

  const active = tab === "material" ? materials : labor;
  const raw = active.data ?? [];
  const list = cat === "all" ? raw : raw.filter((x: any) => x.category === cat);

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

      <View style={styles.segment}>
        <Pressable onPress={() => setTab("material")} style={[styles.segBtn, tab === "material" && styles.segActive]} testID="tab-materials">
          <Text style={[styles.segText, tab === "material" && styles.segTextActive]}>Materiały</Text>
        </Pressable>
        <Pressable onPress={() => setTab("labor")} style={[styles.segBtn, tab === "labor" && styles.segActive]} testID="tab-labor">
          <Text style={[styles.segText, tab === "labor" && styles.segTextActive]}>Robocizna</Text>
        </Pressable>
      </View>

      <View style={styles.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {CATS.map((c) => (
            <Pressable key={c.key} onPress={() => setCat(c.key)} style={[styles.chip, cat === c.key && styles.chipActive]} testID={`cat-${c.key}`}>
              <Text style={[styles.chipText, cat === c.key && styles.chipTextActive]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={list}
        keyExtractor={(i) => i.material_id || i.labor_id}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 10 }}
        refreshControl={<RefreshControl refreshing={active.isRefetching} onRefresh={active.refetch} tintColor={colors.brandPrimary} />}
        renderItem={({ item }) => {
          const id = item.material_id || item.labor_id;
          const price = tab === "material" ? item.unit_price : item.rate;
          return (
            <Card onPress={() => router.push(`/catalog-form?type=${tab}&id=${id}`)} testID={`catalog-item-${id}`} style={{ padding: 0 }}>
              <View style={styles.itemRow}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.itemUnit}>{item.unit}</Text>
                </View>
                <Money style={styles.itemPrice}>{pln(price)}</Money>
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={active.isLoading ? <Loading /> : <EmptyState title="Brak pozycji" subtitle="Dodaj pozycję przyciskiem poniżej" />}
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
  segment: { flexDirection: "row", marginHorizontal: 16, marginTop: 12, borderWidth: 2, borderColor: colors.borderStrong },
  segBtn: { flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surface },
  segActive: { backgroundColor: colors.brandSecondary },
  segText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  segTextActive: { color: "#FFFFFF" },
  chipWrap: { height: 56, justifyContent: "center" },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },
  itemRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  itemUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textTransform: "uppercase" },
  itemPrice: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  fab: { position: "absolute", right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 20, height: 56 },
  fabText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },
}));
