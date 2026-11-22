/**
 * Pool several Claude Pro/Max subscriptions behind one model.
 *
 * Account 1 is the built-in `anthropic` provider. Accounts 2..N are `anthropic-2`, `anthropic-3`, ...
 * with the same models and OAuth login. Log in to each one with `/login`.
 *
 * Select `claude-pool/<model>`, for example `claude-pool/claude-opus-4-8`. A session stays on one
 * account so its prompt cache stays warm. It moves to the next logged-in account only when a 429
 * says the subscription quota is used up (`anthropic-ratelimit-unified-status: rejected`). A burst
 * 429 without that header stays on the same account, and Pi's retry backoff handles it.
 *
 * A spent account is tried again after 15 minutes: a quota can come back before its reset time.
 *
 * When the chat settles on a 429 after Pi's retries, that account is spent too, with or without the
 * header, until the reset of its last 429. When every logged-in account is spent, one revive runs at
 * the first reset: it sends `continue` if the chat died on a 429 and is idle, and resumes the failed
 * workflows runs whose error is a 429, a rate limit or a stopped turn.
 *
 * A switch loses the prompt cache once: caches belong to one account. Thinking blocks of the other
 * account go to the new one as plain text, the same as after a manual model switch.
 *
 * `/claude-pool` shows each account, when its quota resets, and when the revive runs.
 */

import { anthropicMessagesApi, createProvider, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { builtinProviders, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRegistry, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

const ACCOUNT_COUNT = 2;
const POOL = "claude-pool";
const ACCOUNTS = ["anthropic", ...Array.from({ length: ACCOUNT_COUNT - 1 }, (_, i) => `anthropic-${i + 2}`)];
// Used when a quota 429 has no reset header.
const DEFAULT_BLOCK_MS = 60 * 60 * 1000;
const RECHECK_MS = 15 * 60 * 1000;
const RUN_ERROR_TO_RESUME = /\b429\b|rate.?limit|turn stopped: error/i;

interface PoolState {
	account: string;
}

interface Block {
	until: number;
	seenAt: number;
}

// Per Pi process. A new process learns a spent account again from its first 429.
const blocks = new Map<string, Block>();
let lastRouted: string | undefined;
let registry: ModelRegistry | undefined;
// Reset time of the last 429 of each account, with or without the rejected header.
const last429 = new Map<string, number>();
// Last assistant message of the last agent run. agent_end fires once per retry attempt.
let lastAssistant: AssistantMessage | undefined;
let revive: { timer: ReturnType<typeof setTimeout>; at: number } | undefined;
// The runs that had already failed when this Pi process started. A revive never resumes them: the generic
// `turn stopped: error` cannot tell an old failure from a 429 of this session.
let failedAtStart: Promise<Set<string>> = Promise.resolve(new Set());

// Pi reports no headers for a failed request (after_provider_response fires only on success), so
// the quota headers of a 429 are read from fetch. The Anthropic SDK uses the global fetch.
const ORIGINAL_FETCH = Symbol.for("claude-pool.original-fetch");

function watchQuota429s(): void {
	const current = globalThis.fetch as typeof fetch & { [ORIGINAL_FETCH]?: typeof fetch };
	const original = current[ORIGINAL_FETCH] ?? current;
	const watched = async (...args: Parameters<typeof fetch>) => {
		const response = await original(...args);
		// The unified status header can say "rejected" on a 200 too, so only a 429 counts.
		if (response.status === 429) {
			const account = await accountOf(...args);
			if (account) {
				const until = quotaResetMs(response.headers);
				last429.set(account, until);
				if (response.headers.get("anthropic-ratelimit-unified-status") === "rejected") {
					blocks.set(account, { until, seenAt: Date.now() });
				}
			}
		}
		return response;
	};
	globalThis.fetch = Object.assign(watched, { [ORIGINAL_FETCH]: original }) as typeof fetch;
}

/** The pool account whose token the request carries. Requests outside the pool pass through fetch too. */
async function accountOf(...[input, init]: Parameters<typeof fetch>): Promise<string | undefined> {
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
	const authorization = headers.get("authorization");
	if (!authorization || !registry) return undefined;
	for (const account of ACCOUNTS) {
		const token = await registry.getApiKeyForProvider(account).catch(() => undefined);
		if (token && authorization === `Bearer ${token}`) return account;
	}
	return undefined;
}

function resetOf(account: string): number {
	return blocks.get(account)?.until ?? 0;
}

function isBlocked(account: string): boolean {
	const block = blocks.get(account);
	const now = Date.now();
	return block !== undefined && block.until > now && block.seenAt + RECHECK_MS > now;
}

function physical(ctx: ExtensionContext, account: string, modelId: string): Model<Api> | undefined {
	const model = ctx.modelRegistry.find(account, modelId);
	return model && ctx.modelRegistry.hasConfiguredAuth(model) ? model : undefined;
}

/** First usable account from `start` on, in pool order. With every account spent, the one that resets first. */
function pick(ctx: ExtensionContext, start: string, modelId: string): string {
	const offset = Math.max(0, ACCOUNTS.indexOf(start));
	const ordered = ACCOUNTS.map((_, i) => ACCOUNTS[(offset + i) % ACCOUNTS.length]);
	const usable = ordered.filter((account) => physical(ctx, account, modelId));
	if (usable.length === 0) throw new Error(`${POOL}: no account with credentials has ${modelId}. Run /login.`);
	return (
		usable.find((account) => !isBlocked(account)) ??
		usable.reduce((a, b) => (resetOf(a) <= resetOf(b) ? a : b))
	);
}

function stickyAccount(request: ModelRouteRequest<PoolState>): string | undefined {
	const candidates = [request.failed?.model.provider, request.state?.account, request.previous?.model.provider];
	return candidates.find((provider) => provider !== undefined && ACCOUNTS.includes(provider));
}

function quotaResetMs(headers: Headers): number {
	const reset = Number(headers.get("anthropic-ratelimit-unified-reset"));
	if (reset > 0) return reset < 1e12 ? reset * 1000 : reset;
	const retryAfter = Number(headers.get("retry-after"));
	if (retryAfter > 0) return Date.now() + retryAfter * 1000;
	return Date.now() + DEFAULT_BLOCK_MS;
}

function label(account: string): string {
	return `claude #${ACCOUNTS.indexOf(account) + 1}`;
}

function formatTime(ms: number): string {
	return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The pool account of a chat run that ended on a 429 after Pi's retries. */
function final429Account(message: AssistantMessage | undefined): string | undefined {
	if (message?.stopReason !== "error" || !/^429\b/.test(message.errorMessage ?? "")) return undefined;
	return ACCOUNTS.includes(message.provider) ? message.provider : undefined;
}

/** Accounts with credentials for at least one model. */
function loggedInAccounts(ctx: ExtensionContext): string[] {
	const models = ctx.modelRegistry.getAll();
	return ACCOUNTS.filter((account) =>
		models.some((model) => model.provider === account && ctx.modelRegistry.hasConfiguredAuth(model)),
	);
}

/** Start one revive at the first reset when every logged-in account is spent. */
function scheduleReviveIfSpent(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (revive) return;
	const accounts = loggedInAccounts(ctx);
	if (accounts.length === 0 || !accounts.every(isBlocked)) return;
	const at = Math.min(...accounts.map(resetOf));
	const timer = setTimeout(() => void runRevive(pi, ctx), Math.max(0, at - Date.now()));
	revive = { timer, at };
	if (ctx.hasUI) ctx.ui.notify(`${POOL}: every account is spent, revive at ${formatTime(at)}`, "warning");
}

function cancelRevive(): void {
	if (revive) clearTimeout(revive.timer);
	revive = undefined;
}

/** Continue the chat that died on a 429, and resume the workflows runs that failed on one. */
async function runRevive(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	revive = undefined;
	const done: string[] = [];
	if (final429Account(lastAssistant) !== undefined && ctx.isIdle()) {
		pi.sendUserMessage("continue");
		done.push("chat");
	}
	try {
		done.push(...(await resumeFailedRuns(pi, ctx.cwd)));
	} catch (error) {
		if (ctx.hasUI) ctx.ui.notify(`${POOL}: workflows resume failed: ${String(error)}`, "error");
	}
	if (ctx.hasUI) ctx.ui.notify(`${POOL}: revived ${done.length ? done.join(", ") : "nothing"}`, "info");
}

/** The IDs of the failed workflows runs, or none when `workflows list` fails. */
async function failedRunIds(pi: ExtensionAPI, cwd: string): Promise<Set<string>> {
	const list = await pi.exec("workflows", ["list", "--json"], { cwd });
	if (list.code !== 0) return new Set();
	const rows = JSON.parse(list.stdout) as { runId: string; state: string }[];
	return new Set(rows.filter((row) => row.state === "failed").map((row) => row.runId));
}

/** Resume each failed workflows run whose error is a 429, a rate limit or a stopped turn. */
async function resumeFailedRuns(pi: ExtensionAPI, cwd: string): Promise<string[]> {
	const list = await pi.exec("workflows", ["list", "--json"], { cwd });
	if (list.code !== 0) throw new Error(list.stderr.trim() || `workflows list exited ${list.code}`);
	const rows = JSON.parse(list.stdout) as { runId: string; state: string; repository: string | null }[];
	const old = await failedAtStart;
	const resumed: string[] = [];
	for (const row of rows.filter((row) => row.state === "failed" && !old.has(row.runId))) {
		const show = await pi.exec("workflows", ["show", row.runId, "--json"], { cwd });
		if (show.code !== 0) continue;
		const error = (JSON.parse(show.stdout) as { error?: string }).error ?? "";
		if (!RUN_ERROR_TO_RESUME.test(error)) continue;
		const resume = await pi.exec("workflows", ["resume", row.runId, "--background"], { cwd: row.repository ?? cwd });
		if (resume.code === 0) resumed.push(row.runId);
	}
	return resumed;
}

export default function (pi: ExtensionAPI) {
	const base = builtinProviders().find((provider) => provider.id === "anthropic");
	if (!base?.auth.oauth) throw new Error(`${POOL}: the built-in anthropic provider has no OAuth login`);
	const models = getBuiltinModels("anthropic");

	for (const account of ACCOUNTS.slice(1)) {
		pi.registerProvider(
			createProvider({
				id: account,
				name: `Anthropic ${ACCOUNTS.indexOf(account) + 1} (Claude Pro/Max)`,
				baseUrl: base.baseUrl,
				auth: { oauth: base.auth.oauth },
				models: models.map((model) => ({ ...model, provider: account })),
				api: anthropicMessagesApi(),
			}),
		);
	}

	for (const model of models) {
		pi.registerVirtualModel<PoolState>({
			provider: POOL,
			id: model.id,
			name: `${model.name} (pool)`,
			thinkingLevels: getSupportedThinkingLevels(model),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			input: model.input,
			route(request, ctx) {
				registry = ctx.modelRegistry;
				const sticky = (request.reason === "direct" ? lastRouted : stickyAccount(request)) ?? ACCOUNTS[0];
				const account = pick(ctx, sticky, request.model.id);
				if (account !== sticky && ctx.hasUI) {
					ctx.ui.notify(`${POOL}: ${label(sticky)} quota used up, switching to ${label(account)}`, "warning");
				}
				lastRouted = account;
				const route = { model: physical(ctx, account, request.model.id)!, thinkingLevel: request.thinkingLevel };
				return account === request.state?.account ? route : { ...route, state: { account } };
			},
		});
	}

	watchQuota429s();
	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
		failedAtStart = failedRunIds(pi, ctx.cwd).catch(() => new Set<string>());
	});
	pi.on("agent_end", (event) => {
		lastAssistant = event.messages.findLast((message): message is AssistantMessage => message.role === "assistant");
	});
	pi.on("agent_settled", (event, ctx) => {
		if (event.aborted) return;
		const account = final429Account(lastAssistant);
		if (account) {
			const now = Date.now();
			blocks.set(account, { until: last429.get(account) ?? now + DEFAULT_BLOCK_MS, seenAt: now });
		}
		scheduleReviveIfSpent(pi, ctx);
	});
	pi.on("session_shutdown", () => {
		cancelRevive();
	});

	pi.registerCommand(POOL, {
		description: "Show the Claude pool accounts and their quota state",
		handler: async (_args, ctx) => {
			const loggedIn = loggedInAccounts(ctx);
			const lines = ACCOUNTS.map((account) => {
				const state = !loggedIn.includes(account)
					? `not logged in (/login ${account})`
					: isBlocked(account)
						? `spent until ${formatTime(resetOf(account))}`
						: "ok";
				const active = account === lastRouted ? " (active)" : "";
				return `${label(account)} ${account}: ${state}${active}`;
			});
			if (revive) lines.push(`revive at ${formatTime(revive.at)}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
