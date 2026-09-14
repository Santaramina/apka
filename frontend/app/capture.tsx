import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, Images, Microphone, Stop, TextT, Trash, X } from "phosphor-react-native";
import { useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, uploadFile } from "@/src/api/client";
import { Button, Field, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Capture() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => apiFetch(`/projects/${projectId}`), enabled: !!projectId });

  const [photos, setPhotos] = useState<string[]>([]);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const takePhoto = async () => {
    haptic("heavy");
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        toast.show("Włącz dostęp do aparatu w Ustawieniach", "error");
        Linking.openSettings();
      } else {
        toast.show("Potrzebny dostęp do aparatu", "info");
      }
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5 });
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => a.uri)]);
  };

  const pickPhotos = async () => {
    haptic("light");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        toast.show("Włącz dostęp do zdjęć w Ustawieniach", "error");
        Linking.openSettings();
      } else {
        toast.show("Potrzebny dostęp do galerii", "info");
      }
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.5 });
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => a.uri)]);
  };

  const toggleRecord = async () => {
    if (Platform.OS === "web") {
      toast.show("Nagrywanie głosu dostępne w aplikacji mobilnej", "info");
      return;
    }
    if (recording) {
      haptic("medium");
      await recorder.stop();
      setAudioUri(recorder.uri ?? null);
      setRecording(false);
      return;
    }
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      toast.show("Potrzebny dostęp do mikrofonu", "info");
      if (perm.canAskAgain === false) Linking.openSettings();
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    haptic("heavy");
  };

  const generate = async () => {
    if (photos.length === 0 && !audioUri && !note.trim()) {
      toast.show("Dodaj zdjęcie, nagranie lub opis", "error");
      return;
    }
    setBusy(true);
    try {
      const imagePaths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        // Normalize every photo to JPEG on-device (handles HEIC/HEIF/PNG/WEBP from iOS/Android).
        let jpegUri = photos[i];
        try {
          const ctx = ImageManipulator.manipulate(photos[i]);
          const rendered = await ctx.renderAsync();
          const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
          jpegUri = out.uri;
        } catch {
          // fall back to original uri; backend has a HEIC->JPEG safety net
        }
        try {
          const up = await uploadFile(jpegUri, `zdjecie_${i + 1}.jpg`, "image/jpeg");
          imagePaths.push(up.path);
        } catch (upErr: any) {
          // Only surface known backend messages (Polish); hide raw technical errors.
          const known = typeof upErr?.status === "number" && upErr?.message;
          throw new Error(known ? `Nie udało się przesłać zdjęcia ${i + 1}. ${upErr.message}` : `Nie udało się przesłać zdjęcia ${i + 1}. Spróbuj ponownie.`);
        }
      }
      let audioPath: string | null = null;
      if (audioUri) {
        try {
          const up = await uploadFile(audioUri, "nagranie.m4a", "audio/m4a");
          audioPath = up.path;
        } catch (upErr: any) {
          const known = typeof upErr?.status === "number" && upErr?.message;
          throw new Error(known ? `Nie udało się przesłać nagrania. ${upErr.message}` : "Nie udało się przesłać nagrania. Spróbuj ponownie.");
        }
      }
      const est = await apiFetch<{ estimate_id: string }>("/ai/analyze", {
        method: "POST",
        body: { project_id: projectId, trade: project?.trade, description: note, image_paths: imagePaths, audio_path: audioPath },
      });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      haptic("success");
      router.replace(`/estimate/${est.estimate_id}`);
    } catch (e: any) {
      haptic("error");
      toast.show(e.message || "Analiza nie powiodła się", "error");
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Nowa wycena"
        subtitle="Zdjęcia · głos · opis"
        right={<Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace(`/project/${projectId}`))} hitSlop={10} testID="close-capture"><X size={26} color={colors.onSurface} weight="bold" /></Pressable>}
      />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }} bottomOffset={20}>
        {/* Photos */}
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Zdjęcia z budowy</Text>
          <View style={styles.captureRow}>
            <Pressable onPress={takePhoto} style={styles.captureBtn} testID="take-photo">
              <Camera size={30} color={colors.onSurface} weight="bold" />
              <Text style={styles.captureText}>Zrób zdjęcie</Text>
            </Pressable>
            <Pressable onPress={pickPhotos} style={styles.captureBtn} testID="pick-photo">
              <Images size={30} color={colors.onSurface} weight="bold" />
              <Text style={styles.captureText}>Z galerii</Text>
            </Pressable>
          </View>
          {photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
              {photos.map((uri, i) => (
                <View key={`${uri}-${i}`} style={styles.thumb}>
                  <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  <Pressable onPress={() => setPhotos((p) => p.filter((_, idx) => idx !== i))} style={styles.thumbDel} testID={`del-photo-${i}`}>
                    <X size={14} color="#FFFFFF" weight="bold" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {/* Voice */}
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Opis głosowy</Text>
          <Pressable onPress={toggleRecord} style={[styles.recordBtn, recording && styles.recordActive]} testID="record-voice">
            {recording ? <Stop size={26} color={colors.onError} weight="fill" /> : <Microphone size={26} color={colors.onSurface} weight="bold" />}
            <Text style={[styles.recordText, recording && { color: colors.onError }]}>
              {recording ? "Nagrywam... dotknij, aby zakończyć" : audioUri ? "Nagranie gotowe · nagraj ponownie" : "Nagraj opis zakresu prac"}
            </Text>
          </Pressable>
          {audioUri && !recording ? (
            <Pressable onPress={() => setAudioUri(null)} style={styles.clearAudio} testID="clear-audio">
              <Trash size={16} color={colors.error} weight="bold" />
              <Text style={styles.clearAudioText}>Usuń nagranie</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Text note */}
        <View style={{ gap: 10 }}>
          <View style={styles.labelRow}>
            <TextT size={18} color={colors.onSurface} weight="bold" />
            <Text style={styles.label}>Notatka tekstowa</Text>
          </View>
          <Field value={note} onChangeText={setNote} placeholder="Np. Malowanie 2 pokoi ok. 40m2, gładzie, wymiana 3 gniazd..." multiline testID="capture-note" />
        </View>

        <Button label="GENERUJ KOSZTORYS" onPress={generate} hapticKind="heavy" testID="generate-estimate" />
      </KeyboardAwareScrollView>

      {busy ? (
        <View style={styles.overlay} testID="ai-loading">
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.overlayText}>AI analizuje miejsce{"\n"}i zakres prac...</Text>
          <Text style={styles.overlaySub}>To może potrwać kilkanaście sekund</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  captureRow: { flexDirection: "row", gap: 12 },
  captureBtn: { flex: 1, height: 110, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.surfaceSecondary },
  captureText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  thumb: { width: 90, height: 90, borderWidth: 2, borderColor: colors.borderStrong, overflow: "hidden" },
  thumbDel: { position: "absolute", top: 0, right: 0, width: 26, height: 26, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  recordBtn: { minHeight: 64, borderWidth: 2, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, backgroundColor: colors.surfaceSecondary },
  recordActive: { backgroundColor: colors.error, borderColor: colors.borderStrong },
  recordText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface, flex: 1 },
  clearAudio: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  clearAudioText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.error },
  overlay: { ...StyleSheetAbsolute(), backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  overlayText: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.onSurface, textAlign: "center", letterSpacing: -0.5 },
  overlaySub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center" },
}));

function StyleSheetAbsolute() {
  return { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };
}
