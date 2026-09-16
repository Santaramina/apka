// Design tokens for BudKoszt Pro (Brutalist Mobile, Light).
// Colors match the "color" block of /app/design_guidelines.json.
// Use makeStyles() for StyleSheets and useTheme().colors for color props.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#1F2933",
  surfaceSecondary: "#F4F6F8",
  onSurfaceSecondary: "#3A4650",
  surfaceTertiary: "#E7EBEF",
  onSurfaceTertiary: "#1F2933",
  surfaceInverse: "#1F2933",
  onSurfaceInverse: "#FFFFFF",
  muted: "#6B7280",

  brand: "#3E8E63",
  onBrand: "#FFFFFF",
  brandPrimary: "#2F6B4F",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#1F2933",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E7F2EC",
  onBrandTertiary: "#2F6B4F",

  success: "#2F9E5B",
  onSuccess: "#FFFFFF",
  warning: "#E8A33D",
  onWarning: "#1F2933",
  error: "#E5484D",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",

  border: "#E5E8EC",
  borderStrong: "#D3D9DF",
  divider: "#EDF0F3",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

// Static design tokens (non-color) shared across the app.
export const typography = {
  displayFontFamily: "SpaceGrotesk",
  textFontFamily: "IBMPlexSans",
  scale: { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 30, "4xl": 40 },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

// Soft elevation shared across cards/sheets.
export const shadow = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
