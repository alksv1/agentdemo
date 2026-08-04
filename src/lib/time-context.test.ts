import { describe, expect, it } from "vitest";
import {
	DEFAULT_TIME_ZONE,
	getCurrentTimeContext,
} from "./time-context";

describe("getCurrentTimeContext", () => {
	it("converts the server clock into the user's IANA time zone", () => {
		const time = getCurrentTimeContext(
			"Asia/Shanghai",
			new Date("2026-08-04T06:30:45.000Z"),
		);

		expect(time).toMatchObject({
			utcIso: "2026-08-04T06:30:45.000Z",
			timeZone: "Asia/Shanghai",
			utcOffset: "GMT+08:00",
			localDate: "2026-08-04",
			localTime: "14:30:45",
			weekday: "星期二",
		});
	});

	it("handles local dates that differ from UTC", () => {
		const time = getCurrentTimeContext(
			"America/Los_Angeles",
			new Date("2026-01-01T01:15:00.000Z"),
		);

		expect(time.localDate).toBe("2025-12-31");
		expect(time.localTime).toBe("17:15:00");
		expect(time.weekday).toBe("星期三");
	});

	it("falls back safely when the browser sends an invalid time zone", () => {
		const time = getCurrentTimeContext(
			"not/a-real-zone",
			new Date("2026-08-04T06:30:45.000Z"),
		);

		expect(time.timeZone).toBe(DEFAULT_TIME_ZONE);
		expect(time.localDate).toBe("2026-08-04");
	});
});
