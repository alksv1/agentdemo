export const CURRENT_WORKSPACE_KEY = "northstar-workspace-id";
export const WORKSPACE_DIRECTORY_KEY = "northstar-workspaces";
export const WORKSPACE_DATA_EPOCH_KEY = "northstar-data-epoch";
export const CURRENT_WORKSPACE_DATA_EPOCH = "2026-08-04-prelaunch-reset-1";

export type WorkspaceEntry = {
	id: string;
	title: string;
	createdAt: string;
	lastOpenedAt: string;
};

type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const WORKSPACE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWorkspaceId(value: string): boolean {
	return WORKSPACE_ID_PATTERN.test(value.trim());
}

export function defaultWorkspaceTitle(id: string): string {
	return `目标空间 ${id.slice(0, 8)}`;
}

export function readWorkspaceDirectory(raw: string | null): WorkspaceEntry[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value)) return [];
		const seen = new Set<string>();
		return value.filter((entry): entry is WorkspaceEntry => {
			if (!entry || typeof entry !== "object") return false;
			const candidate = entry as Partial<WorkspaceEntry>;
			if (
				typeof candidate.id !== "string" ||
				!isWorkspaceId(candidate.id) ||
				typeof candidate.title !== "string" ||
				typeof candidate.createdAt !== "string" ||
				typeof candidate.lastOpenedAt !== "string" ||
				seen.has(candidate.id)
			) {
				return false;
			}
			seen.add(candidate.id);
			return true;
		});
	} catch {
		return [];
	}
}

export function upsertWorkspace(
	directory: WorkspaceEntry[],
	id: string,
	options: { title?: string; openedAt?: string } = {},
): WorkspaceEntry[] {
	const timestamp = options.openedAt ?? new Date().toISOString();
	const existing = directory.find((entry) => entry.id === id);
	const entry: WorkspaceEntry = existing
		? {
				...existing,
				title: options.title?.trim() || existing.title,
				lastOpenedAt: timestamp,
			}
		: {
				id,
				title: options.title?.trim() || defaultWorkspaceTitle(id),
				createdAt: timestamp,
				lastOpenedAt: timestamp,
			};

	return [entry, ...directory.filter((item) => item.id !== id)].sort(
		(a, b) =>
			new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime(),
	);
}

export function saveWorkspaceDirectory(
	storage: WorkspaceStorage,
	directory: WorkspaceEntry[],
): void {
	storage.setItem(WORKSPACE_DIRECTORY_KEY, JSON.stringify(directory));
}

export function initializeWorkspaceDirectory(
	storage: WorkspaceStorage,
	createId: () => string,
	now = new Date().toISOString(),
): { currentId: string; directory: WorkspaceEntry[] } {
	if (
		storage.getItem(WORKSPACE_DATA_EPOCH_KEY) !==
		CURRENT_WORKSPACE_DATA_EPOCH
	) {
		storage.removeItem(CURRENT_WORKSPACE_KEY);
		storage.removeItem(WORKSPACE_DIRECTORY_KEY);
		storage.setItem(WORKSPACE_DATA_EPOCH_KEY, CURRENT_WORKSPACE_DATA_EPOCH);
	}
	const storedCurrentId = storage.getItem(CURRENT_WORKSPACE_KEY)?.trim();
	const currentId =
		storedCurrentId && isWorkspaceId(storedCurrentId)
			? storedCurrentId
			: createId();
	const directory = upsertWorkspace(
		readWorkspaceDirectory(storage.getItem(WORKSPACE_DIRECTORY_KEY)),
		currentId,
		{ openedAt: now },
	);
	storage.setItem(CURRENT_WORKSPACE_KEY, currentId);
	saveWorkspaceDirectory(storage, directory);
	return { currentId, directory };
}
