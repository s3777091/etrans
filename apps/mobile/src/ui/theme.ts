export interface AppTheme {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  accentText: string;
  success: string;
  danger: string;
  dangerSurface: string;
  shadow: string;
}

export const lightTheme: AppTheme = {
  background: "#F2F1EC",
  surface: "#E7E6E0",
  surfaceRaised: "#FAF9F5",
  text: "#191B18",
  muted: "#62665F",
  faint: "#8E928A",
  border: "#D4D3CC",
  accent: "#1C78E8",
  accentText: "#FFFFFF",
  success: "#21A663",
  danger: "#A83F31",
  dangerSurface: "#F3D8D1",
  shadow: "#68665D",
};

export const darkTheme: AppTheme = {
  background: "#151713",
  surface: "#20231E",
  surfaceRaised: "#292C26",
  text: "#F3F1E8",
  muted: "#ADB0A7",
  faint: "#7E8279",
  border: "#393D35",
  accent: "#69AEFF",
  accentText: "#08121F",
  success: "#42D18A",
  danger: "#F09682",
  dangerSurface: "#432721",
  shadow: "#080A07",
};
