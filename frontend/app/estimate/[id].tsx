import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { ArrowClockwise, CaretDown, CaretUp, FilePdf, MagnifyingGlass, Minus, Plus, Trash, WarningCircle, X } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, fileUrl, pdfUrl } from "@/src/api/client";
import { Loading, Money, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { KINDS, UNITS, num, pln, statusLabel } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

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
  price_source?: string | null;
  confidence?: number | null;
  catalog_id?: string | null;
  catalog_name?: string | null;
};

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

  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [markup, setMarkup] = useState("10");
  const [margin, setMargin] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [vat, setVat] = useState("23");
  const [status, setStatus] = useState("draft");
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const analysisStatus = data?.analysis_status ?? "completed";
  const materialsQ = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch("/materials") });
  const laborQ = useQuery({ queryKey: ["labor-rates"], queryFn: () => apiFetch("/labor-rates") });

  useEffect(() => {
    if (data && data.analysis_status !== "processing") {
      setTitle(data.title || "");
      setItems((data.items || []).map((it: any) => ({ ...it, quantity: String(it.quantity), unit_price: String(it.unit_price) })));
      setMarkup(String(data.markup_percent ?? 10));
      setMargin(String(data.margin_percent ?? 0));
      setDiscount(String(data.discount_percent ?? 0));
      setVat(String(data.vat_percent ?? 23));
      setStatus(data.status || "draft");
    }
  }, [data]);

  const materialsCost = items.filter((i) => i.kind === "material").reduce((s, it) => s + parseNum(it.quantity) * parseNum(it.unit_price), 0);
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

  const updateItem = (idx: number, patch: Partial<Item>) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const editQty = (idx: number, t: string) => updateItem(idx, { quantity: t, quantity_source: "user" });
  const editPrice = (idx: number, t: string) => updateItem(idx, { unit_price: t, price_source: "user" });
  const removeItem = (idx: number) => { haptic("light"); setItems((arr) => arr.filter((_, i) => i !== idx)); };
  const bumpQty = (idx: number, delta: number) => {
    haptic("light");
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, quantity: String(Math.max(0, Math.round((parseNum(it.quantity) + delta) * 100) / 100)), quantity_source: "user" } : it)));
  };
  const addItem = () => {
    haptic("medium");
    setItems((arr) => [...arr, { item_id: `new_${tmpId++}`, kind: "material", name: "", unit: "szt", quantity: "1", unit_price: "0", source: "manual", quantity_source: "user", price_source: "user", confidence: null, catalog_id: null, catalog_name: null }]);
  };

  const applyCatalog = (idx: number, entry: any, kind: string) => {
    haptic("success");
    const price = kind === "labor" ? entry.rate : entry.unit_price;
    const cid = kind === "labor" ? entry.labor_id : entry.material_id;
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, unit_price: String(price), unit: entry.unit || it.unit, price_source: "catalog", catalog_id: cid, catalog_name: entry.name, name: it.name || entry.name } : it)));
    setPickerIdx(null);
    setSearch("");
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

  const buildBody = () => ({
    title,
    status,
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
      price_source: it.price_source ?? null,
      confidence: it.confidence ?? null,
      catalog_id: it.catalog_id ?? null,
      catalog_name: it.catalog_name ?? null,
    })),
  });

  const save = async (silent = false) => {
    setBusy(true);
    try {
      await apiFetch(`/estimates/${id}`, { method: "PUT", body: buildBody() });
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

  const sharePdf = async () => {
    haptic("medium");
    const ok = await save(true);
    if (!ok) return;
    const url = pdfUrl(id);
    try {
      if (Platform.OS === "web") { window.open(url, "_blank"); return; }
      const target = FileSystem.cacheDirectory + `oferta_${id}.pdf`;
      const { uri } = await FileSystem.downloadAsync(url, target);
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
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }} bottomOffset={160}>
        {/* Title */}
        <View style={{ gap: 6 }}>
          <Text style={styles.smallLabel}>Tytuł</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.titleInput} testID="estimate-title" />
        </View>

        {data.scope_summary ? (
          <View style={styles.scopeBox}>
            <Text style={styles.scopeLabel}>ZAKRES (AI)</Text>
            <Text style={styles.scopeText}>{data.scope_summary}</Text>
          </View>
        ) : null}

        {/* AI photos */}
        {Array.isArray(data.image_paths) && data.image_paths.length > 0 ? (
          <KeyboardAwareScrollViewInner paths={data.image_paths} />
        ) : null}

        <Text style={styles.section}>POZYCJE ({items.length})</Text>

        {items.map((it, idx) => {
          const lineTotal = parseNum(it.quantity) * parseNum(it.unit_price);
          return (
            <View key={it.item_id} style={styles.itemCard} testID={`item-${idx}`}>
              <View style={styles.itemTop}>
                <TextInput value={it.name} onChangeText={(t) => updateItem(idx, { name: t })} placeholder="Nazwa pozycji" placeholderTextColor={colors.muted} style={styles.itemName} testID={`item-name-${idx}`} />
                <Pressable onPress={() => removeItem(idx)} hitSlop={8} testID={`item-del-${idx}`}>
                  <Trash size={20} color={colors.error} weight="bold" />
                </Pressable>
              </View>

              {/* kind chips */}
              <View style={styles.kindRow}>
                {KINDS.map((k) => (
                  <Pressable key={k.key} onPress={() => { haptic("light"); updateItem(idx, { kind: k.key }); }} style={[styles.kindChip, it.kind === k.key && styles.kindActive]}>
                    <Text style={[styles.kindText, it.kind === k.key && styles.kindTextActive]}>{k.label}</Text>
                  </Pressable>
                ))}
              </View>

              {/* source badges */}
              <View style={styles.badgeRow}>
                <View style={[styles.srcBadge, { backgroundColor: it.quantity_source === "ai" ? colors.brandTertiary : colors.surfaceTertiary }]}>
                  <Text style={styles.srcBadgeText}>{it.quantity_source === "ai" ? "Ilość: AI (szac.)" : "Ilość: ręczna"}</Text>
                </View>
                <View style={[styles.srcBadge, { backgroundColor: it.price_source === "catalog" ? "#DCFCE7" : it.price_source === "user" ? colors.surfaceTertiary : "#FEE2E2" }]}>
                  <Text style={styles.srcBadgeText}>{it.price_source === "catalog" ? "Cena: katalog" : it.price_source === "user" ? "Cena: ręczna" : "Brak w katalogu"}</Text>
                </View>
                {typeof it.confidence === "number" ? (
                  <View style={[styles.srcBadge, { backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={styles.srcBadgeText}>AI {Math.round(it.confidence * 100)}%</Text>
                  </View>
                ) : null}
              </View>

              {it.catalog_name ? <Text style={styles.catNote}>≈ {it.catalog_name}</Text> : null}

              <View style={styles.qtyBox}>
                <Pressable onPress={() => bumpQty(idx, -1)} style={styles.qtyBtn} testID={`item-minus-${idx}`}><Minus size={18} color={colors.onSurface} weight="bold" /></Pressable>
                <TextInput value={it.quantity} onChangeText={(t) => editQty(idx, t)} keyboardType="decimal-pad" style={styles.qtyInput} testID={`item-qty-${idx}`} />
                <Pressable onPress={() => bumpQty(idx, 1)} style={styles.qtyBtn} testID={`item-plus-${idx}`}><Plus size={18} color={colors.onSurface} weight="bold" /></Pressable>
              </View>

              <View style={styles.priceRow}>
                <View style={styles.unitPick}>
                  <TextInput value={it.unit} onChangeText={(t) => updateItem(idx, { unit: t })} style={styles.unitInput} testID={`item-unit-${idx}`} />
                </View>
                <Text style={styles.priceLabel}>Cena netto</Text>
                <TextInput value={it.unit_price} onChangeText={(t) => editPrice(idx, t)} keyboardType="decimal-pad" style={styles.priceInput} testID={`item-price-${idx}`} />
                <Text style={styles.priceUnit}>zł</Text>
              </View>

              {it.kind !== "extra" ? (
                <Pressable onPress={() => { haptic("light"); setPickerIdx(idx); setSearch(""); }} style={styles.catalogBtn} testID={`item-catalog-${idx}`}>
                  <MagnifyingGlass size={16} color={colors.onSurface} weight="bold" />
                  <Text style={styles.catalogBtnText}>{it.price_source === "catalog" ? "Zmień pozycję z katalogu" : "Dopasuj z katalogu"}</Text>
                </Pressable>
              ) : null}

              <View style={styles.lineTotalRow}>
                <Text style={styles.lineTotalLabel}>Wartość</Text>
                <Money style={styles.lineTotal}>{pln(lineTotal)}</Money>
              </View>
            </View>
          );
        })}

        <Pressable onPress={addItem} style={styles.addItem} testID="add-item">
          <Plus size={20} color={colors.onSurface} weight="bold" />
          <Text style={styles.addItemText}>Dodaj pozycję</Text>
        </Pressable>

        {/* Settings collapsible */}
        <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.settingsToggle} testID="toggle-settings">
          <Text style={styles.settingsToggleText}>Narzut · Marża · Rabat · VAT · Status</Text>
          {showSettings ? <CaretUp size={20} color={colors.onSurface} weight="bold" /> : <CaretDown size={20} color={colors.onSurface} weight="bold" />}
        </Pressable>
        {showSettings ? (
          <View style={styles.settingsBox}>
            <View style={styles.pctRow}>
              <View style={styles.pctItem}><Text style={styles.smallLabel}>Narzut %</Text><TextInput value={markup} onChangeText={setMarkup} keyboardType="decimal-pad" style={styles.pctInput} testID="markup-input" /></View>
              <View style={styles.pctItem}><Text style={styles.smallLabel}>Marża %</Text><TextInput value={margin} onChangeText={setMargin} keyboardType="decimal-pad" style={styles.pctInput} testID="margin-input" /></View>
              <View style={styles.pctItem}><Text style={styles.smallLabel}>Rabat %</Text><TextInput value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" style={styles.pctInput} testID="discount-input" /></View>
              <View style={styles.pctItem}><Text style={styles.smallLabel}>VAT %</Text><TextInput value={vat} onChangeText={setVat} keyboardType="decimal-pad" style={styles.pctInput} testID="vat-input" /></View>
            </View>
            <Text style={styles.smallLabel}>Status</Text>
            <View style={styles.statusRow}>
              {["draft", "sent", "accepted"].map((s) => (
                <Pressable key={s} onPress={() => { haptic("light"); setStatus(s); }} style={[styles.statusChip, status === s && styles.statusActive]} testID={`status-${s}`}>
                  <Text style={[styles.statusText, status === s && styles.statusTextActive]}>{statusLabel(s)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Totals breakdown — wewnętrzne (widok wykonawcy) */}
        <View style={styles.totalsBox}>
          <Text style={styles.totalsHeader}>KOSZTORYS WEWNĘTRZNY</Text>
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
              <Text style={styles.saveBtnText}>{busy ? "..." : "ZAPISZ"}</Text>
            </Pressable>
            <Pressable onPress={sharePdf} style={[styles.footerBtn, styles.pdfBtn]} testID="generate-pdf">
              <FilePdf size={20} color={colors.onBrandPrimary} weight="bold" />
              <Text style={styles.pdfBtnText}>PDF</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>

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

function KeyboardAwareScrollViewInner({ paths }: { paths: string[] }) {
  const styles = useStyles();
  return (
    <View style={styles.photoStrip}>
      {paths.slice(0, 6).map((p, i) => (
        <View key={i} style={styles.photoThumb}>
          <Image source={{ uri: fileUrl(p) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  smallLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  titleInput: { borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, minHeight: 48, fontFamily: fonts.displayBold, fontSize: 17, color: colors.onSurface },
  scopeBox: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, padding: 12, gap: 6 },
  scopeLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.brandPrimary, letterSpacing: 1 },
  scopeText: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurface, lineHeight: 20 },
  photoStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoThumb: { width: 72, height: 72, borderWidth: 2, borderColor: colors.borderStrong, overflow: "hidden" },
  section: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 4 },

  itemCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: 12, gap: 10, backgroundColor: colors.surface },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.onSurface, borderBottomWidth: 2, borderBottomColor: colors.border, paddingVertical: 4 },
  kindRow: { flexDirection: "row", gap: 6 },
  kindChip: { flex: 1, paddingVertical: 7, borderWidth: 2, borderColor: colors.border, alignItems: "center", backgroundColor: colors.surface },
  kindActive: { backgroundColor: colors.brandSecondary, borderColor: colors.borderStrong },
  kindText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurface },
  kindTextActive: { color: "#FFFFFF", fontFamily: fonts.bodySemi },
  itemControls: { flexDirection: "row", gap: 10 },
  qtyBox: { flexDirection: "row", alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong },
  qtyBtn: { width: 52, height: 48, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  qtyInput: { flex: 1, textAlign: "center", fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], fontSize: 16, color: colors.onSurface },
  unitPick: { width: 80, borderWidth: 2, borderColor: colors.borderStrong },
  unitInput: { height: 46, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  priceLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, flex: 1 },
  priceInput: { minWidth: 96, borderWidth: 2, borderColor: colors.borderStrong, height: 46, paddingHorizontal: 10, textAlign: "right", fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], fontSize: 16, color: colors.onSurface },
  priceUnit: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.muted },
  lineTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 2, borderTopColor: colors.border, paddingTop: 8 },
  lineTotalLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted, textTransform: "uppercase" },
  lineTotal: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },

  addItem: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderWidth: 2, borderColor: colors.borderStrong, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary },
  addItemText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },

  settingsToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 52, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14, backgroundColor: colors.surface },
  settingsToggleText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  settingsBox: { borderWidth: 2, borderColor: colors.borderStrong, padding: 12, gap: 10, backgroundColor: colors.surfaceSecondary },
  pctRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  pctItem: { flexGrow: 1, flexBasis: "45%", gap: 4 },
  pctInput: { borderWidth: 2, borderColor: colors.borderStrong, height: 46, textAlign: "center", fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], fontSize: 16, color: colors.onSurface, backgroundColor: colors.surface },
  statusRow: { flexDirection: "row", gap: 8 },
  statusChip: { flex: 1, paddingVertical: 10, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", backgroundColor: colors.surface },
  statusActive: { backgroundColor: colors.brandPrimary },
  statusText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  statusTextActive: { color: colors.onBrandPrimary },

  totalsBox: { borderWidth: 2, borderColor: colors.border, padding: 12, gap: 6, marginTop: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceSecondary },
  totalValue: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  totalBold: { fontFamily: fonts.displayBold, fontSize: 15 },

  footer: { backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong, padding: 12, gap: 10 },
  footerTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  footerGross: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.onSurface },
  footerBtns: { flexDirection: "row", gap: 10 },
  footerBtn: { flex: 1, height: 54, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  saveBtn: { backgroundColor: colors.surface },
  saveBtnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface },
  pdfBtn: { backgroundColor: colors.brandPrimary },
  pdfBtnText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },

  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 14 },
  centerTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, textAlign: "center", letterSpacing: -0.5 },
  centerSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 20, height: 52, marginTop: 8 },
  retryText: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onBrandPrimary },

  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  srcBadge: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  srcBadgeText: { fontFamily: fonts.bodySemi, fontSize: 10.5, color: colors.onSurface, letterSpacing: 0.3 },
  catNote: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, fontStyle: "italic" },
  catalogBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderWidth: 2, borderColor: colors.borderStrong, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary },
  catalogBtnText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },

  totalsHeader: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.brandPrimary, letterSpacing: 1, marginBottom: 2 },
  profitRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 2, borderTopColor: colors.borderStrong, marginTop: 4, paddingTop: 8 },
  profitLabel: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onSurface, textTransform: "uppercase" },
  profitValue: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.success },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopWidth: 3, borderColor: colors.borderStrong, padding: 16, gap: 12 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, letterSpacing: -0.5 },
  modalSearch: { borderWidth: 2, borderColor: colors.borderStrong, height: 48, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface },
  modalItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalItemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  modalItemUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textTransform: "uppercase" },
  modalItemPrice: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onSurface },
  modalEmpty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center", paddingVertical: 24 },
  manualBtn: { height: 50, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  manualBtnText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
}));
