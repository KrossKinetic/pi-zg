import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const INDEX_PATH = [".zvec-grep", "index.zvec"];

function indexPath(cwd: string): string {
	return join(cwd, ...INDEX_PATH);
}

async function zgVersion(pi: ExtensionAPI, cwd: string, signal?: AbortSignal) {
	return pi.exec("zg", ["version"], { cwd, signal, timeout: 5_000 });
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "zg_search",
		label: "zg search",
		description:
			"Search the current project's existing zvec-grep index semantically. Requires zg on PATH and an index built beforehand with `zg index`. Returns at most 2,000 lines or 50 KB of CLI output.",
		promptSnippet: "Semantic search in the current project's existing zg index",
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "Semantic code-search query" }),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 100,
					description: "Maximum results to return (1-100; zg defaults to 7)",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const version = await zgVersion(pi, ctx.cwd, signal);
			if (version.code !== 0) {
				throw new Error(
					"`zg` is not available on PATH. Install @zvec/zvec-grep separately, then run `zg index` in this project.",
				);
			}

			if (!existsSync(indexPath(ctx.cwd))) {
				throw new Error(
					`This project does not appear to be indexed. Run \`zg index\` manually in ${ctx.cwd}, then retry.`,
				);
			}

			const args = ["query"];
			if (params.limit !== undefined) args.push("--limit", String(params.limit));
			args.push(params.query);

			const result = await pi.exec("zg", args, {
				cwd: ctx.cwd,
				signal,
				timeout: 30_000,
			});
			if (result.code !== 0) {
				throw new Error((result.stderr || result.stdout || "zg query failed").trim());
			}

			const output = result.stdout.trim();
			const truncated = truncateHead(output, {
				maxLines: 2_000,
				maxBytes: 50 * 1024,
			});
			const text = truncated.truncated
				? `${truncated.content}\n\n[zg output truncated]`
				: truncated.content;
			return {
				content: [{ type: "text", text: text || "No results found." }],
				details: { query: params.query, limit: params.limit },
			};
		},
	});

	pi.registerCommand("zg-status", {
		description: "Report zg availability, version, and index status for this project",
		handler: async (_args, ctx) => {
			const version = await zgVersion(pi, ctx.cwd);
			if (version.code !== 0) {
				ctx.ui.notify("zg: not found on PATH", "error");
				return;
			}

			const indexed = existsSync(indexPath(ctx.cwd));
			ctx.ui.notify(
				`zg: ${version.stdout.trim() || "available"}\nindex: ${indexed ? "present" : "missing"} (${INDEX_PATH.join("/")})`,
				indexed ? "info" : "warning",
			);
		},
	});
}
