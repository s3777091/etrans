import { describe, expect, it } from "vitest";

import { resolveThemeMode } from "./theme-mode";

describe("resolveThemeMode", () => {
  it("uses the requested light or dark theme", () => {
    expect(resolveThemeMode("light", "dark")).toBe("light");
    expect(resolveThemeMode("dark", "light")).toBe("dark");
  });

  it("follows the system theme in automatic mode", () => {
    expect(resolveThemeMode("system", "dark")).toBe("dark");
    expect(resolveThemeMode("system", "light")).toBe("light");
    expect(resolveThemeMode("system", undefined)).toBe("light");
  });
});
