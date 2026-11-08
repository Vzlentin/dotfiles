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
 * A switch loses the prompt cache once: caches belong to one account. Thinking blocks of the other
 * account go to the new one as plain text, the same as after a manual model switch.
 *
 * `/claude-pool` shows each account and when its quota resets.
 */

import { anthropicMessagesApi, createProvider, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { builtinProviders, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

const ACCOUNT_COUNT = 2;
const POOL = "claude-pool";
const ACCOUNTS = ["anthropic", ...Array.from({ length: ACCOUNT_COUNT - 1 }, (_, i) => `anthropic-${i + 2}`)];
// Used when a quota 429 has no reset header.
const DEFAULT_BLOCK_MS = 60 * 60 * 1000;

interface PoolState {
	account: string;
}

// Per Pi process. A new process learns a spent account again from its first 429.
const blockedUntil = new Map<string, number>();
let lastRouted: string | undefined;

// Pi reports no headers for a failed request (after_provider_response fires only on success), so
// the quota headers of a 429 are read from fetch. The Anthropic SDK uses the global fetch.
const ORIGINAL_FETCH = Symbol.for("claude-pool.original-fetch");

function watchQuota429s(): void {
	const current = globalThis.fetch as typeof fetch & { [ORIGINAL_FETCH]?: typeof fetch };
	const original = current[ORIGINAL_FETCH] ?? current;
	const watched = async (...args: Parameters<typeof fetch>) => {
		const account = lastRouted;
		const response = await original(...args);
		// The unified status header can say "rejected" on a 200 too, so only a 429 counts.
		if (account && response.status === 429 && response.headers.get("anthropic-ratelimit-unified-status") === "rejected") {
			blockedUntil.set(account, quotaResetMs(response.headers));
		}
		return response;
	};
	globalThis.fetch = Object.assign(watched, { [ORIGINAL_FETCH]: original }) as typeof fetch;
}

function isBlocked(account: string): boolean {
	return (blockedUntil.get(account) ?? 0) > Date.now();
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
		usable.reduce((a, b) => ((blockedUntil.get(a) ?? 0) <= (blockedUntil.get(b) ?? 0) ? a : b))
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

	pi.registerCommand(POOL, {
		description: "Show the Claude pool accounts and their quota state",
		handler: async (_args, ctx) => {
			const lines = ACCOUNTS.map((account) => {
				const loggedIn = ctx.modelRegistry
					.getAll()
					.some((model) => model.provider === account && ctx.modelRegistry.hasConfiguredAuth(model));
				const until = blockedUntil.get(account) ?? 0;
				const state = !loggedIn ? `not logged in (/login ${account})` : until > Date.now() ? `spent until ${formatTime(until)}` : "ok";
				const active = account === lastRouted ? " (active)" : "";
				return `${label(account)} ${account}: ${state}${active}`;
			});
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
