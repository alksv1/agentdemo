import { describe, expect, it } from "vitest";
import {
	isThemePreference,
	resolveTheme,
	themeAttribute,
} from "./theme";

describe("theme preference", () => {
	it("follows the system when no explicit theme is selected", () => {
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("system", true)).toBe("dark");
	});

	it("keeps an explicit light or dark selection", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	it("only accepts supported stored values", () => {
		expect(isThemePreference("system")).toBe(true);
		expect(isThemePreference("dark")).toBe(true);
		expect(isThemePreference("auto")).toBe(false);
		expect(themeAttribute("system")).toBeNull();
		expect(themeAttribute("dark")).toBe("dark");
	});
});
