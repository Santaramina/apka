import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Trash } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Button, Field, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { TRADES } from "@/src/lib/catalog";
import { UNITS } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function CatalogForm() {
  const { type, id } = useLocalSearchParams<{ type: "material" | "labor"; id?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editing = !!id;
  const isMaterial = type === "material";
  const listKey = isMaterial ? "materials" : "labor-rates";
  const endpoint = isMaterial ? "/materials" : "/labor-rates";

  const { data: list } = useQuery({ queryKey: [listKey], queryFn: () => apiFetch(endpoint), enabled: editing });
  const existing = editing ? (list ?? []).find((x: any) => (x.material_id || x.labor_id) === id) : null;

  const [name, setName] = useState("");
  const [trade, setTrade] = useState("elektryka");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState(isMaterial ? "szt" : "godz");
  const [price, setPrice] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [sku, setSku] = useState("");
  const [specs, setSpecs] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name || "");
      setTrade(existing.trade || existing.category || "elektryka");
      setSubcategory(existing.subcategory || "");
      setUnit(existing.unit || (isMaterial ? "szt" : "godz"));
      setPrice(String(isMaterial ? existing.unit_price : existing.rate));
      setManufacturer(existing.manufacturer || "");
      setSku(existing.sku || "");
      setSpecs(existing.specs || "");
    }
  }, [existing]);

  const save = async () => {
    if (!name.trim()) { toast.show("Podaj nazwę", "error"); return; }
    const priceNum = parseFloat(price.replace(",", ".")) || 0;
    setBusy(true);
    try {
      const body: any = { name, trade, subcategory, unit };
      if (isMaterial) { body.unit_price = priceNum; body.manufacturer = manufacturer; body.sku = sku; body.specs = specs; }
      else body.rate = priceNum;
      await apiFetch(editing ? `${endpoint}/${id}` : endpoint, { method: editing ? "PUT" : "POST", body });
      qc.invalidateQueries({ queryKey: [listKey] });
      haptic("success");
      toast.show("Zapisano", "success");
      router.canGoBack() ? router.back() : router.replace("/(tabs)/catalog");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await apiFetch(`${endpoint}/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: [listKey] });
      haptic("success");
      toast.show("Usunięto", "success");
      router.canGoBack() ? router.back() : router.replace("/(tabs)/catalog");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={editing ? "Edytuj pozycję" : isMaterial ? "Nowy materiał" : "Nowa stawka"}
        back
        right={editing ? (<Pressable onPress={remove} hitSlop={10} testID="delete-catalog"><Trash size={24} color={colors.error} weight="bold" /></Pressable>) : undefined}
      />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }} bottomOffset={80}>
        <Field label="Nazwa" value={name} onChangeText={setName} placeholder={isMaterial ? "Przewód YDYp 3x2,5" : "Punkt elektryczny podtynkowy"} testID="catalog-name" />

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Branża</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrapH}>
            {TRADES.map((t) => (
              <Pressable key={t.key} onPress={() => { haptic("light"); setTrade(t.key); }} style={[styles.chip, trade === t.key && styles.chipActive]} testID={`cf-trade-${t.key}`}>
                <Text style={[styles.chipText, trade === t.key && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Field label="Kategoria (opcjonalnie)" value={subcategory} onChangeText={setSubcategory} placeholder={isMaterial ? "Przewody i kable" : "Instalacje"} testID="catalog-subcategory" />

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Jednostka</Text>
          <View style={styles.wrap}>
            {UNITS.map((u) => (
              <Pressable key={u} onPress={() => { haptic("light"); setUnit(u); }} style={[styles.chip, unit === u && styles.chipActive]} testID={`cf-unit-${u}`}>
                <Text style={[styles.chipText, unit === u && styles.chipTextActive]}>{u}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {isMaterial ? (
          <>
            <Field label="Producent (opcjonalnie)" value={manufacturer} onChangeText={setManufacturer} placeholder="np. Legrand" testID="catalog-manufacturer" />
            <Field label="Model / EAN / SKU (opcjonalnie)" value={sku} onChangeText={setSku} placeholder="np. 672510" testID="catalog-sku" />
            <Field label="Parametry techniczne (opcjonalnie)" value={specs} onChangeText={setSpecs} placeholder="np. 3x2,5 mm²; 750V" testID="catalog-specs" />
          </>
        ) : null}

        <Field label={isMaterial ? "Cena netto (PLN)" : "Stawka netto (PLN)"} value={price} onChangeText={setPrice} placeholder="0,00" keyboardType="decimal-pad" testID="catalog-price" />
        {existing?.price_is_example ? <Text style={styles.exampleHint}>Obecna cena jest przykładowa. Zapis ustawi ją jako Twoją własną cenę.</Text> : null}
      </KeyboardAwareScrollView>
      <KeyboardStickyView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button label="Zapisz" onPress={save} loading={busy} testID="save-catalog" />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  wrapH: { flexDirection: "row", gap: 8, paddingRight: 8 },
  chip: { height: 44, paddingHorizontal: 16, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },
  exampleHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  footer: { padding: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
}));
