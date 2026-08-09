export type GoalStatus = "planning" | "active" | "paused" | "completed";
export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type TaskPriority = "high" | "medium" | "low";

export interface Goal {
	id: string;
	title: string;
	motivation: string;
	deadline: string | null;
	weeklyHours: number;
	status: GoalStatus;
}

export interface Milestone {
	id: string;
	title: string;
	outcome: string;
	targetDate: string | null;
}

export interface Task {
	id: string;
	title: string;
	milestoneId: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	effortMinutes: number;
	dueDate: string | null;
}

export interface CheckIn {
	id: string;
	createdAt: string;
	mood: "energized" | "steady" | "stuck";
	win: string;
	blocker: string;
	nextFocus: string;
}

export interface Activity {
	id: string;
	createdAt: string;
	type: "plan" | "task" | "checkin" | "system";
	message: string;
}

export interface WorkspaceState {
	version: 1;
	goal: Goal | null;
	milestones: Milestone[];
	tasks: Task[];
	checkIns: CheckIn[];
	activity: Activity[];
	updatedAt: string | null;
}

export interface PlanDraft {
	goal: {
		title: string;
		motivation: string;
		deadline?: string | null;
		weeklyHours: number;
	};
	milestones: Array<{
		title: string;
		outcome: string;
		targetDate?: string | null;
	}>;
	tasks: Array<{
		title: string;
		milestoneIndex?: number | null;
		priority: TaskPriority;
		effortMinutes: number;
		dueDate?: string | null;
	}>;
}

export type TaskPlacement =
	| { type: "start" }
	| { type: "end" }
	| { type: "before"; taskId: string }
	| { type: "after"; taskId: string };

export interface SplitTaskDraft {
	title: string;
	priority?: TaskPriority;
	effortMinutes: number;
	dueDate?: string | null;
}

export type TaskUpdates = Partial<
	Pick<Task, "title" | "status" | "priority" | "effortMinutes" | "dueDate">
>;

export const EMPTY_WORKSPACE: WorkspaceState = {
	version: 1,
	goal: null,
	milestones: [],
	tasks: [],
	checkIns: [],
	activity: [],
	updatedAt: null,
};

const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();

function addActivity(
	state: WorkspaceState,
	type: Activity["type"],
	message: string,
): WorkspaceState {
	const updatedAt = now();
	return {
		...state,
		updatedAt,
		activity: [
			{
				id: makeId(),
				createdAt: updatedAt,
				type,
				message,
			},
			...state.activity,
		].slice(0, 30),
	};
}

export function calculateProgress(state: WorkspaceState): number {
	if (state.tasks.length === 0) return 0;
	const completed = state.tasks.filter((task) => task.status === "done").length;
	return Math.round((completed / state.tasks.length) * 100);
}

export function replacePlan(
	state: WorkspaceState,
	draft: PlanDraft,
): WorkspaceState {
	const milestones = draft.milestones.slice(0, 8).map((milestone) => ({
		id: makeId(),
		title: milestone.title,
		outcome: milestone.outcome,
		targetDate: milestone.targetDate ?? null,
	}));

	const tasks = draft.tasks.slice(0, 24).map((task) => ({
		id: makeId(),
		title: task.title,
		milestoneId:
			task.milestoneIndex === null || task.milestoneIndex === undefined
				? null
				: (milestones[task.milestoneIndex]?.id ?? null),
		status: "todo" as const,
		priority: task.priority,
		effortMinutes: task.effortMinutes,
		dueDate: task.dueDate ?? null,
	}));

	return addActivity(
		{
			...state,
			goal: {
				id: state.goal?.id ?? makeId(),
				title: draft.goal.title,
				motivation: draft.goal.motivation,
				deadline: draft.goal.deadline ?? null,
				weeklyHours: draft.goal.weeklyHours,
				status: "active",
			},
			milestones,
			tasks,
		},
		"plan",
		`已建立「${draft.goal.title}」行动计划`,
	);
}

export function addTask(
	state: WorkspaceState,
	input: Omit<Task, "id" | "status">,
	placement: TaskPlacement = { type: "end" },
): WorkspaceState {
	if (
		input.milestoneId &&
		!state.milestones.some((milestone) => milestone.id === input.milestoneId)
	) {
		throw new Error("没有找到指定里程碑");
	}
	const task: Task = { id: makeId(), status: "todo", ...input };
	const insertionIndex = resolveTaskInsertionIndex(
		state.tasks,
		state.milestones,
		task.milestoneId,
		placement,
	);
	const tasks = [...state.tasks];
	tasks.splice(insertionIndex, 0, task);
	return addActivity(
		{ ...state, tasks },
		"task",
		`新增任务：${task.title}`,
	);
}

export function moveTask(
	state: WorkspaceState,
	taskId: string,
	placement: TaskPlacement,
): WorkspaceState {
	const currentIndex = state.tasks.findIndex((task) => task.id === taskId);
	if (currentIndex < 0) throw new Error("没有找到指定任务");
	if (
		(placement.type === "before" || placement.type === "after") &&
		placement.taskId === taskId
	) {
		throw new Error("任务不能相对于自身移动");
	}

	const current = state.tasks[currentIndex];
	const tasks = state.tasks.filter((task) => task.id !== taskId);
	const insertionIndex = resolveTaskInsertionIndex(
		tasks,
		state.milestones,
		current.milestoneId,
		placement,
	);
	tasks.splice(insertionIndex, 0, current);

	return addActivity(
		{ ...state, tasks },
		"task",
		`调整任务顺序：${current.title}`,
	);
}

export function splitTask(
	state: WorkspaceState,
	taskId: string,
	parts: SplitTaskDraft[],
): WorkspaceState {
	const currentIndex = state.tasks.findIndex((task) => task.id === taskId);
	if (currentIndex < 0) throw new Error("没有找到指定任务");
	if (parts.length < 2 || parts.length > 8) {
		throw new Error("任务应拆分为 2–8 个子任务");
	}
	const current = state.tasks[currentIndex];
	if (current.status === "done") throw new Error("已完成任务无需拆分");
	if (state.tasks.length - 1 + parts.length > 80) {
		throw new Error("任务数量超过上限");
	}

	const childTasks: Task[] = parts.map((part) => ({
		id: makeId(),
		title: part.title,
		milestoneId: current.milestoneId,
		status: "todo",
		priority: part.priority ?? current.priority,
		effortMinutes: part.effortMinutes,
		dueDate: part.dueDate === undefined ? current.dueDate : part.dueDate,
	}));
	const tasks = [...state.tasks];
	tasks.splice(currentIndex, 1, ...childTasks);

	return addActivity(
		{ ...state, tasks },
		"task",
		`拆分任务：${current.title} → ${childTasks.length} 个子任务`,
	);
}

function resolveTaskInsertionIndex(
	tasks: Task[],
	milestones: Milestone[],
	milestoneId: string | null,
	placement: TaskPlacement,
): number {
	if (placement.type === "before" || placement.type === "after") {
		const anchorIndex = tasks.findIndex((task) => task.id === placement.taskId);
		if (anchorIndex < 0) throw new Error("没有找到用于定位的任务");
		if (tasks[anchorIndex].milestoneId !== milestoneId) {
			throw new Error("定位任务必须属于同一里程碑");
		}
		return placement.type === "before" ? anchorIndex : anchorIndex + 1;
	}

	if (placement.type === "start") {
		const firstIndex = tasks.findIndex(
			(task) => task.milestoneId === milestoneId,
		);
		return firstIndex < 0
			? findEmptyMilestoneInsertionIndex(tasks, milestones, milestoneId)
			: firstIndex;
	}

	for (let index = tasks.length - 1; index >= 0; index -= 1) {
		if (tasks[index].milestoneId === milestoneId) return index + 1;
	}
	return findEmptyMilestoneInsertionIndex(tasks, milestones, milestoneId);
}

function findEmptyMilestoneInsertionIndex(
	tasks: Task[],
	milestones: Milestone[],
	milestoneId: string | null,
): number {
	const milestoneRank = new Map(
		milestones.map((milestone, index) => [milestone.id, index]),
	);
	const targetRank =
		milestoneId === null
			? milestones.length
			: (milestoneRank.get(milestoneId) ?? milestones.length);
	const nextGroupIndex = tasks.findIndex((task) => {
		const rank =
			task.milestoneId === null
				? milestones.length
				: (milestoneRank.get(task.milestoneId) ?? milestones.length);
		return rank > targetRank;
	});
	return nextGroupIndex < 0 ? tasks.length : nextGroupIndex;
}

export function updateTask(
	state: WorkspaceState,
	taskId: string,
	updates: TaskUpdates,
): WorkspaceState {
	const current = state.tasks.find((task) => task.id === taskId);
	if (!current) throw new Error("没有找到指定任务");

	const tasks = state.tasks.map((task) =>
		task.id === taskId ? { ...task, ...updates } : task,
	);
	const action = updates.status === "done" ? "完成任务" : "更新任务";
	return addActivity(
		{ ...state, tasks },
		"task",
		`${action}：${updates.title ?? current.title}`,
	);
}

export function deleteTask(
	state: WorkspaceState,
	taskId: string,
): WorkspaceState {
	const current = state.tasks.find((task) => task.id === taskId);
	if (!current) throw new Error("没有找到指定任务");

	return addActivity(
		{
			...state,
			tasks: state.tasks.filter((task) => task.id !== taskId),
		},
		"task",
		`删除任务：${current.title}`,
	);
}

export function recordCheckIn(
	state: WorkspaceState,
	input: Omit<CheckIn, "id" | "createdAt">,
): WorkspaceState {
	const checkIn: CheckIn = { id: makeId(), createdAt: now(), ...input };
	return addActivity(
		{ ...state, checkIns: [checkIn, ...state.checkIns].slice(0, 20) },
		"checkin",
		`完成复盘：下一步聚焦「${input.nextFocus}」`,
	);
}

export function resetWorkspace(): WorkspaceState {
	return {
		...EMPTY_WORKSPACE,
		activity: [
			{
				id: makeId(),
				createdAt: now(),
				type: "system",
				message: "工作区已重置",
			},
		],
		updatedAt: now(),
	};
}

export function assertValidWorkspace(state: WorkspaceState): void {
	if (state.version !== 1) throw new Error("不支持的工作区版本");
	if (state.milestones.length > 8) throw new Error("里程碑数量超过上限");
	if (state.tasks.length > 80) throw new Error("任务数量超过上限");
	if (state.checkIns.length > 20) throw new Error("复盘记录数量超过上限");
	if (state.goal && state.goal.title.trim().length === 0) {
		throw new Error("目标标题不能为空");
	}
	for (const task of state.tasks) {
		if (task.title.trim().length === 0) throw new Error("任务标题不能为空");
		if (task.effortMinutes < 5 || task.effortMinutes > 1440) {
			throw new Error("任务投入时间超出允许范围");
		}
	}
}
