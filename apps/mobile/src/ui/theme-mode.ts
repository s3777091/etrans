import type { ColorSchemeName } from "react-native";

export type ThemeMode = "system" | "light" | "dark";

export function resolveThemeMode(
  mode: ThemeMode,
  systemColorScheme: ColorSchemeName | null | undefined,
): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return systemColorScheme === "dark" ? "dark" : "light";
}
