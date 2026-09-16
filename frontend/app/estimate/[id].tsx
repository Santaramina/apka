import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { ArrowClockwise, Camera, CheckSquare, FilePdf, Images, MagnifyingGlass, Minus, Plus, Square, Trash, WarningCircle, X } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, fileUrl, pdfUrl, uploadFile } from "@/src/api/client";
import { Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { VoiceEditButton } from "@/src/components/voice";
import { CatalogPicker, CatalogPick } from "@/src/components/catalog-picker";
import { PhotoViewer } from "@/src/components/photo-viewer";
import { useToast } from "@/src/components/toast";
import { KINDS, num, pln, statusLabel } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, radius, shadow, useTheme } from "@/src/theme";

type Item = {
  item_id: string;
  kind: string;
  name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  note?: string;
  source?: string;
  quantity_source?: string;
  quantity_basis?: string | null;
  price_source?: string | null;
  confidence?: number | null;
  catalog_id?: string | null;
  catalog_name?: string | null;
  requires_confirmation?: boolean;
  candidate_matches?: any[] | null;
  included_in_calc?: boolean;
};

type CalcMode = "labor_materials" | "labor_only" | "labor_selected_materials";
const CALC_MODES: { key: CalcMode; label: string; hint: string }[] = [
  { key: "labor_materials", label: "Robocizna + materiały", hint: "Wszystkie pozycje wliczone" },
  { key: "labor_only", label: "Tylko robocizna", hint: "Materiały widoczne, ale nieliczone" },
  { key: "labor_selected_materials", label: "Robocizna + wybrane materiały", hint: "Wybierz materiały do wliczenia" },
];
type Tab = "summary" | "items" | "photos" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Podsumowanie" },
  { key: "items", label: "Pozycje" },
  { key: "photos", label: "Zdjęcia" },
  { key: "settings", label: "Ustawienia" },
];

const parseNum = (s: string) => parseFloat(String(s).replace(",", ".")) || 0;
let tmpId = 0;

export default function EstimateEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery({
    queryKey: ["estimate", id],
    queryFn: () => apiFetch(`/estimates/${id}`),
    refetchInterval: (q: any) => (q.state.data?.analysis_status === "processing" ? 2500 : false),
  });

  const [tab, setTab] = useState<Tab>("summary");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [calcMode, setCalcMode] = useState<CalcMode>("labor_materials");
  const [markup, setMarkup] = useState("10");
  const [margin, setMargin] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [vat, setVat] = useState("23");
  const [status, setStatus] = useState("draft");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  const analysisStatus = data?.analysis_status ?? "completed";
  const materialsQ = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch("/materials") });
  const laborQ = useQuery({ queryKey: ["labor-rates"], queryFn: () => apiFetch("/labor-rates") });

  useEffect(() => {
    if (data && data.analysis_status !== "processing") {
      setTitle(data.title || "");
      setItems((data.items || []).map((it: any) => ({ ...it, quantity: String(it.quantity), unit_price: String(it.unit_price), included_in_calc: it.included_in_calc !== false })));
      setPhotos(Array.isArray(data.image_paths) ? data.image_paths : []);
      setCalcMode((data.calc_mode as CalcMode) || "labor_materials");
      setMarkup(String(data.markup_percent ?? 10));
      setMargin(String(data.margin_percent ?? 0));
      setDiscount(String(data.discount_percent ?? 0));
      setVat(String(data.vat_percent ?? 23));
      setStatus(data.status || "draft");
    }
  }, [data]);

  const materialCounts = (it: Item) => {
    if (calcMode === "labor_only") return false;
    if (calcMode === "labor_selected_materials") return it.included_in_calc !== false;
    return true;
  };

  const materialsCost = items.filter((i) => i.kind === "material" && materialCounts(i)).reduce((s, it) => s + parseNum(it.quantity) * parseNum(it.unit_price), 0);
  const allMaterialsCost = items.filter((i) => i.kind === "material").reduce((s, it) => s + parseNum(it.quantity) * parseNum(it.unit_price), 0);
  const excludedMaterialsCost = allMaterialsCost - materialsCost;
  const laborCost = items.filter((i) => i.kind === "labor").reduce((s, it) => s + parseNum(it.quantity) * parseNum(it.unit_price), 0);
  const extraCost = items.filter((i) => i.kind === "extra").reduce((s, it) => s + parseNum(it.quantity) * parseNum(it.unit_price), 0);
  const subtotal = materialsCost + laborCost + extraCost;
  const markupVal = (subtotal * parseNum(markup)) / 100;
  const marginVal = (subtotal * parseNum(margin)) / 100;
  const beforeDiscount = subtotal + markupVal + marginVal;
  const discountVal = (beforeDiscount * parseNum(discount)) / 100;
  const net = beforeDiscount - discountVal;
  const vatVal = (net * parseNum(vat)) / 100;
  const gross = net + vatVal;
  const profit = net - subtotal;

  const readCount = items.filter((i) => i.quantity_source === "ai_read").length;
  const estimatedCount = items.filter((i) => i.quantity_source === "ai_estimated").length;
  const confirmCount = items.filter((i) => i.requires_confirmation).length;

  const updateItem = (idx: number, patch: Partial<Item>) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const editQty = (idx: number, t: string) => updateItem(idx, { quantity: t, quantity_source: "user" });
  const editPrice = (idx: number, t: string) => updateItem(idx, { unit_price: t, price_source: "user", requires_confirmation: false });
  const removeItem = (idx: number) => { haptic("light"); setItems((arr) => arr.filter((_, i) => i !== idx)); };
  const bumpQty = (idx: number, delta: number) => {
    haptic("light");
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, quantity: String(Math.max(0, Math.round((parseNum(it.quantity) + delta) * 100) / 100)), quantity_source: "user" } : it)));
  };
  const addItem = () => {
    haptic("medium");
    setItems((arr) => [...arr, { item_id: `new_${tmpId++}`, kind: "material", name: "", unit: "szt", quantity: "1", unit_price: "0", source: "manual", quantity_source: "user", price_source: "user", confidence: null, catalog_id: null, catalog_name: null, included_in_calc: true }]);
  };

  const addFromCatalog = (p: CatalogPick) => {
    haptic("success");
    setItems((arr) => [...arr, {
      item_id: `new_${tmpId++}`,
      kind: p.kind === "labor" ? "labor" : "material",
      name: p.name,
      unit: p.unit,
      quantity: "1",
      unit_price: String(p.price),
      source: "catalog",
      quantity_source: "user",
      price_source: "catalog",
      confidence: null,
      catalog_id: p.catalog_id,
      catalog_name: p.name,
      requires_confirmation: false,
      included_in_calc: true,
    }]);
  };

  const applyVoiceEstimate = (actions: any[]) => {
    haptic("success");
    setItems((arr) => {
      let next = arr.map((it) => ({ ...it }));
      const deleteIdx = new Set<number>();
      const adds: Item[] = [];
      for (const a of actions) {
        if (a.op === "set_price" && typeof a.index === "number") {
          next[a.index] = { ...next[a.index], unit_price: String(a.new_price), price_source: "user", requires_confirmation: false };
        } else if (a.op === "set_qty" && typeof a.index === "number") {
          next[a.index] = { ...next[a.index], quantity: String(a.quantity), quantity_source: "user" };
        } else if (a.op === "delete_item" && typeof a.index === "number") {
          deleteIdx.add(a.index);
        } else if (a.op === "add_item") {
          const kind = a.item_kind === "labor" ? "labor" : a.item_kind === "extra" ? "extra" : "material";
          adds.push({ item_id: `new_${tmpId++}`, kind, name: a.name || "Nowa pozycja", unit: a.unit || "szt", quantity: String(a.quantity ?? 1), unit_price: String(a.price ?? 0), source: "manual", quantity_source: "user", price_source: "user", confidence: null, catalog_id: null, catalog_name: null, requires_confirmation: false, included_in_calc: true });
        }
      }
      next = next.filter((_, i) => !deleteIdx.has(i));
      for (const a of actions) {
        if (a.op === "bump_prices") {
          const f = 1 + (a.percent || 0) / 100;
          const kind = a.item_kind || "all";
          next = next.map((it) => {
            if (kind === "labor" && it.kind !== "labor") return it;
            if (kind === "material" && it.kind !== "material") return it;
            return { ...it, unit_price: String(Math.round(parseNum(it.unit_price) * f * 100) / 100), price_source: "user" };
          });
        }
      }
      return [...next, ...adds];
    });
  };

  const applyCatalog = (idx: number, entry: any, kind: string) => {
    haptic("success");
    const price = kind === "labor" ? entry.rate : entry.unit_price;
    const cid = kind === "labor" ? entry.labor_id : entry.material_id;
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, unit_price: String(price), unit: entry.unit || it.unit, price_source: "catalog", catalog_id: cid, catalog_name: entry.name, name: it.name || entry.name, requires_confirmation: false } : it)));
    setPickerIdx(null);
    setSearch("");
  };

  const applyCandidate = (idx: number, cand: any) => {
    haptic("success");
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, unit_price: String(cand.unit_price), unit: cand.unit || it.unit, price_source: "catalog", catalog_id: cand.catalog_id, catalog_name: cand.catalog_name, requires_confirmation: false } : it)));
  };

  const retry = async () => {
    haptic("medium");
    try {
      await apiFetch(`/estimates/${id}/reanalyze`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["estimate", id] });
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const buildBody = (photoList = photos) => ({
    title,
    status,
    calc_mode: calcMode,
    image_paths: photoList,
    markup_percent: parseNum(markup),
    margin_percent: parseNum(margin),
    discount_percent: parseNum(discount),
    vat_percent: parseNum(vat),
    items: items.map((it) => ({
      item_id: it.item_id.startsWith("new_") ? undefined : it.item_id,
      kind: it.kind,
      name: it.name || "Pozycja",
      unit: it.unit,
      quantity: parseNum(it.quantity),
      unit_price: parseNum(it.unit_price),
      note: it.note || "",
      source: it.source || "manual",
      quantity_source: it.quantity_source || "user",
      quantity_basis: it.quantity_basis ?? null,
      price_source: it.price_source ?? null,
      confidence: it.confidence ?? null,
      catalog_id: it.catalog_id ?? null,
      catalog_name: it.catalog_name ?? null,
      requires_confirmation: it.requires_confirmation ?? false,
      candidate_matches: it.candidate_matches ?? null,
      included_in_calc: it.included_in_calc !== false,
    })),
  });

  const save = async (silent = false, photoList = photos) => {
    setBusy(true);
    try {
      await apiFetch(`/estimates/${id}`, { method: "PUT", body: buildBody(photoList) });
      qc.invalidateQueries({ queryKey: ["estimate", id] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      if (!silent) { haptic("success"); toast.show("Zapisano kosztorys", "success"); }
      return true;
    } catch (e: any) {
      toast.show(e.message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addPhotos = async (fromCamera: boolean) => {
    haptic(fromCamera ? "heavy" : "light");
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) { toast.show(fromCamera ? "Włącz dostęp do aparatu w Ustawieniach" : "Włącz dostęp do zdjęć w Ustawieniach", "error"); Linking.openSettings(); }
      else toast.show(fromCamera ? "Potrzebny dostęp do aparatu" : "Potrzebny dostęp do galerii", "info");
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.5 });
    if (res.canceled) return;
    setAddingPhoto(true);
    try {
      const newPaths: string[] = [];
      for (let i = 0; i < res.assets.length; i++) {
        let jpegUri = res.assets[i].uri;
        try {
          const ctx = ImageManipulator.manipulate(res.assets[i].uri);
          const rendered = await ctx.renderAsync();
          const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
          jpegUri = out.uri;
        } catch {}
        try {
          const up = await uploadFile(jpegUri, `zdjecie_${Date.now()}_${i}.jpg`, "image/jpeg");
          newPaths.push(up.path);
        } catch {
          toast.show(`Nie udało się przesłać zdjęcia ${i + 1}`, "error");
        }
      }
      if (newPaths.length) {
        const updated = [...photos, ...newPaths];
        setPhotos(updated);
        await save(true, updated);
        toast.show(newPaths.length === 1 ? "Dodano zdjęcie" : `Dodano ${newPaths.length} zdjęcia`, "success");
      }
    } finally {
      setAddingPhoto(false);
    }
  };

  const deletePhoto = async (idx: number) => {
    const updated = photos.filter((_, i) => i !== idx);
    setPhotos(updated);
    setViewerIdx(null);
    await save(true, updated);
    toast.show("Usunięto zdjęcie", "success");
  };

  const sharePdf = async () => {
    haptic("medium");
    if (confirmCount > 0) {
      toast.show(
        confirmCount === 1
          ? "1 pozycja wymaga potwierdzenia ceny. Uzupełnij cenę, aby wygenerować PDF."
          : `${confirmCount} pozycji wymaga potwierdzenia ceny. Uzupełnij ceny, aby wygenerować PDF.`,
        "error"
      );
      return;
    }
    const ok = await save(true);
    if (!ok) return;
    const url = pdfUrl(id);
    try {
      if (Platform.OS === "web") { window.open(url, "_blank"); return; }
      const target = FileSystem.cacheDirectory + `oferta_${id}.pdf`;
      const { uri, status: st } = await FileSystem.downloadAsync(url, target);
      if (st === 409) { toast.show("Kosztorys zawiera pozycje wymagające potwierdzenia ceny.", "error"); return; }
      if (st >= 400) { toast.show("Nie udało się otworzyć PDF", "error"); return; }
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch (e: any) {
      toast.show("Nie udało się otworzyć PDF", "error");
    }
  };

  if (isLoading || !data) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Kosztorys" back />
        <Loading />
      </View>
    );
  }

  if (analysisStatus === "processing") {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Analiza AI" subtitle={data.title || ""} back />
        <View style={styles.centerBox} testID="analysis-processing">
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.centerTitle}>AI analizuje zakres prac{"\n"}i dobiera pozycje z katalogu...</Text>
          <Text style={styles.centerSub}>To może potrwać kilkanaście sekund</Text>
        </View>
      </View>
    );
  }

  if (analysisStatus === "failed") {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Analiza AI" back />
        <View style={styles.centerBox} testID="analysis-failed">
          <WarningCircle size={56} color={colors.error} weight="fill" />
          <Text style={styles.centerTitle}>Analiza nie powiodła się</Text>
          <Text style={styles.centerSub}>{data.analysis_error || "Spróbuj ponownie"}</Text>
          <Pressable onPress={retry} style={styles.retryBtn} testID="retry-analysis">
            <ArrowClockwise size={20} color={colors.onBrandPrimary} weight="bold" />
            <Text style={styles.retryText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Edytor kosztorysu" subtitle={data.client?.name || ""} back />

      {/* Title card */}
      <View style={styles.titleCard}>
        <TextInput value={title} onChangeText={setTitle} style={styles.titleInput} placeholder="Tytuł kosztorysu" placeholderTextColor={colors.muted} testID="estimate-title" />
        <View style={[styles.statusPill, { backgroundColor: colors.brandTertiary }]}>
          <Text style={styles.statusPillText}>{statusLabel(status).toUpperCase()}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => { haptic("light"); setTab(t.key); }} style={styles.tabBtn} testID={`tab-${t.key}`}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
            {tab === t.key ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        ))}
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }} bottomOffset={160}>
        {/* ---------------- SUMMARY ---------------- */}
        {tab === "summary" ? (
          <>
            {data.scope_summary ? (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>OPIS (AI)</Text>
                <Text style={styles.scopeText}>{data.scope_summary}</Text>
              </View>
            ) : null}

            {photos.length > 0 ? (
              <View style={styles.photoStrip}>
                {photos.slice(0, 4).map((p, i) => (
                  <Pressable key={i} onPress={() => setViewerIdx(i)} style={styles.photoThumbSm} testID={`summary-photo-${i}`}>
                    <Image source={{ uri: fileUrl(p) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
                    {i === 3 && photos.length > 4 ? (
                      <View style={styles.photoMore}><Text style={styles.photoMoreText}>+{photos.length - 4}</Text></View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            {confirmCount > 0 ? (
              <View style={styles.confirmWarn} testID="confirm-warning">
                <WarningCircle size={20} color={colors.error} weight="fill" />
                <Text style={styles.confirmWarnText}>
                  {confirmCount === 1 ? "1 pozycja wymaga" : `${confirmCount} pozycji wymaga`} potwierdzenia ceny. Uzupełnij ceny, aby wygenerować ofertę PDF.
                </Text>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Statystyki pozycji</Text>
            <View style={styles.summaryRow} testID="source-summary">
              <View style={[styles.summaryChip, { backgroundColor: "#EAF2FB" }]}>
                <Text style={[styles.summaryNum, { color: colors.info }]}>{readCount}</Text>
                <Text style={styles.summaryLbl}>Odczytane</Text>
              </View>
              <View style={[styles.summaryChip, { backgroundColor: "#FBF4E6" }]}>
                <Text style={[styles.summaryNum, { color: colors.warning }]}>{estimatedCount}</Text>
                <Text style={styles.summaryLbl}>Szacowane</Text>
              </View>
              <View style={[styles.summaryChip, { backgroundColor: confirmCount > 0 ? "#FBEBEC" : colors.surfaceSecondary }]}>
                <Text style={[styles.summaryNum, { color: confirmCount > 0 ? colors.error : colors.muted }]}>{confirmCount}</Text>
                <Text style={styles.summaryLbl}>Wymaga potw.</Text>
              </View>
            </View>

            {/* Calc mode */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>SPOSÓB KALKULACJI</Text>
              {CALC_MODES.map((m) => (
                <Pressable key={m.key} onPress={() => { haptic("light"); setCalcMode(m.key); }} style={styles.calcOption} testID={`calc-${m.key}`}>
                  {calcMode === m.key ? <CheckSquare size={22} color={colors.brandPrimary} weight="fill" /> : <Square size={22} color={colors.muted} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.calcLabel, calcMode === m.key && { color: colors.brandPrimary }]}>{m.label}</Text>
                    <Text style={styles.calcHint}>{m.hint}</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            {/* Client totals */}
            <View style={styles.card}>
              <Row label="Suma robocizny" value={pln(laborCost)} />
              <Row label="Suma materiałów" value={pln(materialsCost)} />
              {excludedMaterialsCost > 0 ? <Text style={styles.excludedNote}>Materiały nieliczone: {pln(excludedMaterialsCost)}</Text> : null}
              {extraCost > 0 ? <Row label="Koszty dodatkowe" value={pln(extraCost)} /> : null}
              {parseNum(discount) > 0 ? <Row label={`Rabat (${num(parseNum(discount))}%)`} value={`- ${pln(discountVal)}`} /> : null}
              <Row label={`VAT (${num(parseNum(vat))}%)`} value={pln(vatVal)} />
              <View style={styles.grossRow}>
                <Text style={styles.grossLabel}>Do zapłaty (brutto)</Text>
                <Money style={styles.grossValue} testID="summary-gross">{pln(gross)}</Money>
              </View>
            </View>
          </>
        ) : null}

        {/* ---------------- ITEMS ---------------- */}
        {tab === "items" ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Pozycje ({items.length})</Text>
              <VoiceEditButton context="estimate" estimateItems={items.map((it) => ({ name: it.name, unit: it.unit, quantity: parseNum(it.quantity), unit_price: parseNum(it.unit_price), kind: it.kind }))} onApplyEstimate={applyVoiceEstimate} compact testID="estimate-voice" />
            </View>

            {items.map((it, idx) => {
              const lineTotal = parseNum(it.quantity) * parseNum(it.unit_price);
              const excluded = it.kind === "material" && !materialCounts(it);
              return (
                <View key={it.item_id} style={[styles.itemCard, excluded && styles.itemCardExcluded]} testID={`item-${idx}`}>
                  <View style={styles.itemTop}>
                    <TextInput value={it.name} onChangeText={(t) => updateItem(idx, { name: t })} placeholder="Nazwa pozycji" placeholderTextColor={colors.muted} style={styles.itemName} testID={`item-name-${idx}`} />
                    <Pressable onPress={() => removeItem(idx)} hitSlop={8} testID={`item-del-${idx}`}>
                      <Trash size={20} color={colors.error} weight="bold" />
                    </Pressable>
                  </View>

                  <View style={styles.kindRow}>
                    {KINDS.map((k) => (
                      <Pressable key={k.key} onPress={() => { haptic("light"); updateItem(idx, { kind: k.key }); }} style={[styles.kindChip, it.kind === k.key && styles.kindActive]}>
                        <Text style={[styles.kindText, it.kind === k.key && styles.kindTextActive]}>{k.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {calcMode === "labor_selected_materials" && it.kind === "material" ? (
                    <Pressable onPress={() => { haptic("light"); updateItem(idx, { included_in_calc: !(it.included_in_calc !== false) }); }} style={styles.inclRow} testID={`item-include-${idx}`}>
                      {it.included_in_calc !== false ? <CheckSquare size={20} color={colors.brandPrimary} weight="fill" /> : <Square size={20} color={colors.muted} />}
                      <Text style={[styles.inclText, it.included_in_calc !== false && { color: colors.brandPrimary }]}>Licz materiał w kwocie</Text>
                    </Pressable>
                  ) : null}

                  <View style={styles.badgeRow}>
                    <View style={[styles.srcBadge, { backgroundColor: it.quantity_source === "ai_estimated" ? "#FBF4E6" : it.quantity_source === "ai_read" ? "#EAF2FB" : colors.surfaceSecondary }]}>
                      <Text style={styles.srcBadgeText}>{it.quantity_source === "ai_estimated" ? "Ilość: szacowana" : it.quantity_source === "ai_read" ? "Ilość: odczytana" : "Ilość: ręczna"}</Text>
                    </View>
                    <View style={[styles.srcBadge, { backgroundColor: it.price_source === "catalog" ? "#E7F2EC" : it.requires_confirmation ? "#FBF4E6" : it.price_source === "user" ? colors.surfaceSecondary : "#FBEBEC" }]}>
                      <Text style={styles.srcBadgeText}>{it.price_source === "catalog" ? "Cena: katalog" : it.requires_confirmation ? "Wymaga potwierdzenia" : it.price_source === "user" ? "Cena: ręczna" : "Brak w katalogu"}</Text>
                    </View>
                    {typeof it.confidence === "number" ? (
                      <View style={[styles.srcBadge, { backgroundColor: colors.surfaceSecondary }]}>
                        <Text style={styles.srcBadgeText}>AI {Math.round(it.confidence * 100)}%</Text>
                      </View>
                    ) : null}
                  </View>

                  {it.catalog_name ? <Text style={styles.catNote}>≈ {it.catalog_name}</Text> : null}

                  {it.requires_confirmation && (it.candidate_matches?.length ?? 0) > 0 ? (
                    <View style={styles.confirmBox} testID={`item-confirm-${idx}`}>
                      <Text style={styles.confirmTitle}>Nie znaleziono pewnego dopasowania — wybierz pozycję:</Text>
                      {it.candidate_matches!.map((c: any) => (
                        <Pressable key={c.catalog_id} onPress={() => applyCandidate(idx, c)} style={styles.candRow} testID={`item-candidate-${idx}-${c.catalog_id}`}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.candName} numberOfLines={1}>{c.catalog_name}</Text>
                            <Text style={styles.candMeta}>{c.unit} · dopasowanie {Math.round((c.score || 0) * 100)}%</Text>
                          </View>
                          <Money style={styles.candPrice}>{pln(c.unit_price)}</Money>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.qtyBox}>
                    <Pressable onPress={() => bumpQty(idx, -1)} style={styles.qtyBtn} testID={`item-minus-${idx}`}><Minus size={18} color={colors.onSurface} weight="bold" /></Pressable>
                    <TextInput value={it.quantity} onChangeText={(t) => editQty(idx, t)} keyboardType="decimal-pad" style={styles.qtyInput} testID={`item-qty-${idx}`} />
                    <Pressable onPress={() => bumpQty(idx, 1)} style={styles.qtyBtn} testID={`item-plus-${idx}`}><Plus size={18} color={colors.onSurface} weight="bold" /></Pressable>
                  </View>

                  <View style={styles.priceRow}>
                    <TextInput value={it.unit} onChangeText={(t) => updateItem(idx, { unit: t })} style={styles.unitInput} testID={`item-unit-${idx}`} />
                    <Text style={styles.priceLabel}>Cena netto</Text>
                    <TextInput value={it.unit_price} onChangeText={(t) => editPrice(idx, t)} keyboardType="decimal-pad" style={styles.priceInput} testID={`item-price-${idx}`} />
                    <Text style={styles.priceUnit}>zł</Text>
                  </View>

                  {it.kind !== "extra" ? (
                    <Pressable onPress={() => { haptic("light"); setPickerIdx(idx); setSearch(""); }} style={styles.catalogBtn} testID={`item-catalog-${idx}`}>
                      <MagnifyingGlass size={16} color={colors.brandPrimary} weight="bold" />
                      <Text style={styles.catalogBtnText}>{it.price_source === "catalog" ? "Zmień pozycję z katalogu" : "Dopasuj z katalogu"}</Text>
                    </Pressable>
                  ) : null}

                  <View style={styles.lineTotalRow}>
                    <Text style={styles.lineTotalLabel}>{excluded ? "Wartość (nieliczona)" : "Wartość"}</Text>
                    <Money style={[styles.lineTotal, excluded && { color: colors.muted, textDecorationLine: "line-through" }]}>{pln(lineTotal)}</Money>
                  </View>
                </View>
              );
            })}

            <View style={styles.addRow}>
              <Pressable onPress={addItem} style={[styles.addItem, { flex: 1 }]} testID="add-item">
                <Plus size={20} color={colors.onSurface} weight="bold" />
                <Text style={styles.addItemText}>Własna pozycja</Text>
              </Pressable>
              <Pressable onPress={() => { haptic("light"); setPickerOpen(true); }} style={[styles.addItem, styles.addFromCat, { flex: 1 }]} testID="add-from-catalog">
                <MagnifyingGlass size={20} color={colors.onBrandPrimary} weight="bold" />
                <Text style={[styles.addItemText, { color: colors.onBrandPrimary }]}>Z katalogu</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {/* ---------------- PHOTOS ---------------- */}
        {tab === "photos" ? (
          <>
            <Text style={styles.sectionTitle}>Zdjęcia ({photos.length})</Text>
            <View style={styles.photoGrid}>
              {photos.map((p, i) => (
                <Pressable key={i} onPress={() => setViewerIdx(i)} style={styles.photoThumb} testID={`photo-${i}`}>
                  <Image source={{ uri: fileUrl(p) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
                  <Pressable onPress={() => deletePhoto(i)} style={styles.photoDel} hitSlop={6} testID={`photo-del-${i}`}>
                    <X size={14} color="#FFFFFF" weight="bold" />
                  </Pressable>
                </Pressable>
              ))}
            </View>
            {photos.length === 0 ? <Text style={styles.emptyPhotos}>Brak zdjęć. Dodaj zdjęcia z aparatu lub galerii.</Text> : null}
            <View style={styles.addRow}>
              <Pressable onPress={() => addPhotos(true)} style={[styles.addItem, { flex: 1 }]} disabled={addingPhoto} testID="add-photo-camera">
                <Camera size={20} color={colors.onSurface} weight="bold" />
                <Text style={styles.addItemText}>Aparat</Text>
              </Pressable>
              <Pressable onPress={() => addPhotos(false)} style={[styles.addItem, { flex: 1 }]} disabled={addingPhoto} testID="add-photo-gallery">
                <Images size={20} color={colors.onSurface} weight="bold" />
                <Text style={styles.addItemText}>Galeria</Text>
              </Pressable>
            </View>
            {addingPhoto ? <View style={styles.photoBusy}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.photoBusyText}>Przesyłanie zdjęć...</Text></View> : null}
          </>
        ) : null}

        {/* ---------------- SETTINGS ---------------- */}
        {tab === "settings" ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>NARZUT · MARŻA · RABAT · VAT</Text>
              <View style={styles.pctRow}>
                <View style={styles.pctItem}><Text style={styles.smallLabel}>Narzut %</Text><TextInput value={markup} onChangeText={setMarkup} keyboardType="decimal-pad" style={styles.pctInput} testID="markup-input" /></View>
                <View style={styles.pctItem}><Text style={styles.smallLabel}>Marża %</Text><TextInput value={margin} onChangeText={setMargin} keyboardType="decimal-pad" style={styles.pctInput} testID="margin-input" /></View>
                <View style={styles.pctItem}><Text style={styles.smallLabel}>Rabat %</Text><TextInput value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" style={styles.pctInput} testID="discount-input" /></View>
                <View style={styles.pctItem}><Text style={styles.smallLabel}>VAT %</Text><TextInput value={vat} onChangeText={setVat} keyboardType="decimal-pad" style={styles.pctInput} testID="vat-input" /></View>
              </View>
              <Text style={[styles.smallLabel, { marginTop: 4 }]}>Status</Text>
              <View style={styles.statusRow}>
                {["draft", "sent", "accepted"].map((s) => (
                  <Pressable key={s} onPress={() => { haptic("light"); setStatus(s); }} style={[styles.statusChip, status === s && styles.statusActive]} testID={`status-${s}`}>
                    <Text style={[styles.statusText, status === s && styles.statusTextActive]}>{statusLabel(s)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={[styles.cardLabel, { color: colors.brandPrimary }]}>KOSZTORYS WEWNĘTRZNY</Text>
              <Row label="Koszt materiałów" value={pln(materialsCost)} />
              <Row label="Koszt robocizny" value={pln(laborCost)} />
              {extraCost > 0 ? <Row label="Koszty dodatkowe" value={pln(extraCost)} /> : null}
              <Row label="Koszt bezpośredni" value={pln(subtotal)} bold />
              {parseNum(markup) > 0 ? <Row label={`Narzut (${num(parseNum(markup))}%)`} value={pln(markupVal)} /> : null}
              {parseNum(margin) > 0 ? <Row label={`Marża (${num(parseNum(margin))}%)`} value={pln(marginVal)} /> : null}
              {parseNum(discount) > 0 ? <Row label={`Rabat (${num(parseNum(discount))}%)`} value={`- ${pln(discountVal)}`} /> : null}
              <Row label="Netto" value={pln(net)} bold />
              <Row label={`VAT (${num(parseNum(vat))}%)`} value={pln(vatVal)} />
              <View style={styles.profitRow}>
                <Text style={styles.profitLabel}>Przewidywany zysk</Text>
                <Money style={styles.profitValue} testID="estimate-profit">{pln(profit)}</Money>
              </View>
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Sticky footer */}
      <KeyboardStickyView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.footerTotal}>
            <Text style={styles.footerLabel}>DO ZAPŁATY (brutto)</Text>
            <Money style={styles.footerGross} testID="total-gross">{pln(gross)}</Money>
          </View>
          <View style={styles.footerBtns}>
            <Pressable onPress={() => save()} style={[styles.footerBtn, styles.saveBtn]} disabled={busy} testID="save-estimate">
              <Text style={styles.saveBtnText}>{busy ? "..." : "Zapisz"}</Text>
            </Pressable>
            <Pressable onPress={sharePdf} style={[styles.footerBtn, styles.pdfBtn, confirmCount > 0 && styles.pdfBtnDisabled]} testID="generate-pdf">
              <FilePdf size={20} color={colors.onBrandPrimary} weight="bold" />
              <Text style={styles.pdfBtnText}>Generuj PDF</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>

      <CatalogPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addFromCatalog} />

      <PhotoViewer visible={viewerIdx !== null} uris={photos.map((p) => fileUrl(p))} initialIndex={viewerIdx ?? 0} onClose={() => setViewerIdx(null)} onDelete={deletePhoto} />

      <Modal visible={pickerIdx !== null} transparent animationType="slide" onRequestClose={() => setPickerIdx(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Wybierz z katalogu</Text>
              <Pressable onPress={() => setPickerIdx(null)} hitSlop={10} testID="picker-close"><X size={24} color={colors.onSurface} weight="bold" /></Pressable>
            </View>
            {pickerIdx !== null
              ? (() => {
                  const kind = items[pickerIdx].kind;
                  const source: any[] = kind === "labor" ? laborQ.data ?? [] : materialsQ.data ?? [];
                  const q = search.trim().toLowerCase();
                  const filtered = q ? source.filter((x) => (x.name || "").toLowerCase().includes(q)) : source;
                  return (
                    <>
                      <TextInput value={search} onChangeText={setSearch} placeholder="Szukaj pozycji..." placeholderTextColor={colors.muted} style={styles.modalSearch} testID="picker-search" />
                      <FlatList
                        data={filtered}
                        keyExtractor={(x: any) => x.material_id || x.labor_id}
                        keyboardShouldPersistTaps="handled"
                        style={{ maxHeight: 360 }}
                        renderItem={({ item: c }: any) => (
                          <Pressable onPress={() => applyCatalog(pickerIdx, c, kind)} style={styles.modalItem} testID={`picker-item-${c.material_id || c.labor_id}`}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.modalItemName} numberOfLines={1}>{c.name}</Text>
                              <Text style={styles.modalItemUnit}>{c.unit}</Text>
                            </View>
                            <Money style={styles.modalItemPrice}>{pln(kind === "labor" ? c.rate : c.unit_price)}</Money>
                          </Pressable>
                        )}
                        ListEmptyComponent={<Text style={styles.modalEmpty}>Brak pozycji w katalogu. Dodaj nową w zakładce „Baza".</Text>}
                      />
                      <Pressable onPress={() => { updateItem(pickerIdx, { price_source: "user" }); setPickerIdx(null); }} style={styles.manualBtn} testID="picker-manual">
                        <Text style={styles.manualBtnText}>Wpisz cenę ręcznie</Text>
                      </Pressable>
                    </>
                  );
                })()
              : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Money style={[styles.totalValue, bold && styles.totalBold]}>{value}</Money>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  smallLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted, letterSpacing: 0.2 },

  titleCard: { backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  titleInput: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  statusPillText: { fontFamily: fonts.bodySemi, fontSize: 10.5, color: colors.brandPrimary, letterSpacing: 0.5 },

  tabBar: { flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingHorizontal: 8 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  tabTextActive: { color: colors.brandPrimary },
  tabUnderline: { position: "absolute", bottom: 0, height: 3, width: "70%", borderRadius: 2, backgroundColor: colors.brandPrimary },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 8, ...shadow },
  cardLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.muted, letterSpacing: 1 },
  scopeText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurface, lineHeight: 21 },

  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface, letterSpacing: -0.3 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  photoStrip: { flexDirection: "row", gap: 8 },
  photoThumbSm: { width: 76, height: 76, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  photoMore: { ...abs(), backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center" },
  photoMoreText: { fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF" },

  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoThumb: { width: 104, height: 104, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  photoDel: { position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(15,23,42,0.6)", alignItems: "center", justifyContent: "center" },
  emptyPhotos: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 16 },
  photoBusy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 8 },
  photoBusyText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.muted },

  summaryRow: { flexDirection: "row", gap: 10 },
  summaryChip: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", gap: 2 },
  summaryNum: { fontFamily: fonts.displayBold, fontSize: 24 },
  summaryLbl: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.onSurfaceSecondary },

  calcOption: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  calcLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  calcHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 1 },

  excludedNote: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, fontStyle: "italic" },
  grossRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.brandTertiary, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, marginTop: 4 },
  grossLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.brandPrimary },
  grossValue: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.brandPrimary },

  itemCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, gap: 10, ...shadow },
  itemCardExcluded: { opacity: 0.7 },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.onSurface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 },
  kindRow: { flexDirection: "row", gap: 6 },
  kindChip: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  kindActive: { backgroundColor: colors.brandSecondary },
  kindText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurface },
  kindTextActive: { color: "#FFFFFF", fontFamily: fonts.bodySemi },
  inclRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  inclText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },

  qtyBox: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  qtyBtn: { width: 52, height: 48, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  qtyInput: { flex: 1, textAlign: "center", fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], fontSize: 16, color: colors.onSurface },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  unitInput: { width: 76, height: 46, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  priceLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, flex: 1 },
  priceInput: { minWidth: 96, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, height: 46, paddingHorizontal: 10, textAlign: "right", fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], fontSize: 16, color: colors.onSurface },
  priceUnit: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.muted },
  lineTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10 },
  lineTotalLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  lineTotal: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },

  addItem: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  addRow: { flexDirection: "row", gap: 10 },
  addFromCat: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  addItemText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },

  pctRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  pctItem: { flexGrow: 1, flexBasis: "45%", gap: 4 },
  pctInput: { borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, height: 46, textAlign: "center", fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], fontSize: 16, color: colors.onSurface },
  statusRow: { flexDirection: "row", gap: 8 },
  statusChip: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  statusActive: { backgroundColor: colors.brandPrimary },
  statusText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  statusTextActive: { color: colors.onBrandPrimary },

  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 1 },
  totalLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceSecondary },
  totalValue: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  totalBold: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onSurface },

  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider, padding: 14, gap: 10, ...shadow },
  footerTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  footerGross: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.onSurface },
  footerBtns: { flexDirection: "row", gap: 10 },
  footerBtn: { flex: 1, height: 54, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  saveBtn: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  saveBtnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  pdfBtn: { flex: 1.4, backgroundColor: colors.brandPrimary },
  pdfBtnDisabled: { opacity: 0.4 },
  pdfBtnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },

  confirmWarn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FBEBEC", borderRadius: radius.md, padding: 12 },
  confirmWarnText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, lineHeight: 18 },

  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 14 },
  centerTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, textAlign: "center", letterSpacing: -0.5 },
  centerSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: 20, height: 52, marginTop: 8 },
  retryText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },

  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  srcBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  srcBadgeText: { fontFamily: fonts.bodySemi, fontSize: 10.5, color: colors.onSurface, letterSpacing: 0.2 },
  catNote: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, fontStyle: "italic" },
  confirmBox: { borderRadius: radius.md, backgroundColor: "#FBF4E6", padding: 10, gap: 8 },
  confirmTitle: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.onSurface },
  candRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  candName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  candMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  candPrice: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onSurface },
  catalogBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: radius.md, backgroundColor: colors.brandTertiary },
  catalogBtnText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.brandPrimary },

  profitRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 4, paddingTop: 10 },
  profitLabel: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onSurface },
  profitValue: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.success },

  modalOverlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, gap: 12 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, letterSpacing: -0.5 },
  modalSearch: { borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, height: 48, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface },
  modalItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalItemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  modalItemUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  modalItemPrice: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onSurface },
  modalEmpty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 24 },
  manualBtn: { height: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  manualBtnText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
}));

function abs() {
  return { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };
}
