# Northstar

Northstar 是一个会维护真实行动计划的 AI 目标执行教练。它不只生成聊天文本，还能通过服务端工具建立目标、里程碑和任务，记录复盘，并随着实际进度持续调整计划。

## 能力

- 中文流式对话与断线续传
- 目标澄清、里程碑拆解和任务生成
- 结构化行动看板与多标签页实时同步
- 任务更新、进度计算与复盘记录
- 替换计划和重置工作区的人机审批
- Durable Object SQLite 持久化
- Workers AI 推理，无需第三方模型 API Key
- 响应式桌面与移动界面

## 架构

```text
Browser / Next.js 16
        │ useAgent + useAgentChat
        ▼
custom-worker.ts
   ├── /agents/goal-coach/:workspaceId → GoalCoach Durable Object
   │                                      ├── SQLite state + messages
   │                                      └── Workers AI
   └── all other requests → OpenNext worker → Next.js
```

`custom-worker.ts` 是 Wrangler 入口。它先路由 Agent WebSocket/HTTP 请求，其他请求交给 OpenNext 生成的 Next.js Worker。

## 本地开发

要求 Node.js 20+ 和 npm。

```bash
npm install
npm run cf-typegen
npm run dev
```

`npm run dev` 适合调整普通 Next.js 页面。涉及 Agent、Durable Object 或 Workers AI 的完整体验请运行：

```bash
npm run preview
```

Workers AI 是远程 binding，本地完整对话会使用 Cloudflare 账户额度。

## 质量检查

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build:cloudflare
```

一次执行全部检查：

```bash
npm run check
```

## 部署

确认 Wrangler 已登录：

```bash
npx wrangler whoami
```

部署到 Cloudflare Workers：

```bash
npm run deploy
```

Wrangler 会根据 `wrangler.jsonc` 创建 `GoalCoach` Durable Object namespace 和 SQLite migration，并绑定 Workers AI。

## 数据与安全模型

- 每个浏览器首次访问会生成一个 `crypto.randomUUID()` 工作区 ID。
- 工作区 ID 是匿名 capability：它随机且不可预测，但持有该 ID 的人可访问对应工作区。不要公开分享。
- 浏览器连接对 Agent state 是只读的；结构化状态只能由经过 Zod 校验的服务端工具修改。
- 替换已有计划和重置工作区必须由用户显式批准。
- 对消息、任务、里程碑和工具循环均设置了上限。
- 项目源码和 Wrangler 配置不包含任何密钥。

若需要面向公众提供账号体系，可在 `routeAgentRequest` 的 `onBeforeConnect` 与 `onBeforeRequest` 中接入 Cloudflare Access 或现有身份提供商，并使用登录用户 ID 作为 Agent instance。

## 主要文件

- `custom-worker.ts`：OpenNext/Agent 统一入口
- `src/agent/goal-coach.ts`：模型、提示词、工具和审批策略
- `src/lib/workspace.ts`：领域类型、状态变更和约束
- `src/components/northstar-app.tsx`：实时工作台
- `wrangler.jsonc`：AI、Durable Object、静态资源和观测配置
