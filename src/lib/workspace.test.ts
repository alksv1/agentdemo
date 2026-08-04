import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addTask,
	assertValidWorkspace,
	calculateProgress,
	EMPTY_WORKSPACE,
	moveTask,
	replacePlan,
	splitTask,
	updateTask,
	type PlanDraft,
	type WorkspaceState,
} from "./workspace";

const draft: PlanDraft = {
	goal: {
		title: "上线个人产品",
		motivation: "验证一个真实需求",
		deadline: "2026-11-01",
		weeklyHours: 8,
	},
	milestones: [
		{ title: "验证问题", outcome: "完成 8 次用户访谈" },
		{ title: "发布 MVP", outcome: "让首批用户能完成核心流程" },
	],
	tasks: [
		{
			title: "列出访谈对象",
			milestoneIndex: 0,
			priority: "high",
			effortMinutes: 30,
		},
		{
			title: "定义核心流程",
			milestoneIndex: 1,
			priority: "medium",
			effortMinutes: 60,
		},
	],
};

describe("workspace domain", () => {
	let sequence = 0;

	beforeEach(() => {
		sequence = 0;
		vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
			sequence += 1;
			return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
		});
	});

	it("creates a linked, active plan", () => {
		const state = replacePlan(EMPTY_WORKSPACE, draft);

		expect(state.goal?.title).toBe("上线个人产品");
		expect(state.goal?.status).toBe("active");
		expect(state.milestones).toHaveLength(2);
		expect(state.tasks[0].milestoneId).toBe(state.milestones[0].id);
		expect(state.tasks[1].milestoneId).toBe(state.milestones[1].id);
		expect(state.activity[0].message).toContain("上线个人产品");
	});

	it("calculates progress from completed tasks", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);
		const halfDone = updateTask(planned, planned.tasks[0].id, {
			status: "done",
		});

		expect(calculateProgress(EMPTY_WORKSPACE)).toBe(0);
		expect(calculateProgress(halfDone)).toBe(50);
	});

	it("keeps updates immutable and records activity", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);
		const updated = addTask(planned, {
			title: "邀请第一位访谈对象",
			milestoneId: planned.milestones[0].id,
			priority: "high",
			effortMinutes: 15,
			dueDate: null,
		});

		expect(planned.tasks).toHaveLength(2);
		expect(updated.tasks).toHaveLength(3);
		expect(updated.activity[0].message).toContain("邀请第一位访谈对象");
	});

	it("inserts a new task at its deliberate position", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);
		const updated = addTask(
			planned,
			{
				title: "邀请第一位访谈对象",
				milestoneId: planned.milestones[0].id,
				priority: "high",
				effortMinutes: 15,
				dueDate: null,
			},
			{ type: "after", taskId: planned.tasks[0].id },
		);

		expect(updated.tasks.map((task) => task.title)).toEqual([
			"列出访谈对象",
			"邀请第一位访谈对象",
			"定义核心流程",
		]);
	});

	it("rejects relative placement across milestones", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);

		expect(() =>
			addTask(
				planned,
				{
					title: "错误位置任务",
					milestoneId: planned.milestones[0].id,
					priority: "low",
					effortMinutes: 15,
					dueDate: null,
				},
				{ type: "after", taskId: planned.tasks[1].id },
			),
		).toThrow("定位任务必须属于同一里程碑");
	});

	it("moves tasks without changing status or enforcing completion order", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);
		const withSecondTask = addTask(
			planned,
			{
				title: "邀请访谈对象",
				milestoneId: planned.milestones[0].id,
				priority: "medium",
				effortMinutes: 20,
				dueDate: null,
			},
			{ type: "after", taskId: planned.tasks[0].id },
		);
		const taskToMove = withSecondTask.tasks[1];
		const moved = moveTask(withSecondTask, taskToMove.id, {
			type: "before",
			taskId: withSecondTask.tasks[0].id,
		});
		const completedOutOfOrder = updateTask(
			moved,
			moved.tasks[1].id,
			{ status: "done" },
		);

		expect(moved.tasks.map((task) => task.title)).toEqual([
			"邀请访谈对象",
			"列出访谈对象",
			"定义核心流程",
		]);
		expect(moved.tasks[0].status).toBe("todo");
		expect(completedOutOfOrder.tasks.map((task) => task.title)).toEqual(
			moved.tasks.map((task) => task.title),
		);
		expect(completedOutOfOrder.tasks[1].status).toBe("done");
	});

	it("replaces a split task with ordered children at the same position", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);
		const split = splitTask(planned, planned.tasks[0].id, [
			{
				title: "整理访谈名单",
				priority: "high",
				effortMinutes: 20,
			},
			{
				title: "发送访谈邀请",
				priority: "medium",
				effortMinutes: 25,
			},
		]);

		expect(split.tasks.map((task) => task.title)).toEqual([
			"整理访谈名单",
			"发送访谈邀请",
			"定义核心流程",
		]);
		expect(split.tasks[0].milestoneId).toBe(planned.milestones[0].id);
		expect(split.tasks[1].milestoneId).toBe(planned.milestones[0].id);
		expect(split.tasks.some((task) => task.id === planned.tasks[0].id)).toBe(
			false,
		);
	});

	it("rejects tasks linked to an unknown milestone", () => {
		const planned = replacePlan(EMPTY_WORKSPACE, draft);

		expect(() =>
			addTask(planned, {
				title: "错误关联任务",
				milestoneId: "00000000-0000-4000-8000-999999999999",
				priority: "low",
				effortMinutes: 15,
				dueDate: null,
			}),
		).toThrow("没有找到指定里程碑");
	});

	it("rejects invalid state before persistence", () => {
		const invalid = {
			...EMPTY_WORKSPACE,
			tasks: Array.from({ length: 81 }, (_, index) => ({
				id: String(index),
				title: `任务 ${index}`,
				milestoneId: null,
				status: "todo" as const,
				priority: "low" as const,
				effortMinutes: 20,
				dueDate: null,
			})),
		} satisfies WorkspaceState;

		expect(() => assertValidWorkspace(invalid)).toThrow("任务数量超过上限");
	});
});
