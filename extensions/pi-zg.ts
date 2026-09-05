import {
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * pi-zg: a native Pi integration for the zvec-grep (`zg`) CLI.
 *
 * Beyond wrapping `zg query`/`zg index`, this extension:
 * - Runs every search in direct mode, refreshing the index before answering so
 *   results are never stale (no background server daemon involved).
 * - Caches zg's availability and index state per session (refreshed at
 *   session_start and each turn_start) instead of re-deriving it with
 *   extra `zg` subprocess spawns before every tool call.
 * - Offers to build a missing index interactively instead of just failing.
 * - Exposes managed ripgrep (`zg query --rg`) as an additional tool.
 *
 * Non-goals: this does not register zg's MCP server as an actual MCP
 * source (Pi extensions have no MCP-client API) and does not override the
 * built-in `grep` tool.
 */

const STATUS_KEY = "pi-zg";
const DEFAULT_LOCAL_MODEL = "local/potion-code-16m-v2";
interface ZgState {
	/** Whether refreshZgState has run at least once this session. */
	checked: boolean;
	/** Whether `zg` is on PATH. */
	available: boolean;
	version?: string;
	/** Whether the current project has a ready index. */
	indexed: boolean;
	/** Whether the user already declined the "build an index?" offer this session. */
	declinedIndexOffer: boolean;
}

function createZgState(): ZgState {
	return {
		checked: false,
		available: false,
		indexed: false,
		declinedIndexOffer: false,
	};
}

async function execZg(
	pi: ExtensionAPI,
	args: string[],
	ctx: ExtensionContext,
	opts: { signal?: AbortSignal; timeout?: number } = {},
) {
	return pi.exec("zg", args, { cwd: ctx.cwd, signal: opts.signal, timeout: opts.timeout ?? 10_000 });
}

function renderStatus(ctx: ExtensionContext, state: ZgState) {
	const theme = ctx.ui.theme;
	if (!state.available) {
		ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "zg: not found"));
		return;
	}
	const index = state.indexed ? theme.fg("success", "index\u2713") : theme.fg("warning", "index\u2717");
	ctx.ui.setStatus(STATUS_KEY, index);
}


/** Refresh cached zg availability and index state, then update the footer. */
async function refreshZgState(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: ZgState,
	signal?: AbortSignal,
): Promise<ZgState> {
	const version = await execZg(pi, ["version"], ctx, { signal, timeout: 5_000 });
	state.checked = true;
	state.available = version.code === 0;
	state.version = state.available ? version.stdout.trim() : undefined;

	if (!state.available) {
		state.indexed = false;
		renderStatus(ctx, state);
		return state;
	}

	const status = await execZg(pi, ["status", "--check-ready"], ctx, { signal, timeout: 5_000 });
	state.indexed = status.code === 0;

	renderStatus(ctx, state);
	return state;
}

function compactOutput(output: string): string {
	const truncated = truncateHead(output.trim(), {
		maxLines: 2_000,
		maxBytes: 50 * 1024,
	});
	return truncated.truncated ? `${truncated.content}\n\n[zg output truncated]` : truncated.content;
}

/** Best-effort hit count parsed from `zg query`'s "hits: N" summary line. */
function parseHitCount(output: string): number | undefined {
	const match = output.match(/^hits:\s*(\d+)/m);
	return match ? Number(match[1]) : undefined;
}



async function configureDefaultModel(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const model = await ctx.ui.input("Default embedding model", "e.g. local/potion-code-16m-v2 or qwen/text-embedding-v4");
	if (!model?.trim()) return;
	const result = await execZg(pi, ["config", "model", "set", model.trim(), "--default"], ctx);
	if (result.code !== 0) {
		ctx.ui.notify("Could not set the embedding model. Inspect zg configuration in a terminal for details.", "error");
		return;
	}
	ctx.ui.notify(`Default embedding model set to ${model.trim()}. Existing indexes keep their current schema.`, "info");
}

async function configureEmbeddingDevice(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const model = await ctx.ui.input("Model to configure", "e.g. local/potion-code-16m-v2");
	if (!model?.trim()) return;
	const device = await ctx.ui.select("Embedding device", ["auto", "cpu", "metal", "vulkan", "cuda", "Cancel"]);
	if (!device || device === "Cancel") return;
	const result = await execZg(pi, ["config", "model", "set", model.trim(), "--device", device], ctx);
	if (result.code !== 0) {
		ctx.ui.notify("Could not set the embedding device. Inspect zg configuration in a terminal for details.", "error");
		return;
	}
	ctx.ui.notify(`Embedding device for ${model.trim()} set to ${device}.`, "info");
}

async function configureProviderKey(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const provider = await ctx.ui.input("Embedding provider", "e.g. qwen");
	if (!provider?.trim()) return;
	const apiKey = await ctx.ui.input("API key", "Paste the provider API key");
	if (!apiKey?.trim()) return;
	const result = await execZg(pi, ["config", "provider", "set", provider.trim(), "--api-key", apiKey.trim()], ctx);
	if (result.code !== 0) {
		ctx.ui.notify("Could not save the provider API key. Inspect zg configuration in a terminal for details.", "error");
		return;
	}
	ctx.ui.notify(`Credentials saved for ${provider.trim()}.`, "info");
}

async function openZgSettings(pi: ExtensionAPI, ctx: ExtensionContext, state: ZgState): Promise<void> {
	if (!state.checked) await refreshZgState(pi, ctx, state);

	while (true) {
		const choice = await ctx.ui.select("zg settings", [
			"Default embedding model",
			"Embedding device",
			"Provider API key",
			"View active settings",
			"Done",
		]);
		if (!choice || choice === "Done") return;

		switch (choice) {
			case "Default embedding model":
				await configureDefaultModel(pi, ctx);
				break;
			case "Embedding device":
				await configureEmbeddingDevice(pi, ctx);
				break;
			case "Provider API key":
				await configureProviderKey(pi, ctx);
				break;
			case "View active settings": {
				await refreshZgState(pi, ctx, state);
				const detail = await execZg(pi, ["status"], ctx);
				ctx.ui.notify(
					[
						(detail.stdout || detail.stderr).trim(),
					].join("\n"),
					state.indexed ? "info" : "warning",
				);
				break;
			}
		}
	}
}

/**
 * Lazily offer to build a missing index right where the LLM discovered it's
 * missing, instead of dead-ending with a "go run this command yourself" error.
 * Returns true if an index is ready after this call.
 */
async function offerToBuildIndex(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: ZgState,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	if (state.declinedIndexOffer || !ctx.hasUI || pi.getFlag("no-zg-onboard")) {
		return false;
	}

	const build = await ctx.ui.confirm(
		"Build zg index?",
		`No zvec-grep index found for ${ctx.cwd}. Build one now? This runs \`zg index\` with the configured default embedding model.`,
		{ signal },
	);
	if (!build) {
		state.declinedIndexOffer = true;
		return false;
	}

	ctx.ui.setWorkingMessage("Building zg index...");
	let result = await execZg(pi, ["index", "--mode", "direct"], ctx, { signal, timeout: 300_000 });

	if (result.code !== 0 && /embedding/i.test(result.stderr)) {
		// No default embedding model configured yet -- offer to set one and retry.
		const choice = await ctx.ui.select(
			"No default embedding model configured. Choose one:",
			[`${DEFAULT_LOCAL_MODEL} (local, no API key)`, "Enter a different model", "Cancel"],
			{ signal },
		);
		let model: string | undefined;
		if (choice?.startsWith(DEFAULT_LOCAL_MODEL)) {
			model = DEFAULT_LOCAL_MODEL;
		} else if (choice === "Enter a different model") {
			model = await ctx.ui.input("Embedding model", "provider/model-id", { signal });
		}
		if (model) {
			await execZg(pi, ["config", "model", "set", model, "--default"], ctx, { signal });
			result = await execZg(pi, ["index", "--mode", "direct", "--embedding", model], ctx, {
				signal,
				timeout: 300_000,
			});
		}
	}

	ctx.ui.setWorkingMessage();

	if (result.code === 0) {
		ctx.ui.notify("zg index built.", "info");
		await refreshZgState(pi, ctx, state, signal);
		return state.indexed;
	}

	ctx.ui.notify(`zg index failed: ${(result.stderr || result.stdout || "unknown error").trim()}`, "error");
	return false;
}

export default function (pi: ExtensionAPI) {
	const state = createZgState();

	pi.registerFlag("no-zg-onboard", {
		description: "Disable the interactive offer to build a missing zg index; fail with a manual-fix message instead",
		type: "boolean",
		default: false,
	});

pi.on("session_start", async (_event, ctx) => {
	await refreshZgState(pi, ctx, state);
});


	pi.on("turn_start", async (_event, ctx) => {
		if (state.available) {
			await refreshZgState(pi, ctx, state);
		}
	});

	pi.registerTool({
		name: "zg_search",
		label: "zg search",
		description:
				"Semantic (meaning-based) code search over the current project's zvec-grep index. The go-to when you want to find code by CONCEPT rather than exact text — e.g. where authentication is handled, or how a feature works — without knowing the precise identifiers. Each call refreshes the index first, so results are never stale; it offers to build the index interactively if none exists. Prefer over keyword grep when an exact-token search would miss relevant code. For precise identifiers, string literals, or regex, use zg_rg or the built-in grep tool instead. Returns at most 2,000 lines or 50 KB of CLI output.",
		promptSnippet: "Semantic search in the current project's zg index",
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
			if (!state.checked) await refreshZgState(pi, ctx, state, signal);
			if (!state.available) {
				throw new Error(
					"`zg` is not available on PATH. Install @zvec/zvec-grep separately, then run `zg index` in this project.",
				);
			}

			if (!state.indexed && !(await offerToBuildIndex(pi, ctx, state, signal))) {
				throw new Error(
					`This project does not appear to be indexed. Run \`zg index\` manually in ${ctx.cwd}, then retry.`,
				);
			}

			const args = ["query", "--mode", "direct", "--refresh", "wait"];
			if (params.limit !== undefined) args.push("--limit", String(params.limit));
			args.push(params.query);

			const result = await execZg(pi, args, ctx, { signal, timeout: 30_000 });
			if (result.code !== 0) {
				// State may be stale (e.g. index dropped externally); refresh for next call.
				await refreshZgState(pi, ctx, state, signal);
				throw new Error((result.stderr || result.stdout || "zg query failed").trim());
			}

			const text = compactOutput(result.stdout);
			return {
				content: [{ type: "text", text: text || "No results found." }],
				details: { query: params.query, limit: params.limit, hits: parseHitCount(result.stdout) },
			};
		},
	});

	pi.registerTool({
		name: "zg_rg",
		label: "zg managed ripgrep",
		description:
			"Exhaustive exact-match search via zvec-grep's managed ripgrep (`zg query --rg`). Use when you know the precise identifier, string literal, or regex to locate and want results that honor the project's configured ignore/glob rules (e.g. excluding node_modules). Prefer it over zg_search when you need literal/regex matches rather than meaning; prefer it over the built-in grep tool when you want rg's powers (globs, -F literal) with the project's ignore rules applied. Does not require an index.",
		promptSnippet: "Exhaustive managed ripgrep search via zg (respects project ignore rules)",
		parameters: Type.Object({
			pattern: Type.String({ minLength: 1, description: "Pattern to search for" }),
			paths: Type.Optional(
				Type.Array(Type.String(), { description: "Paths to restrict the search to (default: whole project)" }),
			),
			fixedString: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string instead of a regex" })),
			glob: Type.Optional(
				Type.String({ description: "Include glob, e.g. '*.ts'; prefix with '!' to exclude, e.g. '!*.test.ts'" }),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!state.checked) await refreshZgState(pi, ctx, state, signal);
			if (!state.available) {
				throw new Error("`zg` is not available on PATH. Install @zvec/zvec-grep separately.");
			}

			const args = ["query", "--rg"];
			if (params.fixedString) args.push("-F");
			if (params.glob) args.push("-g", params.glob);
			args.push("-e", params.pattern);
			if (params.paths?.length) args.push(...params.paths);

			const result = await execZg(pi, args, ctx, { signal, timeout: 30_000 });
			if (result.code !== 0) {
				throw new Error((result.stderr || result.stdout || "zg query --rg failed").trim());
			}

			const text = compactOutput(result.stdout);
			return {
				content: [{ type: "text", text: text || "No matches found." }],
				details: { pattern: params.pattern, paths: params.paths },
			};
		},
	});

	pi.registerTool({
		name: "zg_index",
		label: "zg index",
		description:
			"Build, rebuild, or drop the current project's persistent zvec-grep index. Use only when the user explicitly asks: searches already refresh a stale index before answering, so this is mainly for the first-time build, an explicit rebuild, or dropping the index.",
		promptSnippet: "Explicitly build, rebuild, or drop the current project's zg index",
		promptGuidelines: [
			"Use zg_index only when the user explicitly requests indexing, rebuilding, or dropping the zg index; do not call it merely because zg_search reports a missing index -- that flow already offers to build it interactively.",
			"Never pass drop: true unless the user explicitly asked to remove or reset the index.",
		],
		parameters: Type.Object({
			rebuild: Type.Optional(Type.Boolean({ description: "Rebuild the existing index from scratch" })),
			drop: Type.Optional(
				Type.Boolean({
					description: "Permanently remove the index instead of building it. Only when the user explicitly asked to drop/reset it.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!state.checked) await refreshZgState(pi, ctx, state, signal);
			if (!state.available) {
				throw new Error("`zg` is not available on PATH. Install @zvec/zvec-grep separately before indexing.");
			}

			const args = ["index", "--mode", "direct"];
			if (params.drop) args.push("--drop", "--yes");
			else if (params.rebuild) args.push("--rebuild");

			const result = await execZg(pi, args, ctx, { signal, timeout: 300_000 });
			if (result.code !== 0) {
				throw new Error((result.stderr || result.stdout || "zg index failed").trim());
			}

			await refreshZgState(pi, ctx, state, signal);
			const text = compactOutput(result.stdout || result.stderr);
			return {
				content: [{ type: "text", text: text || "zg index completed." }],
				details: { rebuild: params.rebuild, drop: params.drop },
			};
		},
	});

	pi.registerTool({
		name: "zg_status",
		label: "zg status",
		description:
			"Report zg availability and the current project's index status (ready or not). Use to confirm zg is set up and the index is current before relying on semantic search, or to diagnose why zg_search/zg_rg return nothing. Reads pi's cached state (refreshed for this call) and does not spawn a separate `zg` subprocess. For full index detail/coverage, humans can use `/zg-status`.",
		promptSnippet: "Check zg availability and index status",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (!state.checked) await refreshZgState(pi, ctx, state, signal);
			if (!state.available) {
				throw new Error("`zg` is not available on PATH. Install @zvec/zvec-grep separately before checking status.");
			}

			await refreshZgState(pi, ctx, state, signal);
			const index = state.indexed ? "index: ready" : "index: not ready";
			return {
				content: [
					{
						type: "text",
						text: [
							`zg: ${state.version || "available"}`,
							index,
						].join("\n"),
					},
				],
				details: {
					available: true,
					version: state.version,
					indexed: state.indexed,
				},
			};
		},
	});

	pi.registerCommand("zg-settings", {
		description: "Configure zg embedding model, device, and provider credentials",
		handler: async (_args, ctx) => {
			await openZgSettings(pi, ctx, state);
		},
	});

	pi.registerCommand("zg-status", {
		description: "Report zg version and index status for this project",
		handler: async (_args, ctx) => {
			await refreshZgState(pi, ctx, state);
			if (!state.available) {
				ctx.ui.notify("zg: not found on PATH", "error");
				return;
			}

			const detail = await execZg(pi, ["status"], ctx);
			const lines = [
				`zg: ${state.version || "available"}`,
				"",
				(detail.stdout || detail.stderr).trim(),
			];
			ctx.ui.notify(lines.join("\n"), state.indexed ? "info" : "warning");
		},
	});

	pi.registerCommand("zg-index", {
		description: "Build the zg index for this project. Use --rebuild to rebuild or --drop to remove it",
		handler: async (args, ctx) => {
			if (!state.available) {
				ctx.ui.notify("zg: not found on PATH", "error");
				return;
			}

			const flags = args.trim().split(/\s+/).filter(Boolean);
			const drop = flags.includes("--drop");
			const rebuild = flags.includes("--rebuild");

			if (drop) {
				const confirmed = await ctx.ui.confirm("Drop zg index?", `This permanently removes the index for ${ctx.cwd}.`);
				if (!confirmed) return;
			}

			const cmdArgs = ["index", "--mode", "direct"];
			if (drop) cmdArgs.push("--drop", "--yes");
			else if (rebuild) cmdArgs.push("--rebuild");

			ctx.ui.setWorkingMessage(drop ? "Dropping zg index..." : "Building zg index...");
			const result = await execZg(pi, cmdArgs, ctx, { timeout: 300_000 });
			ctx.ui.setWorkingMessage();

			await refreshZgState(pi, ctx, state);
			if (result.code !== 0) {
				ctx.ui.notify(`zg index failed: ${(result.stderr || result.stdout || "unknown error").trim()}`, "error");
				return;
			}
			ctx.ui.notify(drop ? "Index dropped." : "Index ready.", "info");
		},
	});

}
