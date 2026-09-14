import { useRouter } from "expo-router";
import { SignOut } from "phosphor-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { Button, Field, ScreenHeader, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [form, setForm] = useState({
    name: user?.name || "",
    company_name: user?.company_name || "",
    nip: user?.nip || "",
    address: user?.address || "",
    phone: user?.phone || "",
  });
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ user: any }>("/auth/profile", { method: "PUT", body: form });
      setUser(res.user);
      haptic("success");
      toast.show("Zapisano dane firmy", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    haptic("medium");
    await logout();
    router.replace("/login");
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Dane firmy" subtitle="Widoczne na ofertach" back />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }} bottomOffset={80}>
        <View style={styles.emailBox}>
          <Text style={styles.emailLabel}>Zalogowano jako</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <Field label="Imię i nazwisko" value={form.name} onChangeText={(v) => set("name", v)} placeholder="Jan Kowalski" autoCapitalize="words" testID="profile-name" />
        <Field label="Nazwa firmy" value={form.company_name} onChangeText={(v) => set("company_name", v)} placeholder="Kowalski Instalacje" testID="profile-company" />
        <Field label="NIP" value={form.nip} onChangeText={(v) => set("nip", v)} placeholder="1234567890" keyboardType="numeric" testID="profile-nip" />
        <Field label="Adres" value={form.address} onChangeText={(v) => set("address", v)} placeholder="ul. Budowlana 1, Warszawa" testID="profile-address" />
        <Field label="Telefon" value={form.phone} onChangeText={(v) => set("phone", v)} placeholder="600 100 200" keyboardType="phone-pad" testID="profile-phone" />

        <Button label="Wyloguj się" onPress={doLogout} variant="outline" icon={<SignOut size={20} color={colors.error} weight="bold" />} style={{ marginTop: 8, borderColor: colors.error }} testID="logout-btn" />
      </KeyboardAwareScrollView>
      <KeyboardStickyView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button label="Zapisz dane firmy" onPress={save} loading={busy} testID="save-profile" />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  emailBox: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, padding: 12, gap: 4 },
  emailLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  email: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onSurface },
  footer: { padding: 16, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
}));
