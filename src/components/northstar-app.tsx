"use client";

import {
	getToolApproval,
	getToolInput,
	getToolPartState,
	useAgentChat,
} from "@cloudflare/ai-chat/react";
import {
	ArrowUp,
	CalendarDays,
	Check,
	CheckCircle2,
	ChevronRight,
	Circle,
	Clock3,
	Compass,
	Copy,
	Ellipsis,
	Flame,
	History,
	LoaderCircle,
	LockKeyhole,
	MessageSquareText,
	Milestone as MilestoneIcon,
	PanelRightClose,
	PanelRightOpen,
	Pencil,
	Plus,
	RefreshCcw,
	RotateCcw,
	ShieldCheck,
	Sparkles,
	Square,
	Target,
	Undo2,
	WifiOff,
	X,
} from "lucide-react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useAgent } from "agents/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { MarkdownMessage } from "@/components/markdown-message";
import { getMessageText, truncateConversationAt } from "@/lib/chat-history";
import {
	calculateProgress,
	EMPTY_WORKSPACE,
	type Activity,
	type Task,
	type WorkspaceState,
} from "@/lib/workspace";
import { resizeTextarea } from "@/lib/textarea";
import {
	CURRENT_WORKSPACE_KEY,
	initializeWorkspaceDirectory,
	isWorkspaceId,
	saveWorkspaceDirectory,
	type WorkspaceEntry,
	upsertWorkspace,
} from "@/lib/workspace-directory";

type WorkspaceView = "conversation" | "plan" | "activity";
type WorkspaceRollbackResult = {
	messageFound: boolean;
	deletedMessages: number;
	checkpointFound: boolean;
	workspaceChanged: boolean;
	revertedTurns: number;
};
type RollbackNotice = {
	tone: "success" | "warning" | "error";
	message: string;
};

const STARTERS = [
	"我想在 12 周内上线一个个人产品",
	"帮我规划一次职业转型",
	"我有目标，但最近总是拖延",
];

const TASK_PAGE_SIZE = 6;

const TOOL_LABELS: Record<string, string> = {
	get_current_time: "获取当前时间",
	replace_plan: "建立行动计划",
	add_task: "新增任务",
	move_task: "调整任务顺序",
	split_task: "拆分任务",
	update_task: "更新任务",
	record_checkin: "记录进度复盘",
	reset_workspace: "重置工作区",
};

function createWorkspaceId(): string {
	return crypto.randomUUID();
}

function formatDate(date: string | null | undefined): string {
	if (!date) return "未设置";
	return new Intl.DateTimeFormat("zh-CN", {
		month: "short",
		day: "numeric",
	}).format(new Date(`${date}T00:00:00`));
}

function relativeTime(value: string): string {
	const diff = Date.now() - new Date(value).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	return `${Math.floor(hours / 24)} 天前`;
}

function NorthstarMark({ compact = false }: { compact?: boolean }) {
	return (
		<div className="brand-mark" aria-label="Northstar">
			<span className="brand-icon">
				<Compass size={compact ? 17 : 19} strokeWidth={2.1} />
			</span>
			{!compact && (
				<span>
					<strong>Northstar</strong>
					<small>AI EXECUTION COACH</small>
				</span>
			)}
		</div>
	);
}

function LoadingScreen() {
	return (
		<main className="boot-screen">
			<div className="boot-orbit">
				<NorthstarMark compact />
			</div>
			<p>正在定位你的工作区…</p>
		</main>
	);
}

export function NorthstarApp() {
	const [workspaceId, setWorkspaceId] = useState<string | null>(null);
	const [workspaceDirectory, setWorkspaceDirectory] = useState<WorkspaceEntry[]>(
		[],
	);

	useEffect(() => {
		const session = initializeWorkspaceDirectory(
			window.localStorage,
			createWorkspaceId,
		);
		// Browser storage is unavailable during SSR, so the client hydrates the
		// capability-scoped workspace directory after mount.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setWorkspaceDirectory(session.directory);
		setWorkspaceId(session.currentId);
	}, []);

	const selectWorkspace = useCallback((nextId: string) => {
		setWorkspaceDirectory((current) => {
			const next = upsertWorkspace(current, nextId);
			saveWorkspaceDirectory(window.localStorage, next);
			return next;
		});
		window.localStorage.setItem(CURRENT_WORKSPACE_KEY, nextId);
		setWorkspaceId(nextId);
	}, []);

	const createWorkspace = useCallback(() => {
		selectWorkspace(createWorkspaceId());
	}, [selectWorkspace]);

	const rememberWorkspaceTitle = useCallback((id: string, title: string) => {
		setWorkspaceDirectory((current) => {
			const existing = current.find((entry) => entry.id === id);
			if (!existing || existing.title === title) return current;
			const next = upsertWorkspace(current, id, {
				title,
				openedAt: existing.lastOpenedAt,
			});
			saveWorkspaceDirectory(window.localStorage, next);
			return next;
		});
	}, []);

	if (!workspaceId) return <LoadingScreen />;
	return (
		<ConnectedWorkspace
			key={workspaceId}
			workspaceId={workspaceId}
			workspaceDirectory={workspaceDirectory}
			onCreateWorkspace={createWorkspace}
			onSelectWorkspace={selectWorkspace}
			onWorkspaceTitle={rememberWorkspaceTitle}
		/>
	);
}

function ConnectedWorkspace({
	workspaceId,
	workspaceDirectory,
	onCreateWorkspace,
	onSelectWorkspace,
	onWorkspaceTitle,
}: {
	workspaceId: string;
	workspaceDirectory: WorkspaceEntry[];
	onCreateWorkspace: () => void;
	onSelectWorkspace: (id: string) => void;
	onWorkspaceTitle: (id: string, title: string) => void;
}) {
	const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY_WORKSPACE);
	const [composer, setComposer] = useState("");
	const [rightPanelOpen, setRightPanelOpen] = useState(false);
	const [activeView, setActiveView] = useState<WorkspaceView>("conversation");
	const [insightNavigation, setInsightNavigation] = useState({
		target: "plan" as Exclude<WorkspaceView, "conversation">,
		request: 0,
	});
	const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
	const [pendingRetractId, setPendingRetractId] = useState<string | null>(null);
	const [rollbackPendingId, setRollbackPendingId] = useState<string | null>(null);
	const [rollbackNotice, setRollbackNotice] = useState<RollbackNotice | null>(
		null,
	);
	const [pendingEditedSubmission, setPendingEditedSubmission] = useState<{
		content: string;
		historyLength: number;
	} | null>(null);
	const [copied, setCopied] = useState(false);
	const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
	const [importedWorkspaceId, setImportedWorkspaceId] = useState("");
	const [workspaceImportError, setWorkspaceImportError] = useState("");
	const messageScrollerRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const shouldStickToBottomRef = useRef(true);

	useLayoutEffect(() => {
		resizeTextarea(composerRef.current);
	}, [composer]);

	const agent = useAgent<WorkspaceState>({
		agent: "GoalCoachV2",
		name: workspaceId,
		onStateUpdate: (nextWorkspace) => {
			setWorkspace(nextWorkspace);
			if (nextWorkspace.goal?.title) {
				onWorkspaceTitle(workspaceId, nextWorkspace.goal.title);
			}
		},
	});

	const {
		messages,
		sendMessage,
		status,
		isStreaming,
		isRecovering,
		connectionError,
		stop,
		clearHistory,
		setMessages,
		addToolApprovalResponse,
	} = useAgentChat({
		agent,
		body: () => ({
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		}),
	});

	const progress = calculateProgress(workspace);
	const completedTasks = workspace.tasks.filter(
		(task) => task.status === "done",
	).length;
	const activeTasks = workspace.tasks.filter(
		(task) => task.status !== "done",
	);
	const isBusy =
		isStreaming ||
		isRecovering ||
		status === "submitted" ||
		pendingEditedSubmission !== null ||
		rollbackPendingId !== null;

	const navigateTo = useCallback((view: WorkspaceView) => {
		setActiveView(view);
		if (view === "conversation") {
			setRightPanelOpen(false);
			window.requestAnimationFrame(() => composerRef.current?.focus());
			return;
		}
		setRightPanelOpen(true);
		setInsightNavigation((current) => ({
			target: view,
			request: current.request + 1,
		}));
	}, []);

	const scrollMessagesToBottom = useCallback(
		(behavior: ScrollBehavior = "smooth") => {
			const scroller = messageScrollerRef.current;
			if (!scroller) return;
			scroller.scrollTo({ top: scroller.scrollHeight, behavior });
		},
		[],
	);

	useEffect(() => {
		if (!shouldStickToBottomRef.current) return;
		const frame = window.requestAnimationFrame(() => {
			scrollMessagesToBottom(isBusy ? "auto" : "smooth");
		});
		return () => window.cancelAnimationFrame(frame);
	}, [isBusy, messages, scrollMessagesToBottom]);

	useEffect(() => {
		if (
			!pendingEditedSubmission ||
			messages.length !== pendingEditedSubmission.historyLength
		) {
			return;
		}
		shouldStickToBottomRef.current = true;
		void sendMessage({ text: pendingEditedSubmission.content });
		// The edited turn is submitted only after useAgentChat exposes the
		// truncated transcript from setMessages.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setPendingEditedSubmission(null);
	}, [messages.length, pendingEditedSubmission, sendMessage]);

	const handleMessageScroll = useCallback(() => {
		const scroller = messageScrollerRef.current;
		if (!scroller) return;
		const distanceFromBottom =
			scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		shouldStickToBottomRef.current = distanceFromBottom < 96;
	}, []);

	const retractConversationFromMessage = useCallback(
		async (messageId: string): Promise<void> => {
			const result = await agent.call<WorkspaceRollbackResult>(
				"retractConversationFromMessage",
				[messageId],
				{ timeout: 10_000 },
			);
			if (!result.messageFound || result.deletedMessages === 0) {
				throw new Error("服务端找不到要撤回的消息");
			}
			if (!result.checkpointFound) {
				setRollbackNotice({
					tone: "warning",
					message:
						"对话与模型上下文已删除，但这条旧消息早于回退功能，无法自动恢复当时的工作区。",
				});
				return;
			}
			setRollbackNotice({
				tone: "success",
				message: result.workspaceChanged
					? `对话上下文与工作区均已回退，并撤销 ${result.revertedTurns} 轮变更。`
					: "对话与模型上下文已删除；该分支没有产生工作区变更。",
			});
		},
		[agent],
	);

	const submitText = useCallback(
		async (text: string) => {
			const content = text.trim();
			if (!content || isBusy) return;
			if (editingMessageId) {
				setRollbackPendingId(editingMessageId);
				setRollbackNotice(null);
				try {
					await retractConversationFromMessage(editingMessageId);
				} catch {
					setRollbackNotice({
						tone: "error",
						message: "撤回失败，原消息和工作区均已保留，请稍后重试。",
					});
					return;
				} finally {
					setRollbackPendingId(null);
				}
				const nextMessages = truncateConversationAt(messages, editingMessageId);
				setMessages(nextMessages);
				setPendingEditedSubmission({
					content,
					historyLength: nextMessages.length,
				});
				setEditingMessageId(null);
				setPendingRetractId(null);
				setComposer("");
				return;
			}
			setPendingRetractId(null);
			shouldStickToBottomRef.current = true;
			void sendMessage({ text: content });
			setComposer("");
		},
		[
			editingMessageId,
			isBusy,
			messages,
			retractConversationFromMessage,
			sendMessage,
			setMessages,
		],
	);

	const beginEditingMessage = useCallback(
		(message: UIMessage) => {
			if (isBusy) return;
			setEditingMessageId(message.id);
			setPendingRetractId(null);
			setComposer(getMessageText(message));
			window.requestAnimationFrame(() => composerRef.current?.focus());
		},
		[isBusy],
	);

	const cancelEditingMessage = useCallback(() => {
		setEditingMessageId(null);
		setComposer("");
	}, []);

	const retractMessage = useCallback(
		async (messageId: string) => {
			if (isBusy) return;
			if (pendingRetractId !== messageId) {
				setPendingRetractId(messageId);
				return;
			}
			setRollbackPendingId(messageId);
			setRollbackNotice(null);
			try {
				await retractConversationFromMessage(messageId);
			} catch {
				setRollbackNotice({
					tone: "error",
					message: "撤回失败，原消息和工作区均已保留，请稍后重试。",
				});
				setPendingRetractId(null);
				return;
			} finally {
				setRollbackPendingId(null);
			}
			setMessages(truncateConversationAt(messages, messageId));
			if (editingMessageId === messageId) cancelEditingMessage();
			setPendingRetractId(null);
		},
		[
			cancelEditingMessage,
			editingMessageId,
			isBusy,
			messages,
			pendingRetractId,
			retractConversationFromMessage,
			setMessages,
		],
	);

	const handleClearHistory = useCallback(() => {
		setEditingMessageId(null);
		setPendingRetractId(null);
		setPendingEditedSubmission(null);
		setRollbackPendingId(null);
		setRollbackNotice(null);
		setComposer("");
		clearHistory();
	}, [clearHistory]);

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		void submitText(composer);
	};

	const copyWorkspaceId = async () => {
		await navigator.clipboard.writeText(workspaceId);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	const handleWorkspaceImport = (event: FormEvent) => {
		event.preventDefault();
		const nextId = importedWorkspaceId.trim();
		if (!isWorkspaceId(nextId)) {
			setWorkspaceImportError("请输入有效的工作区 ID");
			return;
		}
		setWorkspaceImportError("");
		setImportedWorkspaceId("");
		setWorkspaceMenuOpen(false);
		onSelectWorkspace(nextId);
	};

	return (
		<main
			className={`app-shell ${rightPanelOpen ? "with-insights" : "without-insights"}`}
		>
			<aside className="sidebar">
				<div className="sidebar-top">
					<NorthstarMark />
					<button className="icon-button mobile-only" aria-label="菜单">
						<Ellipsis size={18} />
					</button>
				</div>

				<button className="new-thread-button" onClick={onCreateWorkspace}>
					<Plus size={17} />
					新建目标空间
				</button>

				<nav className="main-nav" aria-label="主导航">
					<button
						type="button"
						className={`nav-item ${activeView === "conversation" ? "active" : ""}`}
						onClick={() => navigateTo("conversation")}
					>
						<MessageSquareText size={17} />
						教练对话
						{activeView === "conversation" && <span className="nav-pulse" />}
					</button>
					<button
						type="button"
						className={`nav-item ${activeView === "plan" ? "active" : ""}`}
						onClick={() => navigateTo("plan")}
					>
						<Target size={17} />
						行动计划
						<span className="nav-count">{activeTasks.length}</span>
					</button>
					<button
						type="button"
						className={`nav-item ${activeView === "activity" ? "active" : ""}`}
						onClick={() => navigateTo("activity")}
					>
						<History size={17} />
						进度记录
					</button>
				</nav>

				{workspace.goal ? (
					<section className="goal-mini-card">
						<div className="eyebrow-row">
							<span>当前航向</span>
							<span className="live-dot">进行中</span>
						</div>
						<h2>{workspace.goal.title}</h2>
						<div className="mini-progress-track">
							<span style={{ width: `${progress}%` }} />
						</div>
						<div className="goal-mini-meta">
							<span>{progress}% 完成</span>
							<span>{formatDate(workspace.goal.deadline)}</span>
						</div>
					</section>
				) : (
					<section className="goal-mini-card empty">
						<Sparkles size={17} />
						<p>告诉教练你想抵达哪里，我们会一起画出路线。</p>
					</section>
				)}

				<div className="sidebar-footer">
					{workspaceMenuOpen && (
						<div className="workspace-menu">
							<div className="workspace-menu-heading">
								<strong>目标空间</strong>
								<span>{workspaceDirectory.length} 个</span>
							</div>
							<div className="workspace-list">
								{workspaceDirectory.map((entry) => (
									<button
										type="button"
										className={`workspace-option ${entry.id === workspaceId ? "active" : ""}`}
										key={entry.id}
										onClick={() => {
											setWorkspaceMenuOpen(false);
											onSelectWorkspace(entry.id);
										}}
									>
										<span>
											<strong>{entry.title}</strong>
											<small>{relativeTime(entry.lastOpenedAt)}</small>
										</span>
										{entry.id === workspaceId && <Check size={14} />}
									</button>
								))}
							</div>
							<form className="workspace-import" onSubmit={handleWorkspaceImport}>
								<label htmlFor="workspace-id-import">找回已有空间</label>
								<div>
									<input
										id="workspace-id-import"
										value={importedWorkspaceId}
										onChange={(event) => {
											setImportedWorkspaceId(event.target.value);
											setWorkspaceImportError("");
										}}
										placeholder="粘贴工作区 ID"
									/>
									<button type="submit">打开</button>
								</div>
								{workspaceImportError && <p>{workspaceImportError}</p>}
							</form>
							<button
								type="button"
								className="copy-workspace-id"
								onClick={() => void copyWorkspaceId()}
							>
								{copied ? <Check size={13} /> : <Copy size={13} />}
								{copied ? "已复制当前 ID" : "复制当前工作区 ID"}
							</button>
						</div>
					)}
					<button
						className="workspace-chip"
						onClick={() => setWorkspaceMenuOpen((open) => !open)}
						aria-expanded={workspaceMenuOpen}
					>
						<span className="avatar">NS</span>
						<span>
							<strong>
								{workspaceDirectory.find((entry) => entry.id === workspaceId)
									?.title ?? "私人工作区"}
							</strong>
							<small>{workspaceId.slice(0, 8)}</small>
						</span>
						<ChevronRight
							size={15}
							className={workspaceMenuOpen ? "workspace-menu-chevron open" : "workspace-menu-chevron"}
						/>
					</button>
				</div>
			</aside>

			<section className="conversation" id="conversation">
				<header className="conversation-header">
					<div>
						<div className="coach-identity">
							<span className="coach-avatar">
								<Sparkles size={18} />
							</span>
							<div>
								<h1>Northstar 教练</h1>
								<p>
									<span className={connectionError ? "offline" : "online"} />
									{connectionError ? "连接已中断" : "实时同步中"}
								</p>
							</div>
						</div>
					</div>
					<div className="header-actions">
						<button
							className="icon-button"
							onClick={handleClearHistory}
							aria-label="清空对话历史"
							title="清空对话历史"
						>
							<RotateCcw size={17} />
						</button>
						<button
							className="icon-button desktop-panel-toggle"
							onClick={() =>
								rightPanelOpen ? navigateTo("conversation") : navigateTo("plan")
							}
							aria-label={rightPanelOpen ? "收起进度面板" : "展开进度面板"}
						>
							{rightPanelOpen ? (
								<PanelRightClose size={18} />
							) : (
								<PanelRightOpen size={18} />
							)}
						</button>
					</div>
				</header>

				<div
					className="message-scroller"
					ref={messageScrollerRef}
					onScroll={handleMessageScroll}
				>
					<div className="message-column">
						{messages.length === 0 ? (
							<WelcomeState onStarter={submitText} />
						) : (
							messages.map((message) => (
								<MessageBubble
									key={message.id}
									message={message}
									disabled={isBusy}
									isEditing={editingMessageId === message.id}
									isRetractPending={pendingRetractId === message.id}
									onEdit={() => beginEditingMessage(message)}
									onRetract={() => retractMessage(message.id)}
									onCancelRetract={() => setPendingRetractId(null)}
									onApprove={(id) =>
										void addToolApprovalResponse({ id, approved: true })
									}
									onDeny={(id) =>
										void addToolApprovalResponse({
											id,
											approved: false,
											reason: "用户选择保留当前计划",
										})
									}
								/>
							))
						)}
						{isBusy && <ThinkingIndicator recovering={isRecovering} />}
					</div>
				</div>

				<div className="composer-wrap">
					{connectionError && (
						<div className="connection-banner">
							<WifiOff size={15} />
							连接暂时中断，恢复网络后将自动重连。
						</div>
					)}
					{rollbackNotice && (
						<div className={`rollback-banner ${rollbackNotice.tone}`}>
							{rollbackNotice.tone === "success" ? (
								<CheckCircle2 size={14} />
							) : (
								<History size={14} />
							)}
							<span>{rollbackNotice.message}</span>
							<button
								type="button"
								onClick={() => setRollbackNotice(null)}
								aria-label="关闭回退提示"
							>
								<X size={12} />
							</button>
						</div>
					)}
					{editingMessageId && (
						<div className="editing-banner">
							<Pencil size={14} />
							<span>
								<strong>正在修改这条消息</strong>
								<small>发送后会替换这一轮及其后的对话</small>
							</span>
							<button
								type="button"
								onClick={cancelEditingMessage}
								aria-label="取消修改"
							>
								<X size={14} />
							</button>
						</div>
					)}
					<form className="composer" onSubmit={handleSubmit}>
						<textarea
							ref={composerRef}
							value={composer}
							onChange={(event) => setComposer(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing
								) {
									event.preventDefault();
									void submitText(composer);
								}
							}}
							placeholder={
								editingMessageId
									? "修改消息后重新发送…"
									: "说说你的目标、进展，或此刻卡住的地方…"
							}
							rows={1}
							maxLength={4000}
							disabled={Boolean(connectionError)}
						/>
						{isBusy ? (
							<button
								type="button"
								className="send-button stop"
								onClick={() => stop()}
								aria-label="停止生成"
							>
								<Square size={12} fill="currentColor" />
							</button>
						) : (
							<button
								type="submit"
								className="send-button"
								disabled={!composer.trim() || Boolean(connectionError)}
								aria-label="发送"
							>
								<ArrowUp size={18} />
							</button>
						)}
					</form>
					<p className="composer-note">
						<LockKeyhole size={11} />
						<span>请保存工作区 ID，换设备或清理浏览器后可用于找回。</span>
						<button type="button" onClick={() => void copyWorkspaceId()}>
							{copied ? <Check size={11} /> : <Copy size={11} />}
							{copied ? "已复制" : "复制 ID"}
						</button>
					</p>
				</div>
			</section>

			{rightPanelOpen && (
				<>
					<button
						type="button"
						className="insights-backdrop"
						onClick={() => navigateTo("conversation")}
						aria-label="关闭执行仪表盘"
					/>
					<InsightsPanel
						workspace={workspace}
						progress={progress}
						completedTasks={completedTasks}
						focusTarget={insightNavigation.target}
						focusRequest={insightNavigation.request}
						onClose={() => navigateTo("conversation")}
							onTaskAction={(task) =>
								void submitText(`请将任务「${task.title}」标记为完成。`)
							}
							onCheckIn={() =>
								void submitText("我想做一次简短进度复盘，请带我完成。")
							}
					/>
				</>
			)}
		</main>
	);
}

function WelcomeState({ onStarter }: { onStarter: (text: string) => void }) {
	return (
		<section className="welcome-state">
			<div className="welcome-kicker">
				<span /> 新的航程
			</div>
			<h2>
				把想去的地方，
				<br />
				变成今天能做的事。
			</h2>
			<p>
				我会先了解你的目标和现实约束，再与你一起建立会持续更新的行动系统。
			</p>

			<div className="starter-grid">
				{STARTERS.map((starter, index) => (
					<button key={starter} onClick={() => onStarter(starter)}>
						<span>0{index + 1}</span>
						{starter}
						<ChevronRight size={16} />
					</button>
				))}
			</div>

			<div className="capability-row">
				<span>
					<MilestoneIcon size={14} /> 目标拆解
				</span>
				<span>
					<RefreshCcw size={14} /> 动态重规划
				</span>
				<span>
					<ShieldCheck size={14} /> 关键操作确认
				</span>
			</div>
		</section>
	);
}

function MessageBubble({
	message,
	disabled,
	isEditing,
	isRetractPending,
	onEdit,
	onRetract,
	onCancelRetract,
	onApprove,
	onDeny,
}: {
	message: UIMessage;
	disabled: boolean;
	isEditing: boolean;
	isRetractPending: boolean;
	onEdit: () => void;
	onRetract: () => void;
	onCancelRetract: () => void;
	onApprove: (id: string) => void;
	onDeny: (id: string) => void;
}) {
	const isUser = message.role === "user";
	return (
		<article
			className={`message ${isUser ? "user-message" : "assistant-message"} ${isEditing ? "editing-message" : ""}`}
		>
			{!isUser && (
				<span className="message-avatar">
					<Sparkles size={14} />
				</span>
			)}
			<div className="message-bubble-column">
				<div className="message-content">
					{message.parts.map((part, index) => {
						if (part.type === "text" && part.text) {
							return (
								<div
									className={`message-text ${isUser ? "plain-message" : "markdown-message"}`}
									key={`${message.id}-text-${index}`}
								>
									{isUser ? (
										part.text
									) : (
										<MarkdownMessage markdown={part.text} />
									)}
								</div>
							);
						}
						if (isToolUIPart(part)) {
							return (
								<ToolCard
									key={`${message.id}-tool-${index}`}
									part={part}
									onApprove={onApprove}
									onDeny={onDeny}
								/>
							);
						}
						return null;
					})}
				</div>
				{isUser && (
					<div className="message-actions" aria-label="消息操作">
						<button type="button" onClick={onEdit} disabled={disabled}>
							<Pencil size={11} /> {isEditing ? "修改中" : "修改"}
						</button>
						<button
							type="button"
							className={isRetractPending ? "confirm-retract" : ""}
							onClick={onRetract}
							disabled={disabled}
						>
							<Undo2 size={11} />
							{isRetractPending ? "确认撤回" : "撤回"}
						</button>
						{isRetractPending && (
							<button
								type="button"
								className="cancel-retract"
								onClick={onCancelRetract}
								aria-label="取消撤回"
							>
								<X size={11} />
							</button>
						)}
					</div>
				)}
			</div>
		</article>
	);
}

function ToolCard({
	part,
	onApprove,
	onDeny,
}: {
	part: UIMessage["parts"][number];
	onApprove: (id: string) => void;
	onDeny: (id: string) => void;
}) {
	const state = getToolPartState(part);
	const approval = getToolApproval(part);
	const name = isToolUIPart(part) ? getToolName(part) : "tool";
	const input = getToolInput(part);
	const label = TOOL_LABELS[name] ?? "更新工作区";
	const inputSummary = summarizeToolInput(name, input);

	if (state === "waiting-approval" && approval) {
		return (
			<div className="approval-card">
				<div className="approval-icon">
					<ShieldCheck size={19} />
				</div>
				<div>
					<strong>需要你的确认</strong>
					<p>{inputSummary || `${label}会改变当前工作区。`}</p>
					<div className="approval-actions">
						<button className="approve" onClick={() => onApprove(approval.id)}>
							确认执行
						</button>
						<button onClick={() => onDeny(approval.id)}>保留现状</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={`tool-card tool-${state}`}>
			<span>
				{state === "complete" || state === "approved" ? (
					<CheckCircle2 size={15} />
				) : state === "error" || state === "denied" ? (
					<Circle size={15} />
				) : (
					<LoaderCircle className="spin" size={15} />
				)}
			</span>
			<div>
				<strong>{label}</strong>
				{inputSummary && <small>{inputSummary}</small>}
			</div>
		</div>
	);
}

function summarizeToolInput(name: string, input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const value = input as Record<string, unknown>;
	if (name === "replace_plan") {
		const goal = value.goal as Record<string, unknown> | undefined;
		return goal?.title ? `将当前计划替换为「${String(goal.title)}」` : "替换现有计划";
	}
	if (name === "reset_workspace") return "清空目标、任务与复盘记录";
	if (name === "get_current_time") return "核对当前日期、时间与时区";
	if (name === "move_task") return "调整建议执行位置";
	if (name === "split_task") {
		return Array.isArray(value.parts)
			? `原位拆分为 ${value.parts.length} 个子任务`
			: "原位拆分任务";
	}
	if (typeof value.title === "string") return value.title;
	if (typeof value.nextFocus === "string") return `下一步：${value.nextFocus}`;
	return "";
}

function ThinkingIndicator({ recovering }: { recovering: boolean }) {
	return (
		<div className="thinking-row">
			<span className="message-avatar">
				<Sparkles size={14} />
			</span>
			<div className="thinking-pill">
				<span />
				<span />
				<span />
				<small>{recovering ? "正在恢复思路" : "正在整理下一步"}</small>
			</div>
		</div>
	);
}

function InsightsPanel({
	workspace,
	progress,
	completedTasks,
	focusTarget,
	focusRequest,
	onClose,
	onTaskAction,
	onCheckIn,
}: {
	workspace: WorkspaceState;
	progress: number;
	completedTasks: number;
	focusTarget: "plan" | "activity";
	focusRequest: number;
	onClose: () => void;
	onTaskAction: (task: Task) => void;
	onCheckIn: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const planRef = useRef<HTMLElement>(null);
	const activityRef = useRef<HTMLElement>(null);
	const taskScrollerRef = useRef<HTMLDivElement>(null);
	const taskLoadSentinelRef = useRef<HTMLDivElement>(null);
	const [visibleTaskCount, setVisibleTaskCount] = useState(TASK_PAGE_SIZE);
	const milestoneProgress = useMemo(
		() =>
			workspace.milestones.map((milestone) => {
				const tasks = workspace.tasks.filter(
					(task) => task.milestoneId === milestone.id,
				);
				const done = tasks.filter((task) => task.status === "done").length;
				return { milestone, tasks, done };
			}),
		[workspace.milestones, workspace.tasks],
	);
	const orderedTasks = workspace.tasks;
	const visibleTasks = orderedTasks.slice(0, visibleTaskCount);
	const remainingTaskCount = orderedTasks.length - visibleTasks.length;

	useEffect(() => {
		const root = taskScrollerRef.current;
		const sentinel = taskLoadSentinelRef.current;
		if (!root || !sentinel || remainingTaskCount <= 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setVisibleTaskCount((count) =>
					Math.min(count + TASK_PAGE_SIZE, orderedTasks.length),
				);
			},
			{ root, rootMargin: "0px 0px 64px", threshold: 0.1 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [remainingTaskCount, orderedTasks.length]);

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			const scroller = scrollRef.current;
			const target = focusTarget === "activity" ? activityRef.current : planRef.current;
			if (!scroller || !target) return;
			const scrollerTop = scroller.getBoundingClientRect().top;
			const targetTop = target.getBoundingClientRect().top;
			scroller.scrollTo({
				top: scroller.scrollTop + targetTop - scrollerTop - 18,
				behavior: "smooth",
			});
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusRequest, focusTarget]);

	return (
		<aside className="insights" aria-label="执行仪表盘">
			<header className="insights-header">
				<div>
					<span>LIVE PLAN</span>
					<h2>执行仪表盘</h2>
				</div>
				<div className="insights-header-actions">
					<span className="secure-badge">
						<LockKeyhole size={12} /> 私密
					</span>
					<button
						type="button"
						className="icon-button insights-close"
						onClick={onClose}
						aria-label="关闭执行仪表盘"
					>
						<X size={16} />
					</button>
				</div>
			</header>

			<div className="insights-scroll" ref={scrollRef}>
				<section className="progress-card" id="plan" ref={planRef}>
					<div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
						<div>
							<strong>{progress}%</strong>
							<small>总进度</small>
						</div>
					</div>
					<div className="progress-copy">
						<span>当前目标</span>
						<h3>{workspace.goal?.title ?? "等待你的目标"}</h3>
						<p>
							{completedTasks} / {workspace.tasks.length} 项任务完成
						</p>
					</div>
				</section>

				<section className="panel-section">
					<div className="section-heading">
						<div>
							<MilestoneIcon size={15} />
							<h3>里程碑</h3>
						</div>
						<span>{workspace.milestones.length}</span>
					</div>
					{milestoneProgress.length ? (
						<div className="milestone-list">
							{milestoneProgress.map(({ milestone, tasks, done }, index) => {
								const percent = tasks.length
									? Math.round((done / tasks.length) * 100)
									: 0;
								return (
									<div className="milestone-row" key={milestone.id}>
										<span className={percent === 100 ? "done" : ""}>
											{percent === 100 ? <Check size={12} /> : index + 1}
										</span>
										<div>
											<strong>{milestone.title}</strong>
											<div className="milestone-meta">
												<div><i style={{ width: `${percent}%` }} /></div>
												<small>{percent}%</small>
											</div>
										</div>
									</div>
								);
							})}
						</div>
					) : (
						<PanelEmpty icon={<MilestoneIcon size={18} />} text="建立计划后，里程碑会出现在这里" />
					)}
				</section>

				<section className="panel-section">
					<div className="section-heading">
						<div>
							<Flame size={15} />
							<h3>全部行动</h3>
						</div>
						<span>{workspace.tasks.length}</span>
					</div>
					<p className="task-order-note">
						按建议执行路径排列，不限制实际完成顺序
					</p>
					{orderedTasks.length ? (
						<div
							className="task-list-scroll"
							ref={taskScrollerRef}
							aria-label="全部行动列表"
						>
							<div className="task-list">
								{visibleTasks.map((task, index) => (
									<button
										className={`task-row ${task.status === "done" ? "done" : ""}`}
										key={task.id}
										onClick={() => task.status !== "done" && onTaskAction(task)}
										title={task.status === "done" ? "已完成" : "标记为完成"}
										disabled={task.status === "done"}
									>
										<span className="task-order" aria-hidden="true">
											{String(index + 1).padStart(2, "0")}
										</span>
										<span className={`task-check priority-${task.priority}`}>
											{task.status === "done" && <Check size={9} />}
										</span>
										<div>
											<strong>{task.title}</strong>
											<small>
												<Clock3 size={11} /> {task.effortMinutes} 分钟
												{task.dueDate && (
													<>
														<CalendarDays size={11} /> {formatDate(task.dueDate)}
													</>
												)}
											</small>
										</div>
										<ChevronRight size={14} />
									</button>
								))}
								{remainingTaskCount > 0 && (
									<div
										className="task-load-sentinel"
										ref={taskLoadSentinelRef}
									>
										<LoaderCircle className="spin" size={12} />
										继续滚动加载
									</div>
								)}
							</div>
						</div>
					) : (
						<PanelEmpty icon={<CheckCircle2 size={18} />} text="暂无行动任务" />
					)}
				</section>

				<section
					className="panel-section"
					id="activity"
					ref={activityRef}
				>
					<div className="section-heading">
						<div>
							<History size={15} />
							<h3>最近动态</h3>
						</div>
					</div>
					{workspace.activity.length ? (
						<div className="activity-list">
							{workspace.activity.slice(0, 4).map((activity) => (
								<ActivityRow key={activity.id} activity={activity} />
							))}
						</div>
					) : (
						<PanelEmpty icon={<History size={18} />} text="你的行动记录会留在这里" />
					)}
				</section>

				<button className="checkin-button" onClick={onCheckIn}>
					<span>
						<Sparkles size={17} />
					</span>
					<div>
						<strong>做一次 3 分钟复盘</strong>
						<small>看见进展，找准下一步</small>
					</div>
					<ChevronRight size={16} />
				</button>
			</div>
		</aside>
	);
}

function ActivityRow({ activity }: { activity: Activity }) {
	return (
		<div className="activity-row">
			<span className={`activity-icon ${activity.type}`}>
				{activity.type === "task" ? (
					<Check size={11} />
				) : activity.type === "plan" ? (
					<Target size={11} />
				) : (
					<Sparkles size={11} />
				)}
			</span>
			<div>
				<p>{activity.message}</p>
				<small>{relativeTime(activity.createdAt)}</small>
			</div>
		</div>
	);
}

function PanelEmpty({ icon, text }: { icon: React.ReactNode; text: string }) {
	return (
		<div className="panel-empty">
			{icon}
			<p>{text}</p>
		</div>
	);
}
