import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { CaretLeft } from "phosphor-react-native";
import { ActivityIndicator, Platform, Pressable, StyleProp, Text, TextInput, TextStyle, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

export function haptic(kind: "light" | "medium" | "heavy" | "success" | "error" = "light") {
  if (Platform.OS === "web") return;
  try {
    if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else Haptics.impactAsync(
        kind === "heavy" ? Haptics.ImpactFeedbackStyle.Heavy : kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
  } catch {}
}

// -------------------- Header --------------------
export function ScreenHeader({
  title,
  subtitle,
  back,
  right,
  testID,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]} testID={testID}>
      <View style={styles.headerRow}>
        {back ? (
          <Pressable
            onPress={() => {
              haptic("light");
              router.canGoBack() ? router.back() : router.replace("/");
            }}
            style={styles.backBtn}
            hitSlop={10}
            testID="header-back"
          >
            <CaretLeft size={24} weight="bold" color={colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

// -------------------- Button --------------------
type BtnVariant = "primary" | "secondary" | "outline" | "danger";
export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
  testID,
  hapticKind = "medium",
}: {
  label: string;
  onPress: () => void;
  variant?: BtnVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  hapticKind?: "light" | "medium" | "heavy";
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg =
    variant === "primary" ? colors.brandPrimary : variant === "secondary" ? colors.brandSecondary : variant === "danger" ? colors.error : colors.surface;
  const fg = variant === "outline" ? colors.onSurface : "#FFFFFF";
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        if (isDisabled) return;
        haptic(hapticKind);
        onPress();
      }}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnInner}>
          {icon}
          <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// -------------------- Card --------------------
export function Card({ children, style, onPress, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  const styles = useStyles();
  if (onPress) {
    return (
      <Pressable
        onPress={() => {
          haptic("light");
          onPress();
        }}
        testID={testID}
        style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

// -------------------- Field --------------------
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secure,
  multiline,
  autoCapitalize,
  testID,
  inputRef,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "numeric" | "decimal-pad" | "phone-pad";
  secure?: boolean;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words";
  testID?: string;
  inputRef?: any;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.inputMulti]}
        testID={testID}
      />
    </View>
  );
}

// -------------------- Money --------------------
export function Money({ children, style, testID }: { children: string; style?: StyleProp<TextStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <Text style={[styles.money, style]} testID={testID}>
      {children}
    </Text>
  );
}

// -------------------- Badge --------------------
export function Badge({ label, kind = "neutral" }: { label: string; kind?: "neutral" | "success" | "warning" | "info" | "danger" }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg = kind === "success" ? colors.success : kind === "warning" ? colors.warning : kind === "info" ? colors.info : kind === "danger" ? colors.error : colors.surfaceTertiary;
  const fg = kind === "neutral" ? colors.onSurface : kind === "warning" ? colors.onWarning : "#FFFFFF";
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

// -------------------- Empty / Loading --------------------
export function EmptyState({ icon, title, subtitle, testID }: { icon?: React.ReactNode; title: string; subtitle?: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.empty} testID={testID}>
      {icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

export function Loading({ testID }: { testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }} testID={testID}>
      <ActivityIndicator size="large" color={colors.brandPrimary} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { backgroundColor: colors.surface, borderBottomWidth: 2, borderBottomColor: colors.borderStrong, paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.onSurface, letterSpacing: -0.5 },
  headerSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },

  btn: { minHeight: 56, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  btnText: { fontFamily: fonts.displayBold, fontSize: 16, letterSpacing: 0.3 },

  card: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong, padding: 16 },

  fieldWrap: { gap: 6 },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  inputMulti: { minHeight: 110, textAlignVertical: "top" },

  money: { fontFamily: fonts.bodySemi, fontVariant: ["tabular-nums"], color: colors.onSurface },

  badge: { paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontFamily: fonts.bodySemi, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },

  empty: { alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.onSurface, textAlign: "center" },
  emptySub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: "center" },
}));
