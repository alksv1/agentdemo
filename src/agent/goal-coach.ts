import { AIChatAgent } from "@cloudflare/ai-chat";
import {
	convertToModelMessages,
	isStepCount,
	streamText,
	tool,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { callable, type Connection } from "agents";
import {
	getRetractedUserMessageIds,
	truncateConversationAt,
} from "@/lib/chat-history";
import {
	getCurrentTimeContext,
	type CurrentTimeContext,
} from "@/lib/time-context";
import {
	addTask,
	assertValidWorkspace,
	EMPTY_WORKSPACE,
	moveTask,
	recordCheckIn,
	replacePlan,
	resetWorkspace,
	splitTask,
	updateTask,
	type WorkspaceState,
} from "@/lib/workspace";

const nullableDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.nullable()
	.optional();

const priority = z.enum(["high", "medium", "low"]);
const taskStatus = z.enum(["todo", "doing", "done", "blocked"]);
const taskPlacementSchema = z
	.discriminatedUnion("type", [
		z.object({ type: z.literal("start") }),
		z.object({ type: z.literal("end") }),
		z.object({ type: z.literal("before"), taskId: z.string().uuid() }),
		z.object({ type: z.literal("after"), taskId: z.string().uuid() }),
	])
	.describe(
		"任务在所属里程碑中的建议位置。before/after 必须引用同一里程碑的任务。",
	);

const planSchema = z.object({
	goal: z.object({
		title: z.string().min(2).max(80),
		motivation: z.string().min(2).max(240),
		deadline: nullableDate,
		weeklyHours: z.number().min(1).max(80),
	}),
	milestones: z
		.array(
			z.object({
				title: z.string().min(2).max(80),
				outcome: z.string().min(2).max(180),
				targetDate: nullableDate,
			}),
		)
		.min(1)
		.max(8),
	tasks: z
		.array(
			z.object({
				title: z.string().min(2).max(100),
				milestoneIndex: z.number().int().min(0).max(7).nullable().optional(),
				priority,
				effortMinutes: z.number().int().min(5).max(1440),
				dueDate: nullableDate,
			}),
		)
		.min(1)
		.max(24)
		.describe("严格按建议执行路径排列，前置准备在前、后续交付在后。"),
});

function systemPrompt(
	state: WorkspaceState,
	currentTime: CurrentTimeContext,
): string {
	return `你是 Northstar，一位清醒、务实、有同理心的中文目标执行教练。

你的职责不是泛泛鼓励，而是把目标变成用户今天能开始的行动系统。先理解动机、期限、每周可投入时间和现实限制，再给建议。

工作原则：
1. 新工作区信息不足时，先用 2–4 个简短问题澄清；信息足够后调用 replace_plan 建立结构化计划。
2. 每个计划保持 2–5 个里程碑、3–12 个具体任务；任务应以动词开头，可在一次专注时段内完成。
3. 用户汇报进展时，主动调用 update_task 或 record_checkin，让看板与对话保持一致。
4. 不要声称修改了计划，除非你确实调用了工具。工具成功后，用一两句话总结变化。
5. 当用户卡住时，缩小下一步，而不是增加更多任务。
6. 涉及替换已有计划或重置工作区时，清楚解释影响并等待审批。
7. 日期使用 YYYY-MM-DD。所有“今天、明天、本周、下周、N 天后”的计算必须以文末的权威当前时间为基准，不能凭模型记忆猜测日期。
8. 回复保持简洁、具体，默认使用中文。
9. tasks 数组的先后顺序就是展示给用户的建议执行路径。建立计划时按依赖与逻辑先后排列，但不得把它当成完成前置约束；用户可以自由跳过或乱序完成。
10. 新增任务时必须判断它属于哪个里程碑、应该位于哪个任务之前或之后，并通过 placement 明确位置；不要习惯性追加到末尾。
11. 用户要求拆分任务时调用 split_task，让子任务原位替换原任务并保持内部顺序；不要用多次 add_task 把子任务散落到列表末尾。
12. 用户要求调整执行路径时调用 move_task，只改变建议顺序，不改变任务状态。
13. 制定含日期的计划前先核对权威当前时间；如果对话持续较久、用户询问现在几点或时间边界有歧义，调用 get_current_time 刷新时间。

权威当前时间（由 Cloudflare Worker 提供）：
- UTC：${currentTime.utcIso}
- 用户本地：${currentTime.localDate} ${currentTime.localTime} ${currentTime.weekday}
- 时区：${currentTime.timeZone}（${currentTime.utcOffset}）
- “今天”明确指 ${currentTime.localDate}

当前结构化工作区：
${JSON.stringify(state)}`;
}

export class GoalCoachV2 extends AIChatAgent<Cloudflare.Env, WorkspaceState> {
	override initialState: WorkspaceState = EMPTY_WORKSPACE;
	override maxPersistedMessages = 120;
	override messageConcurrency = "queue" as const;
	override chatRecovery = {
		maxAttempts: 3,
		noProgressTimeoutMs: 2 * 60 * 1000,
		maxRecoveryWork: 120,
		terminalMessage: "这次生成被中断了。你的计划数据没有丢失，可以直接继续。",
	};
	override chatStreamStallTimeoutMs = 90_000;

	override onStart(): void {
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS workspace_checkpoints (
				revision INTEGER PRIMARY KEY AUTOINCREMENT,
				user_message_id TEXT NOT NULL UNIQUE,
				state_json TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS workspace_checkpoints_message_id
			ON workspace_checkpoints(user_message_id);
		`);
	}

	private saveWorkspaceCheckpoint(userMessageId: string): void {
		if (!userMessageId || userMessageId.length > 200) return;
		this.ctx.storage.sql.exec(
			`INSERT OR IGNORE INTO workspace_checkpoints
				(user_message_id, state_json, created_at)
			 VALUES (?, ?, ?)`,
			userMessageId,
			JSON.stringify(this.state),
			Date.now(),
		);
		this.ctx.storage.sql.exec(`
			DELETE FROM workspace_checkpoints
			WHERE revision NOT IN (
				SELECT revision FROM workspace_checkpoints
				ORDER BY revision DESC
				LIMIT 160
			)
		`);
	}

	@callable()
	rollbackWorkspaceForMessages(messageIds: string[]): {
		checkpointFound: boolean;
		workspaceChanged: boolean;
		revertedTurns: number;
	} {
		const uniqueMessageIds = [
			...new Set(
				messageIds.filter(
					(id) => typeof id === "string" && id.length > 0 && id.length <= 200,
				),
			),
		].slice(0, this.maxPersistedMessages);
		if (uniqueMessageIds.length === 0) {
			return {
				checkpointFound: false,
				workspaceChanged: false,
				revertedTurns: 0,
			};
		}

		const placeholders = uniqueMessageIds.map(() => "?").join(", ");
		const checkpoint = this.ctx.storage.sql
			.exec<{ revision: number; state_json: string }>(
				`SELECT revision, state_json
				 FROM workspace_checkpoints
				 WHERE user_message_id IN (${placeholders})
				 ORDER BY revision ASC
				 LIMIT 1`,
				...uniqueMessageIds,
			)
			.toArray()[0];

		if (!checkpoint) {
			return {
				checkpointFound: false,
				workspaceChanged: false,
				revertedTurns: 0,
			};
		}

		const snapshot: unknown = JSON.parse(checkpoint.state_json);
		assertValidWorkspace(snapshot as WorkspaceState);
		const revertedTurns = this.ctx.storage.sql
			.exec<{ count: number }>(
				"SELECT COUNT(*) AS count FROM workspace_checkpoints WHERE revision >= ?",
				checkpoint.revision,
			)
			.one().count;
		const workspaceChanged =
			checkpoint.state_json !== JSON.stringify(this.state);

		this.ctx.storage.sql.exec(
			"DELETE FROM workspace_checkpoints WHERE revision >= ?",
			checkpoint.revision,
		);
		this.setState(snapshot as WorkspaceState);

		return { checkpointFound: true, workspaceChanged, revertedTurns };
	}

	@callable()
	async retractConversationFromMessage(messageId: string): Promise<{
		messageFound: boolean;
		deletedMessages: number;
		checkpointFound: boolean;
		workspaceChanged: boolean;
		revertedTurns: number;
	}> {
		if (
			typeof messageId !== "string" ||
			messageId.length === 0 ||
			messageId.length > 200
		) {
			return {
				messageFound: false,
				deletedMessages: 0,
				checkpointFound: false,
				workspaceChanged: false,
				revertedTurns: 0,
			};
		}

		const remainingMessages = truncateConversationAt(this.messages, messageId);
		if (remainingMessages === this.messages) {
			return {
				messageFound: false,
				deletedMessages: 0,
				checkpointFound: false,
				workspaceChanged: false,
				revertedTurns: 0,
			};
		}

		const deletedMessages = this.messages.length - remainingMessages.length;
		const retractedUserMessageIds = getRetractedUserMessageIds(
			this.messages,
			messageId,
		);
		const rollback = this.rollbackWorkspaceForMessages(retractedUserMessageIds);

		// A regular client message sync only inserts or updates rows. Explicitly
		// remove stale rows so this branch cannot reappear in future model context.
		await this.persistMessages(remainingMessages, [], {
			_deleteStaleRows: true,
		});

		return {
			messageFound: true,
			deletedMessages,
			...rollback,
		};
	}

	override validateStateChange(
		nextState: WorkspaceState,
		source: Connection | "server",
	): void {
		if (source !== "server") {
			throw new Error("工作区只能由 Northstar 的服务器工具更新");
		}
		assertValidWorkspace(nextState);
	}

	override async onChatMessage(
		onFinish: Parameters<AIChatAgent["onChatMessage"]>[0],
		options?: Parameters<AIChatAgent["onChatMessage"]>[1],
	): Promise<Response> {
		const workersai = createWorkersAI({ binding: this.env.AI });
		const requestedTimeZone =
			typeof options?.body?.timezone === "string"
				? options.body.timezone.slice(0, 80)
				: undefined;
		const currentTime = getCurrentTimeContext(requestedTimeZone);
		const triggerMessageId =
			[...this.messages]
				.reverse()
				.find((message) => message.role === "user")?.id ?? options?.requestId;
		if (triggerMessageId) this.saveWorkspaceCheckpoint(triggerMessageId);

		const tools = {
			get_current_time: tool({
				description:
					"获取 Cloudflare Worker 的当前 UTC 时间，并转换为用户时区。处理今天、明天、本周、截止日期或当前时间时使用。",
				inputSchema: z.object({}),
				execute: () => getCurrentTimeContext(currentTime.timeZone),
			}),
			replace_plan: tool({
				description:
					"建立完整行动计划，或在用户明确要求时替换现有计划。里程碑索引从 0 开始。",
				inputSchema: planSchema,
				execute: (draft) => {
					const nextState = replacePlan(this.state, draft);
					this.setState(nextState);
					return {
						ok: true,
						goal: nextState.goal?.title,
						milestones: nextState.milestones.length,
						tasks: nextState.tasks.length,
					};
				},
			}),
			add_task: tool({
				description:
					"向现有计划加入一个具体、可执行的任务。必须根据逻辑依赖明确 placement，不能默认堆到任务末尾。",
				inputSchema: z.object({
					title: z.string().min(2).max(100),
					milestoneId: z.string().uuid().nullable().optional(),
					priority,
					effortMinutes: z.number().int().min(5).max(1440),
					dueDate: nullableDate,
					placement: taskPlacementSchema,
				}),
				execute: (input) => {
					const previousTaskIds = new Set(
						this.state.tasks.map((task) => task.id),
					);
					const nextState = addTask(
						this.state,
						{
							title: input.title,
							milestoneId: input.milestoneId ?? null,
							priority: input.priority,
							effortMinutes: input.effortMinutes,
							dueDate: input.dueDate ?? null,
						},
						input.placement,
					);
					const insertedTask = nextState.tasks.find(
						(task) => !previousTaskIds.has(task.id),
					);
					this.setState(nextState);
					return {
						ok: true,
						task: insertedTask,
						position: insertedTask
							? nextState.tasks.findIndex((task) => task.id === insertedTask.id) +
								1
							: null,
					};
				},
			}),
			move_task: tool({
				description:
					"调整任务在建议执行路径中的位置，不改变任务状态，也不限制用户按其他顺序完成。",
				inputSchema: z.object({
					taskId: z.string().uuid(),
					placement: taskPlacementSchema,
				}),
				execute: ({ taskId, placement }) => {
					const nextState = moveTask(this.state, taskId, placement);
					this.setState(nextState);
					return {
						ok: true,
						task: nextState.tasks.find((task) => task.id === taskId),
						position:
							nextState.tasks.findIndex((task) => task.id === taskId) + 1,
					};
				},
			}),
			split_task: tool({
				description:
					"将一个未完成任务拆成 2–8 个有序子任务。子任务会在原任务的位置原位替换，必须按建议执行路径排列。",
				inputSchema: z.object({
					taskId: z.string().uuid(),
					parts: z
						.array(
							z.object({
								title: z.string().min(2).max(100),
								priority: priority.optional(),
								effortMinutes: z.number().int().min(5).max(1440),
								dueDate: nullableDate,
							}),
						)
						.min(2)
						.max(8),
				}),
				execute: ({ taskId, parts }) => {
					const originalIndex = this.state.tasks.findIndex(
						(task) => task.id === taskId,
					);
					const nextState = splitTask(this.state, taskId, parts);
					const insertedTasks = nextState.tasks.slice(
						originalIndex,
						originalIndex + parts.length,
					);
					this.setState(nextState);
					return {
						ok: true,
						position: originalIndex + 1,
						tasks: insertedTasks,
					};
				},
			}),
			update_task: tool({
				description: "更新任务标题、状态、优先级或截止日期。",
				inputSchema: z.object({
					taskId: z.string().uuid(),
					title: z.string().min(2).max(100).optional(),
					status: taskStatus.optional(),
					priority: priority.optional(),
					dueDate: nullableDate,
				}),
				execute: ({ taskId, ...updates }) => {
					const filtered = Object.fromEntries(
						Object.entries(updates).filter(([, value]) => value !== undefined),
					);
					const nextState = updateTask(this.state, taskId, filtered);
					this.setState(nextState);
					return {
						ok: true,
						task: nextState.tasks.find((task) => task.id === taskId),
					};
				},
			}),
			record_checkin: tool({
				description: "记录用户的一次进度复盘，包括成果、阻碍和下一步。",
				inputSchema: z.object({
					mood: z.enum(["energized", "steady", "stuck"]),
					win: z.string().max(240),
					blocker: z.string().max(240),
					nextFocus: z.string().min(2).max(160),
				}),
				execute: (input) => {
					const nextState = recordCheckIn(this.state, input);
					this.setState(nextState);
					return { ok: true, checkIn: nextState.checkIns[0] };
				},
			}),
			reset_workspace: tool({
				description:
					"清空当前目标、里程碑、任务和复盘记录。仅在用户明确要求彻底重置时使用。",
				inputSchema: z.object({
					reason: z.string().min(2).max(160),
				}),
				execute: () => {
					const nextState = resetWorkspace();
					this.setState(nextState);
					return { ok: true };
				},
			}),
		};

		const result = streamText({
			model: workersai("@cf/zai-org/glm-4.7-flash", {
				sessionAffinity: this.sessionAffinity,
				reasoning_effort: "low",
			}),
			system: systemPrompt(this.state, currentTime),
			messages: await convertToModelMessages(this.messages.slice(-36)),
			tools,
			toolApproval: {
				replace_plan: () =>
					this.state.goal === null ? "approved" : "user-approval",
				reset_workspace: "user-approval",
			},
			stopWhen: isStepCount(8),
			abortSignal: options?.abortSignal,
			onFinish,
			onError: ({ error }) => {
				console.error(
					JSON.stringify({
						message: "goal coach stream failed",
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			},
		});

		return result.toUIMessageStreamResponse();
	}
}
