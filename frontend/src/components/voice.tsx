import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { Microphone, Stop, X, Check, PencilSimple } from "phosphor-react-native";
import { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, uploadFile } from "@/src/api/client";
import { Button, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

type Props = {
  context: "catalog" | "estimate";
  estimateItems?: any[];
  onApplyEstimate?: (actions: any[]) => void;
  onAppliedCatalog?: () => void;
  compact?: boolean;
  testID?: string;
};

export function VoiceEditButton({ context, estimateItems, onApplyEstimate, onAppliedCatalog, compact, testID }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"input" | "processing" | "review">("input");
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");
  const [actions, setActions] = useState<any[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPhase("input"); setText(""); setAudioUri(null); setRecording(false);
    setTranscription(""); setActions([]); setSelected([]); setChoice({});
  };
  const close = () => { setOpen(false); reset(); };

  const toggleRecord = async () => {
    if (Platform.OS === "web") { toast.show("Nagrywanie dostępne w aplikacji mobilnej — użyj pola tekstowego", "info"); return; }
    if (recording) {
      haptic("medium");
      await recorder.stop();
      setAudioUri(recorder.uri ?? null);
      setRecording(false);
      return;
    }
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { toast.show("Potrzebny dostęp do mikrofonu", "info"); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    haptic("heavy");
  };

  const process = async () => {
    if (!audioUri && !text.trim()) { toast.show("Nagraj lub wpisz polecenie", "error"); return; }
    setPhase("processing");
    try {
      let audioPath: string | null = null;
      if (audioUri) {
        const up = await uploadFile(audioUri, "komenda.m4a", "audio/m4a");
        audioPath = up.path;
      }
      const res = await apiFetch<{ transcription: string; actions: any[] }>("/voice/parse-command", {
        method: "POST",
        body: { context, text: text.trim() || null, audio_path: audioPath, estimate_items: context === "estimate" ? (estimateItems || []) : undefined },
      });
      const acts = res.actions || [];
      if (acts.length === 0) {
        toast.show("Nie rozpoznano polecenia. Spróbuj ponownie.", "error");
        setPhase("input");
        return;
      }
      setTranscription(res.transcription || "");
      setActions(acts);
      setSelected(acts.map((a) => a.status === "ok" || a.status === "ambiguous"));
      const initChoice: Record<number, string> = {};
      acts.forEach((a, i) => { if (a.status === "ambiguous" && a.candidates?.length) initChoice[i] = a.candidates[0].catalog_id; });
      setChoice(initChoice);
      setPhase("review");
      haptic("success");
    } catch (e: any) {
      toast.show(e.message || "Nie udało się rozpoznać polecenia", "error");
      setPhase("input");
    }
  };

  const confirm = async () => {
    const chosen = actions.filter((_, i) => selected[i]);
    if (chosen.length === 0) { toast.show("Zaznacz przynajmniej jedną zmianę", "error"); return; }
    setBusy(true);
    try {
      if (context === "catalog") {
        const finalActions = chosen.map((a) => {
          const idx = actions.indexOf(a);
          if (a.status === "ambiguous") {
            const cid = choice[idx] || a.candidates?.[0]?.catalog_id;
            return { ...a, catalog_id: cid };
          }
          return a;
        }).filter((a) => a.op !== "set_price" && a.op !== "delete_item" ? true : !!a.catalog_id);
        const r = await apiFetch<{ count: number }>("/catalog/voice-apply", { method: "POST", body: { actions: finalActions } });
        toast.show(`Zapisano zmiany: ${r.count}`, "success");
        onAppliedCatalog?.();
      } else {
        onApplyEstimate?.(chosen);
        toast.show("Zastosowano zmiany w kosztorysie", "success");
      }
      haptic("success");
      close();
    } catch (e: any) {
      toast.show(e.message || "Nie udało się zapisać", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable onPress={() => { haptic("light"); setOpen(true); }} style={[styles.trigger, compact && styles.triggerCompact]} testID={testID || "voice-edit-btn"}>
        <Microphone size={compact ? 20 : 22} color={colors.onBrandPrimary} weight="bold" />
        {!compact ? <Text style={styles.triggerText}>GŁOSEM</Text> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{context === "catalog" ? "Edycja katalogu głosem" : "Edycja kosztorysu głosem"}</Text>
              <Pressable onPress={close} hitSlop={10} testID="voice-close"><X size={24} color={colors.onSurface} weight="bold" /></Pressable>
            </View>

            {phase === "input" ? (
              <ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
                <Pressable onPress={toggleRecord} style={[styles.recBtn, recording && styles.recActive]} testID="voice-record">
                  {recording ? <Stop size={26} color={colors.onError} weight="fill" /> : <Microphone size={26} color={colors.onSurface} weight="bold" />}
                  <Text style={[styles.recText, recording && { color: colors.onError }]}>
                    {recording ? "Nagrywam... dotknij, aby zakończyć" : audioUri ? "Nagranie gotowe · nagraj ponownie" : "Nagraj polecenie"}
                  </Text>
                </Pressable>

                <View style={{ gap: 8 }}>
                  <View style={styles.orRow}><View style={styles.orLine} /><Text style={styles.orText}>albo wpisz</Text><View style={styles.orLine} /></View>
                  <View style={styles.inputWrap}>
                    <PencilSimple size={18} color={colors.muted} weight="bold" />
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      placeholder={context === "catalog" ? "Np. Zmień cenę YDY 3x2,5 na 8 zł/m" : "Np. Dodaj 20 punktów elektrycznych po 85 zł"}
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                      multiline
                      testID="voice-text"
                    />
                  </View>
                </View>

                <Button label="ROZPOZNAJ POLECENIE" onPress={process} testID="voice-process" />
                <Text style={styles.hint}>Zmiany zawsze wymagają Twojego potwierdzenia przed zapisaniem.</Text>
              </ScrollView>
            ) : null}

            {phase === "processing" ? (
              <View style={{ padding: 40, alignItems: "center", gap: 14 }}>
                <ActivityIndicator size="large" color={colors.brandPrimary} />
                <Text style={styles.procText}>Rozpoznaję polecenie...</Text>
              </View>
            ) : null}

            {phase === "review" ? (
              <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
                {transcription ? <Text style={styles.transcript}>„{transcription}”</Text> : null}
                <Text style={styles.reviewLabel}>Proponowane zmiany — zatwierdź:</Text>
                {actions.map((a, i) => {
                  const disabled = a.status === "not_found" || a.status === "unknown";
                  return (
                    <View key={i} style={[styles.actionCard, disabled && { opacity: 0.5 }]}>
                      <Pressable onPress={() => !disabled && setSelected((s) => s.map((v, idx) => (idx === i ? !v : v)))} style={styles.actionRow} testID={`voice-action-${i}`}>
                        <View style={[styles.check, selected[i] && !disabled && styles.checkOn]}>
                          {selected[i] && !disabled ? <Check size={14} color={colors.onBrandPrimary} weight="bold" /> : null}
                        </View>
                        <Text style={styles.actionLabel}>{a.label}</Text>
                      </Pressable>
                      {a.status === "not_found" ? <Text style={styles.notFound}>Nie znaleziono dopasowania</Text> : null}
                      {a.status === "ambiguous" && a.candidates?.length ? (
                        <View style={{ gap: 6, marginTop: 8 }}>
                          <Text style={styles.pickLabel}>Wybierz pozycję:</Text>
                          {a.candidates.map((c: any) => (
                            <Pressable key={c.catalog_id} onPress={() => setChoice((ch) => ({ ...ch, [i]: c.catalog_id }))} style={[styles.candRow, choice[i] === c.catalog_id && styles.candOn]} testID={`voice-cand-${i}-${c.catalog_id}`}>
                              <Text style={styles.candText}>{c.catalog_name} · {c.unit}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                <Button label={busy ? "ZAPISYWANIE..." : "ZATWIERDŹ I ZAPISZ"} onPress={confirm} loading={busy} testID="voice-confirm" />
                <Pressable onPress={() => setPhase("input")} style={{ alignItems: "center", paddingVertical: 8 }}><Text style={styles.again}>Nagraj / wpisz ponownie</Text></Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  trigger: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandSecondary, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14, height: 44 },
  triggerCompact: { paddingHorizontal: 10, width: 44, justifyContent: "center" },
  triggerText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.onBrandPrimary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 3, borderColor: colors.borderStrong, maxHeight: "88%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 2, borderColor: colors.borderStrong },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface, letterSpacing: -0.3 },
  recBtn: { minHeight: 72, borderWidth: 2, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, backgroundColor: colors.surfaceSecondary },
  recActive: { backgroundColor: colors.error, borderColor: colors.borderStrong },
  recText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface, flex: 1 },
  orRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  orLine: { flex: 1, height: 2, backgroundColor: colors.divider },
  orText: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textTransform: "uppercase" },
  inputWrap: { flexDirection: "row", gap: 8, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, padding: 12, minHeight: 64 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.onSurface, padding: 0 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: "center" },
  procText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  transcript: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, fontStyle: "italic" },
  reviewLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  actionCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: 12, backgroundColor: colors.surfaceSecondary },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  check: { width: 24, height: 24, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  checkOn: { backgroundColor: colors.brandPrimary },
  actionLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  notFound: { fontFamily: fonts.body, fontSize: 12, color: colors.error, marginTop: 6, marginLeft: 36 },
  pickLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted, marginLeft: 36 },
  candRow: { marginLeft: 36, borderWidth: 2, borderColor: colors.borderStrong, padding: 8, backgroundColor: colors.surface },
  candOn: { backgroundColor: colors.brandSecondary, borderColor: colors.borderStrong },
  candText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurface },
  again: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.brandPrimary },
}));
