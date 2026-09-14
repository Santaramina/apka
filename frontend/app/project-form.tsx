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
import { TRADES } from "@/src/lib/format";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function ProjectForm() {
  const { id, clientId } = useLocalSearchParams<{ id?: string; clientId?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editing = !!id;

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch("/clients") });
  const { data } = useQuery({ queryKey: ["project", id], queryFn: () => apiFetch(`/projects/${id}`), enabled: editing });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [trade, setTrade] = useState("mieszane");
  const [selClient, setSelClient] = useState<string | undefined>(clientId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.name || "");
      setAddress(data.address || "");
      setNote(data.note || "");
      setTrade(data.trade || "mieszane");
      setSelClient(data.client_id);
    }
  }, [data]);

  const save = async () => {
    if (!selClient) { toast.show("Wybierz klienta", "error"); return; }
    if (!name.trim()) { toast.show("Podaj nazwę inwestycji", "error"); return; }
    setBusy(true);
    try {
      const body = { client_id: selClient, name, address, note, trade, status: "active" };
      await apiFetch(editing ? `/projects/${id}` : "/projects", { method: editing ? "PUT" : "POST", body });
      qc.invalidateQueries({ queryKey: ["projects"] });
      haptic("success");
      toast.show(editing ? "Zapisano" : "Dodano inwestycję", "success");
      router.canGoBack() ? router.back() : router.replace("/(tabs)/projects");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await apiFetch(`/projects/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["projects"] });
      haptic("success");
      toast.show("Usunięto inwestycję", "success");
      router.replace("/(tabs)/projects");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={editing ? "Edytuj inwestycję" : "Nowa inwestycja"}
        back
        right={editing ? (<Pressable onPress={remove} hitSlop={10} testID="delete-project"><Trash size={24} color={colors.error} weight="bold" /></Pressable>) : undefined}
      />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }} bottomOffset={80}>
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Klient</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(clients ?? []).map((c: any) => (
              <Pressable key={c.client_id} onPress={() => { haptic("light"); setSelClient(c.client_id); }} style={[styles.chip, selClient === c.client_id && styles.chipActive]} testID={`sel-client-${c.client_id}`}>
                <Text style={[styles.chipText, selClient === c.client_id && styles.chipTextActive]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Field label="Nazwa inwestycji" value={name} onChangeText={setName} placeholder="Remont łazienki" testID="project-name" />
        <Field label="Adres" value={address} onChangeText={setAddress} placeholder="ul. Polna 5" testID="project-address" />

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Branża</Text>
          <View style={styles.tradeGrid}>
            {TRADES.map((t) => (
              <Pressable key={t.key} onPress={() => { haptic("light"); setTrade(t.key); }} style={[styles.tradeChip, trade === t.key && styles.chipActive]} testID={`trade-${t.key}`}>
                <Text style={[styles.chipText, trade === t.key && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field label="Notatka" value={note} onChangeText={setNote} placeholder="Uzgodnienia z klientem" multiline testID="project-note" />
      </KeyboardAwareScrollView>
      <KeyboardStickyView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button label={editing ? "Zapisz zmiany" : "Dodaj inwestycję"} onPress={save} loading={busy} testID="save-project" />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  chip: { flexShrink: 0, height: 44, paddingHorizontal: 16, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },
  tradeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tradeChip: { height: 44, paddingHorizontal: 16, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  footer: { padding: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
}));
