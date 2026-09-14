import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/src/lib/fonts";
import { makeStyles, useTheme } from "@/src/theme";

type ToastKind = "success" | "error" | "info";
type ToastCtx = { show: (msg: string, kind?: ToastKind) => void };

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState<ToastKind>("info");
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<any>(null);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();

  const show = useCallback(
    (m: string, k: ToastKind = "info") => {
      setMsg(m);
      setKind(k);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMsg(null));
      }, 2800);
    },
    [opacity],
  );

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  const bg = kind === "success" ? colors.success : kind === "error" ? colors.error : colors.surfaceInverse;

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {msg ? (
        <Animated.View
          style={[styles.wrap, { top: insets.top + 12, opacity, pointerEvents: "none" }]}
          testID="toast"
        >
          <View style={[styles.toast, { backgroundColor: bg }]}>
            <Text style={styles.text}>{msg}</Text>
          </View>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 9999 },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderWidth: 2, borderColor: colors.borderStrong, maxWidth: "100%" },
  text: { color: "#FFFFFF", fontFamily: fonts.bodySemi, fontSize: 14, textAlign: "center" },
}));
