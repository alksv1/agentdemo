import { describe, expect, it } from "vitest";
import {
	CURRENT_WORKSPACE_DATA_EPOCH,
	CURRENT_WORKSPACE_KEY,
	initializeWorkspaceDirectory,
	isWorkspaceId,
	readWorkspaceDirectory,
	upsertWorkspace,
	WORKSPACE_DATA_EPOCH_KEY,
	WORKSPACE_DIRECTORY_KEY,
} from "./workspace-directory";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		values,
	};
}

describe("workspace directory", () => {
	it("migrates the former single workspace id into the directory", () => {
		const storage = memoryStorage({
			[CURRENT_WORKSPACE_KEY]: firstId,
			[WORKSPACE_DATA_EPOCH_KEY]: CURRENT_WORKSPACE_DATA_EPOCH,
		});
		const result = initializeWorkspaceDirectory(
			storage,
			() => secondId,
			"2026-08-04T08:00:00.000Z",
		);

		expect(result.currentId).toBe(firstId);
		expect(result.directory).toEqual([
			expect.objectContaining({ id: firstId, title: "目标空间 00000000" }),
		]);
		expect(storage.values.get(WORKSPACE_DIRECTORY_KEY)).toContain(firstId);
	});

	it("clears prelaunch browser data when the data epoch changes", () => {
		const storage = memoryStorage({
			[CURRENT_WORKSPACE_KEY]: firstId,
			[WORKSPACE_DIRECTORY_KEY]: JSON.stringify([
				{
					id: firstId,
					title: "旧目标",
					createdAt: "2026-08-01T08:00:00.000Z",
					lastOpenedAt: "2026-08-01T08:00:00.000Z",
				},
			]),
			[WORKSPACE_DATA_EPOCH_KEY]: "old-epoch",
		});
		const result = initializeWorkspaceDirectory(
			storage,
			() => secondId,
			"2026-08-04T08:00:00.000Z",
		);

		expect(result.currentId).toBe(secondId);
		expect(result.directory.map((entry) => entry.id)).toEqual([secondId]);
		expect(storage.values.get(WORKSPACE_DATA_EPOCH_KEY)).toBe(
			CURRENT_WORKSPACE_DATA_EPOCH,
		);
		expect(storage.values.get(WORKSPACE_DIRECTORY_KEY)).not.toContain(firstId);
	});

	it("keeps prior workspaces when a new one is added", () => {
		const original = upsertWorkspace([], firstId, {
			title: "发布产品",
			openedAt: "2026-08-03T08:00:00.000Z",
		});
		const result = upsertWorkspace(original, secondId, {
			openedAt: "2026-08-04T08:00:00.000Z",
		});

		expect(result.map((entry) => entry.id)).toEqual([secondId, firstId]);
		expect(result[1].title).toBe("发布产品");
	});

	it("updates a workspace title without duplicating it", () => {
		const original = upsertWorkspace([], firstId, {
			openedAt: "2026-08-03T08:00:00.000Z",
		});
		const result = upsertWorkspace(original, firstId, {
			title: "完成职业转型",
			openedAt: "2026-08-04T08:00:00.000Z",
		});

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("完成职业转型");
	});

	it("ignores malformed stored entries and validates imported ids", () => {
		expect(readWorkspaceDirectory("not-json")).toEqual([]);
		expect(isWorkspaceId(firstId)).toBe(true);
		expect(isWorkspaceId("northstar-demo")).toBe(false);
	});
});
