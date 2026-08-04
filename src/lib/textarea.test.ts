import { describe, expect, it } from "vitest";
import { resizeTextarea } from "./textarea";

describe("resizeTextarea", () => {
	it("grows to match its content", () => {
		const textarea = document.createElement("textarea");
		Object.defineProperty(textarea, "scrollHeight", { value: 84 });

		resizeTextarea(textarea);

		expect(textarea.style.height).toBe("84px");
		expect(textarea.style.overflowY).toBe("hidden");
	});

	it("stops growing at the maximum height and becomes scrollable", () => {
		const textarea = document.createElement("textarea");
		Object.defineProperty(textarea, "scrollHeight", { value: 240 });

		resizeTextarea(textarea, 160);

		expect(textarea.style.height).toBe("160px");
		expect(textarea.style.overflowY).toBe("auto");
	});
});
