import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Trash } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { Button, Field, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function ClientForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editing = !!id;

  const [form, setForm] = useState({ name: "", company: "", nip: "", address: "", phone: "", email: "", note: "" });
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ["client", id], queryFn: () => apiFetch(`/clients/${id}`), enabled: editing });
  useEffect(() => {
    if (data) setForm({ name: data.name || "", company: data.company || "", nip: data.nip || "", address: data.address || "", phone: data.phone || "", email: data.email || "", note: data.note || "" });
  }, [data]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.show("Podaj nazwę klienta", "error");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(editing ? `/clients/${id}` : "/clients", { method: editing ? "PUT" : "POST", body: form });
      qc.invalidateQueries({ queryKey: ["clients"] });
      haptic("success");
      toast.show(editing ? "Zapisano zmiany" : "Dodano klienta", "success");
      router.canGoBack() ? router.back() : router.replace("/(tabs)/clients");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await apiFetch(`/clients/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["clients"] });
      haptic("success");
      toast.show("Usunięto klienta", "success");
      router.canGoBack() ? router.back() : router.replace("/(tabs)/clients");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={editing ? "Edytuj klienta" : "Nowy klient"}
        back
        right={editing ? (
          <Pressable onPress={remove} hitSlop={10} testID="delete-client"><Trash size={24} color={colors.error} weight="bold" /></Pressable>
        ) : undefined}
      />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }} bottomOffset={80}>
        <Field label="Nazwa / imię i nazwisko" value={form.name} onChangeText={(v) => set("name", v)} placeholder="Anna Nowak" autoCapitalize="words" testID="client-name" />
        <Field label="Firma" value={form.company} onChangeText={(v) => set("company", v)} placeholder="Nowak Bud sp. z o.o." testID="client-company" />
        <Field label="NIP" value={form.nip} onChangeText={(v) => set("nip", v)} placeholder="1234567890" keyboardType="numeric" testID="client-nip" />
        <Field label="Adres" value={form.address} onChangeText={(v) => set("address", v)} placeholder="ul. Polna 5, Kraków" testID="client-address" />
        <Field label="Telefon" value={form.phone} onChangeText={(v) => set("phone", v)} placeholder="600 100 200" keyboardType="phone-pad" testID="client-phone" />
        <Field label="E-mail" value={form.email} onChangeText={(v) => set("email", v)} placeholder="anna@firma.pl" keyboardType="email-address" autoCapitalize="none" testID="client-email" />
        <Field label="Notatka" value={form.note} onChangeText={(v) => set("note", v)} placeholder="Dodatkowe informacje" multiline testID="client-note" />
      </KeyboardAwareScrollView>
      <KeyboardStickyView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button label={editing ? "Zapisz zmiany" : "Dodaj klienta"} onPress={save} loading={busy} testID="save-client" />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  footer: { padding: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
}));
