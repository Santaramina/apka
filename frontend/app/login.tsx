import { useRouter } from "expo-router";
import { GoogleLogo, Ruler } from "phosphor-react-native";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/auth-context";
import { Button, Field, haptic } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export default function Login() {
  const { loginEmail, register, loginGoogle } = useAuth();
  const toast = useToast();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      toast.show("Podaj e-mail i hasło", "error");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await loginEmail(email.trim().toLowerCase(), password);
      else await register(email.trim().toLowerCase(), password, name.trim(), company.trim());
      haptic("success");
    } catch (e: any) {
      toast.show(e.message || "Nie udało się zalogować", "error");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    try {
      await loginGoogle();
    } catch (e: any) {
      toast.show(e.message || "Logowanie Google nieudane", "error");
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 40 }]}>
          <View style={styles.logoBox}>
            <Ruler size={34} weight="bold" color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.brand}>BUDKOSZT PRO</Text>
          <Text style={styles.tagline}>Wyceny i kosztorysy prosto z budowy</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.switchRow}>
            <Pressable
              onPress={() => setMode("login")}
              style={[styles.switchBtn, mode === "login" && styles.switchActive]}
              testID="tab-login"
            >
              <Text style={[styles.switchText, mode === "login" && styles.switchTextActive]}>Logowanie</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("register")}
              style={[styles.switchBtn, mode === "register" && styles.switchActive]}
              testID="tab-register"
            >
              <Text style={[styles.switchText, mode === "register" && styles.switchTextActive]}>Rejestracja</Text>
            </Pressable>
          </View>

          {mode === "register" ? (
            <>
              <Field label="Imię i nazwisko" value={name} onChangeText={setName} placeholder="Jan Kowalski" autoCapitalize="words" testID="input-name" />
              <Field label="Nazwa firmy" value={company} onChangeText={setCompany} placeholder="Kowalski Instalacje" testID="input-company" />
            </>
          ) : null}
          <Field label="E-mail" value={email} onChangeText={setEmail} placeholder="jan@firma.pl" keyboardType="email-address" autoCapitalize="none" testID="input-email" />
          <Field label="Hasło" value={password} onChangeText={setPassword} placeholder="••••••" secure testID="input-password" />

          <Button label={mode === "login" ? "Zaloguj się" : "Utwórz konto"} onPress={submit} loading={busy} testID="submit-auth" style={{ marginTop: 4 }} />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>albo</Text>
            <View style={styles.line} />
          </View>

          <Button
            label="Kontynuuj z Google"
            onPress={google}
            variant="outline"
            icon={<GoogleLogo size={20} weight="bold" color={colors.onSurface} />}
            testID="google-auth"
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  hero: { backgroundColor: colors.brandPrimary, paddingHorizontal: 24, paddingBottom: 32, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  logoBox: { width: 64, height: 64, borderWidth: 2, borderColor: colors.onBrandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  brand: { fontFamily: fonts.displayBold, fontSize: 34, color: colors.onBrandPrimary, letterSpacing: -1 },
  tagline: { fontFamily: fonts.body, fontSize: 15, color: colors.onBrandPrimary, marginTop: 6, opacity: 0.9 },
  form: { padding: 24, gap: 16 },
  switchRow: { flexDirection: "row", borderWidth: 2, borderColor: colors.borderStrong },
  switchBtn: { flex: 1, paddingVertical: 14, alignItems: "center", backgroundColor: colors.surface },
  switchActive: { backgroundColor: colors.brandSecondary },
  switchText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.onSurface },
  switchTextActive: { color: "#FFFFFF" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 2, backgroundColor: colors.border },
  dividerText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
}));
