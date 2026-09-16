import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle, FileArrowUp, Warning } from "phosphor-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { uploadMultipart } from "@/src/api/client";
import { Button, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { IMPORT_FIELD_LABELS } from "@/src/lib/catalog";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

type Preview = {
  columns: string[];
  suggested_mapping: Record<string, string>;
  fields: string[];
  required: string[];
  sample_rows: Record<string, any>[];
  total_rows: number;
};
type Picked = { uri: string; name: string; mimeType: string };

export default function CatalogImport() {
  const { type } = useLocalSearchParams<{ type: "material" | "labor" }>();
  const kind = type === "labor" ? "labor" : "material";
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [file, setFile] = useState<Picked | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // fieldMapping: canonical field -> file column (inverse of backend mapping)
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const picked = { uri: a.uri, name: a.name || "cennik.csv", mimeType: a.mimeType || "text/csv" };
      setFile(picked);
      setPreview(null); setSummary(null);
      await runPreview(picked);
    } catch (e: any) {
      toast.show(e.message || "Nie udało się wybrać pliku", "error");
    }
  };

  const runPreview = async (picked: Picked) => {
    setBusy(true);
    try {
      const p = await uploadMultipart<Preview>("/catalog/import/preview", picked.uri, picked.name, picked.mimeType, { kind });
      setPreview(p);
      // build inverse mapping field->column from suggested (column->field)
      const inv: Record<string, string> = {};
      Object.entries(p.suggested_mapping).forEach(([col, f]) => { inv[f] = col; });
      setFieldMapping(inv);
      haptic("success");
    } catch (e: any) {
      toast.show(e.message || "Nie udało się odczytać pliku", "error");
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const setColForField = (field: string, col: string) => {
    setFieldMapping((m) => {
      const next = { ...m };
      if (next[field] === col) delete next[field];
      else next[field] = col;
      return next;
    });
  };

  const canImport = preview && (preview.required || []).every((f) => !!fieldMapping[f]);

  const doImport = async () => {
    if (!file || !preview) return;
    if (!canImport) { toast.show("Zmapuj wymagane pola (*)", "error"); return; }
    setBusy(true);
    try {
      // convert field->column back to column->field for backend
      const colMapping: Record<string, string> = {};
      Object.entries(fieldMapping).forEach(([f, col]) => { if (col) colMapping[col] = f; });
      const res = await uploadMultipart("/catalog/import/apply", file.uri, file.name, file.mimeType, {
        kind, mapping: JSON.stringify(colMapping), update_existing: String(updateExisting),
      });
      setSummary(res);
      haptic("success");
      toast.show(`Zaimportowano: +${res.created} / zaktualizowano ${res.updated}`, "success");
    } catch (e: any) {
      toast.show(e.message || "Import nie powiódł się", "error");
    } finally {
      setBusy(false);
    }
  };

  const fields = preview?.fields || [];

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Import ${kind === "labor" ? "usług" : "materiałów"}`} subtitle="CSV lub Excel" back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 16 }}>
        {!summary ? (
          <>
            <Pressable onPress={pick} style={styles.pickBox} testID="import-pick">
              <FileArrowUp size={28} color={colors.brandPrimary} weight="bold" />
              <Text style={styles.pickText}>{file ? file.name : "Wybierz plik CSV / Excel"}</Text>
              {file ? <Text style={styles.pickSub}>Dotknij, aby zmienić plik</Text> : <Text style={styles.pickSub}>Obsługa .csv, .xlsx</Text>}
            </Pressable>

            {preview ? (
              <>
                <View style={styles.infoRow}>
                  <Text style={styles.info}>Wykryto {preview.columns.length} kolumn · {preview.total_rows} wierszy</Text>
                </View>

                <Text style={styles.sectionTitle}>Mapowanie kolumn</Text>
                <Text style={styles.hint}>Przypisz kolumny z pliku do pól katalogu. Pola z * są wymagane.</Text>
                {fields.map((f) => (
                  <View key={f} style={styles.mapCard}>
                    <Text style={[styles.fieldName, preview.required.includes(f) && styles.fieldReq]}>{IMPORT_FIELD_LABELS[f] || f}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colRow}>
                      <Pressable onPress={() => setColForField(f, "")} style={[styles.colChip, !fieldMapping[f] && styles.colChipOn]} testID={`map-${f}-none`}>
                        <Text style={[styles.colChipText, !fieldMapping[f] && styles.colChipTextOn]}>—</Text>
                      </Pressable>
                      {preview.columns.map((c) => (
                        <Pressable key={c} onPress={() => setColForField(f, c)} style={[styles.colChip, fieldMapping[f] === c && styles.colChipOn]} testID={`map-${f}-${c}`}>
                          <Text style={[styles.colChipText, fieldMapping[f] === c && styles.colChipTextOn]} numberOfLines={1}>{c}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ))}

                <Pressable onPress={() => setUpdateExisting((v) => !v)} style={[styles.toggleRow, updateExisting && styles.toggleOn]} testID="toggle-update-existing">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Aktualizuj istniejące</Text>
                    <Text style={styles.toggleSub}>Dopasowanie po nr katalogowym / EAN / nazwie. Nic nie jest usuwane.</Text>
                  </View>
                  <View style={[styles.check, updateExisting && styles.checkOn]}>{updateExisting ? <CheckCircle size={18} color={colors.onBrandPrimary} weight="fill" /> : null}</View>
                </Pressable>

                <Text style={styles.sectionTitle}>Podgląd (pierwsze wiersze)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrap}>
                  <View>
                    <View style={styles.trHead}>
                      {preview.columns.map((c) => <Text key={c} style={styles.th} numberOfLines={1}>{c}</Text>)}
                    </View>
                    {preview.sample_rows.slice(0, 8).map((r, i) => (
                      <View key={i} style={styles.tr}>
                        {preview.columns.map((c) => <Text key={c} style={styles.td} numberOfLines={1}>{r[c] != null ? String(r[c]) : ""}</Text>)}
                      </View>
                    ))}
                  </View>
                </ScrollView>

                <Button label={busy ? "Importowanie..." : `Importuj ${preview.total_rows} wierszy`} onPress={doImport} loading={busy} disabled={!canImport} testID="do-import" />
                {!canImport ? <Text style={styles.warn}>Zmapuj wymagane pola oznaczone *</Text> : null}
              </>
            ) : null}
          </>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={styles.summaryCard}>
              <CheckCircle size={40} color={colors.success} weight="fill" />
              <Text style={styles.summaryTitle}>Import zakończony</Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}><Text style={styles.statNum}>{summary.created}</Text><Text style={styles.statLbl}>dodane</Text></View>
                <View style={styles.stat}><Text style={styles.statNum}>{summary.updated}</Text><Text style={styles.statLbl}>zaktualizowane</Text></View>
                <View style={styles.stat}><Text style={[styles.statNum, summary.skipped ? { color: colors.error } : null]}>{summary.skipped}</Text><Text style={styles.statLbl}>pominięte</Text></View>
              </View>
            </View>
            {summary.errors?.length ? (
              <View style={styles.errorsCard}>
                <View style={styles.fRow}><Warning size={18} color={colors.error} weight="bold" /><Text style={styles.errTitle}>Pominięte wiersze</Text></View>
                {summary.errors.map((e: any, i: number) => (
                  <Text key={i} style={styles.errItem}>Wiersz {e.row}: {e.error}</Text>
                ))}
              </View>
            ) : null}
            <Button label="Gotowe" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/catalog"); }} testID="import-done" />
            <Pressable onPress={() => { setSummary(null); setFile(null); setPreview(null); }} style={{ alignItems: "center", paddingVertical: 8 }}><Text style={styles.again}>Importuj kolejny plik</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  pickBox: { borderWidth: 2, borderColor: colors.borderStrong, borderStyle: "dashed", padding: 24, alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary },
  pickText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.onSurface, textAlign: "center" },
  pickSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  infoRow: { flexDirection: "row" },
  info: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface, marginTop: 6 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  mapCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: 10, gap: 8, backgroundColor: colors.surface },
  fieldName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  fieldReq: { color: colors.brandPrimary },
  colRow: { gap: 6, paddingRight: 6 },
  colChip: { height: 32, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, maxWidth: 160 },
  colChipOn: { backgroundColor: colors.brandPrimary },
  colChipText: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurface },
  colChipTextOn: { color: colors.onBrandPrimary },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderColor: colors.borderStrong, padding: 12, backgroundColor: colors.surfaceSecondary },
  toggleOn: { backgroundColor: colors.brandSecondary },
  toggleLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  toggleSub: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 2 },
  check: { width: 26, height: 26, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  checkOn: { backgroundColor: colors.brandPrimary },
  tableWrap: { borderWidth: 2, borderColor: colors.borderStrong, maxHeight: 220 },
  trHead: { flexDirection: "row", backgroundColor: colors.surfaceInverse },
  th: { width: 120, padding: 8, fontFamily: fonts.bodySemi, fontSize: 11, color: colors.onSurfaceInverse },
  tr: { flexDirection: "row", borderTopWidth: 1, borderColor: colors.divider },
  td: { width: 120, padding: 8, fontFamily: fonts.body, fontSize: 11, color: colors.onSurface },
  warn: { fontFamily: fonts.body, fontSize: 12, color: colors.error, textAlign: "center" },
  summaryCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: 20, alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface },
  statsRow: { flexDirection: "row", gap: 24, marginTop: 6 },
  stat: { alignItems: "center" },
  statNum: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.onSurface },
  statLbl: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  errorsCard: { borderWidth: 2, borderColor: colors.error, padding: 12, gap: 6, backgroundColor: colors.surface },
  fRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.error },
  errItem: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurface },
  again: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.brandPrimary },
}));
