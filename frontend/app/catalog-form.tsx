import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Trash } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Button, Field, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { MAIN_CATEGORIES } from "@/src/lib/catalog";
import { UNITS, pln } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

const VAT_RATES = [23, 8, 5, 0];

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
  const [mainCat, setMainCat] = useState("elektryka");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState(isMaterial ? "szt" : "godz");
  const [price, setPrice] = useState("");
  const [vat, setVat] = useState(23);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [priceSource, setPriceSource] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  // material-only
  const [manufacturer, setManufacturer] = useState("");
  const [sku, setSku] = useState("");
  const [ean, setEan] = useState("");
  const [specs, setSpecs] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  // labor-only
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [includesMaterials, setIncludesMaterials] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name || "");
      setMainCat(existing.main_category || existing.trade || "elektryka");
      setSubcategory(existing.subcategory || "");
      setUnit(existing.unit || (isMaterial ? "szt" : "godz"));
      setPrice(String(isMaterial ? existing.unit_price : existing.rate));
      setVat(existing.vat_rate ?? 23);
      setDescription(existing.description || "");
      setNotes(existing.notes || "");
      setPriceSource(existing.price_source_label || "");
      setStatus(existing.status === "inactive" ? "inactive" : "active");
      setManufacturer(existing.manufacturer || "");
      setSku(existing.sku || "");
      setEan(existing.ean || "");
      setSpecs(existing.specs || "");
      setSourceUrl(existing.source_url || "");
      setRateMin(existing.rate_min != null ? String(existing.rate_min) : "");
      setRateMax(existing.rate_max != null ? String(existing.rate_max) : "");
      setIncludesMaterials(!!existing.includes_materials);
    }
  }, [existing]);

  const num = (s: string) => parseFloat(s.replace(",", ".")) || 0;
  const gross = isMaterial ? Math.round(num(price) * (1 + vat / 100) * 100) / 100 : 0;

  const save = async () => {
    if (!name.trim()) { toast.show("Podaj nazwę", "error"); return; }
    setBusy(true);
    try {
      const body: any = {
        name, main_category: mainCat, trade: mainCat, subcategory, unit,
        description, notes, price_source_label: priceSource, status,
      };
      if (isMaterial) {
        body.unit_price = num(price); body.vat_rate = vat;
        body.manufacturer = manufacturer; body.sku = sku; body.ean = ean; body.specs = specs; body.source_url = sourceUrl;
      } else {
        body.rate = num(price);
        body.rate_min = rateMin ? num(rateMin) : null;
        body.rate_max = rateMax ? num(rateMax) : null;
        body.includes_materials = includesMaterials;
      }
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
        title={editing ? "Edytuj pozycję" : isMaterial ? "Nowy materiał" : "Nowa usługa"}
        back
        right={editing ? (<Pressable onPress={remove} hitSlop={10} testID="delete-catalog"><Trash size={24} color={colors.error} weight="bold" /></Pressable>) : undefined}
      />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 16 }} bottomOffset={80}>
        <Field label="Nazwa" value={name} onChangeText={setName} placeholder={isMaterial ? "Przewód YDYp 3x2,5" : "Punkt elektryczny podtynkowy"} testID="catalog-name" />

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Kategoria główna</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrapH}>
            {MAIN_CATEGORIES.map((t) => (
              <Pressable key={t.key} onPress={() => { haptic("light"); setMainCat(t.key); }} style={[styles.chip, mainCat === t.key && styles.chipActive]} testID={`cf-cat-${t.key}`}>
                <Text style={[styles.chipText, mainCat === t.key && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Field label="Podkategoria (opcjonalnie)" value={subcategory} onChangeText={setSubcategory} placeholder={isMaterial ? "Przewody i kable" : "Instalacje"} testID="catalog-subcategory" />
        <Field label="Opis (opcjonalnie)" value={description} onChangeText={setDescription} placeholder="Krótki opis pozycji" multiline testID="catalog-description" />

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
            <Field label="Nr katalogowy / model (opcjonalnie)" value={sku} onChangeText={setSku} placeholder="np. 672510" testID="catalog-sku" />
            <Field label="Kod EAN (opcjonalnie)" value={ean} onChangeText={setEan} placeholder="np. 5901234123457" keyboardType="numeric" testID="catalog-ean" />
            <Field label="Parametry techniczne (opcjonalnie)" value={specs} onChangeText={setSpecs} placeholder="np. 3x2,5 mm²; 750V" testID="catalog-specs" />
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Stawka min (opcj.)" value={rateMin} onChangeText={setRateMin} placeholder="0,00" keyboardType="decimal-pad" testID="catalog-rate-min" /></View>
              <View style={{ flex: 1 }}><Field label="Stawka max (opcj.)" value={rateMax} onChangeText={setRateMax} placeholder="0,00" keyboardType="decimal-pad" testID="catalog-rate-max" /></View>
            </View>
            <Pressable onPress={() => setIncludesMaterials((v) => !v)} style={styles.switchRow} testID="catalog-includes-materials">
              <Text style={styles.switchLabel}>Cena zawiera materiały</Text>
              <Switch value={includesMaterials} onValueChange={setIncludesMaterials} trackColor={{ true: colors.brandPrimary, false: colors.divider }} />
            </Pressable>
          </>
        )}

        <Field label={isMaterial ? "Cena netto (PLN)" : "Stawka netto (PLN)"} value={price} onChangeText={setPrice} placeholder="0,00" keyboardType="decimal-pad" testID="catalog-price" />

        {isMaterial ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.label}>Stawka VAT (%)</Text>
            <View style={styles.wrap}>
              {VAT_RATES.map((v) => (
                <Pressable key={v} onPress={() => { haptic("light"); setVat(v); }} style={[styles.chip, vat === v && styles.chipActive]} testID={`cf-vat-${v}`}>
                  <Text style={[styles.chipText, vat === v && styles.chipTextActive]}>{v}%</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.grossHint}>Cena brutto (auto): {pln(gross)}</Text>
          </View>
        ) : null}

        <Field label="Źródło ceny (opcjonalnie)" value={priceSource} onChangeText={setPriceSource} placeholder="np. ręczne, import CSV, hurtownia" testID="catalog-price-source" />
        {isMaterial ? <Field label="Link do źródła (opcjonalnie)" value={sourceUrl} onChangeText={setSourceUrl} placeholder="https://..." autoCapitalize="none" testID="catalog-source-url" /> : null}
        <Field label="Uwagi (opcjonalnie)" value={notes} onChangeText={setNotes} placeholder="Dodatkowe uwagi" multiline testID="catalog-notes" />

        <Pressable onPress={() => setStatus((s) => (s === "active" ? "inactive" : "active"))} style={styles.switchRow} testID="catalog-status">
          <Text style={styles.switchLabel}>Pozycja aktywna</Text>
          <Switch value={status === "active"} onValueChange={(v) => setStatus(v ? "active" : "inactive")} trackColor={{ true: colors.brandPrimary, false: colors.divider }} />
        </Pressable>

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
  grossHint: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  exampleHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surfaceSecondary },
  switchLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  footer: { padding: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
}));
