export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export interface CurrentTimeContext {
	epochMilliseconds: number;
	utcIso: string;
	timeZone: string;
	utcOffset: string;
	localDate: string;
	localTime: string;
	weekday: string;
}

export function getCurrentTimeContext(
	requestedTimeZone: string | undefined,
	now = new Date(),
): CurrentTimeContext {
	const timeZone = resolveTimeZone(requestedTimeZone);
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	const weekday = new Intl.DateTimeFormat("zh-CN", {
		timeZone,
		weekday: "long",
	}).format(now);
	const utcOffset =
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			timeZoneName: "longOffset",
		})
			.formatToParts(now)
			.find((part) => part.type === "timeZoneName")?.value ?? "GMT";

	return {
		epochMilliseconds: now.getTime(),
		utcIso: now.toISOString(),
		timeZone,
		utcOffset,
		localDate: `${values.year}-${values.month}-${values.day}`,
		localTime: `${values.hour}:${values.minute}:${values.second}`,
		weekday,
	};
}

function resolveTimeZone(requestedTimeZone: string | undefined): string {
	const candidate = requestedTimeZone?.trim().slice(0, 80);
	if (!candidate) return DEFAULT_TIME_ZONE;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
		return candidate;
	} catch {
		return DEFAULT_TIME_ZONE;
	}
}
