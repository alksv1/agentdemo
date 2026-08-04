import { routeAgentRequest } from "agents";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- OpenNext generates this module during the Cloudflare build, so
// it is intentionally absent in a fresh checkout before the first build.
import openNextWorker from "./.open-next/worker.js";

export { GoalCoachV2 } from "./src/agent/goal-coach";

const WORKSPACE_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getWorkspaceId(pathname: string): string | null {
	const match = pathname.match(/^\/agents\/goal-coach-v2\/([^/]+)(?:\/|$)/);
	if (!match?.[1]) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}

export default {
	async fetch(
		request: Request,
		env: CloudflareEnv,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/agents/")) {
			const workspaceId = getWorkspaceId(url.pathname);
			if (!workspaceId || !WORKSPACE_ID.test(workspaceId)) {
				return Response.json(
					{ error: "Invalid workspace identifier" },
					{ status: 400 },
				);
			}

			const agentResponse = await routeAgentRequest(request, env);
			if (agentResponse) return agentResponse;

			return Response.json({ error: "Agent not found" }, { status: 404 });
		}

		return openNextWorker.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<CloudflareEnv>;
