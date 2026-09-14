// Design tokens for BudKoszt Pro (Brutalist Mobile, Light).
// Colors match the "color" block of /app/design_guidelines.json.
// Use makeStyles() for StyleSheets and useTheme().colors for color props.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#09090B",
  surfaceSecondary: "#F4F4F5",
  onSurfaceSecondary: "#09090B",
  surfaceTertiary: "#E4E4E7",
  onSurfaceTertiary: "#09090B",
  surfaceInverse: "#09090B",
  onSurfaceInverse: "#FFFFFF",
  muted: "#71717A",

  brand: "#F97316",
  onBrand: "#FFFFFF",
  brandPrimary: "#EA580C",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#18181B",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FFEDD5",
  onBrandTertiary: "#EA580C",

  success: "#16A34A",
  onSuccess: "#FFFFFF",
  warning: "#EAB308",
  onWarning: "#09090B",
  error: "#DC2626",
  onError: "#FFFFFF",
  info: "#2563EB",
  onInfo: "#FFFFFF",

  border: "#D4D4D8",
  borderStrong: "#09090B",
  divider: "#E4E4E7",
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

export const radius = { sm: 0, md: 0, lg: 0, pill: 0 };

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
