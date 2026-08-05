export const THEME_STORAGE_KEY = "northstar-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(
	preference: ThemePreference,
	systemPrefersDark: boolean,
): ResolvedTheme {
	if (preference === "system") return systemPrefersDark ? "dark" : "light";
	return preference;
}

export function themeAttribute(
	preference: ThemePreference,
): ResolvedTheme | null {
	return preference === "system" ? null : preference;
}
