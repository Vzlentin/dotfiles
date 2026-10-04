// Run from the repository root: node --test tests/goal-blocker.test.mjs

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const piDist = join(
	homedir(),
	".pi/agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent/dist",
);
const [{ loadExtensions }, { ExtensionRunner }, { SessionManager }, { AgentSession }, { SettingsManager }] = await Promise.all([
	"core/extensions/loader.js",
	"core/extensions/runner.js",
	"core/session-manager.js",
	"core/agent-session.js",
	"core/settings-manager.js",
].map((path) => import(pathToFileURL(join(piDist, path)).href)));

const [{ Agent }, { AssistantMessageEventStream }] = await Promise.all([
	import(pathToFileURL(join(piDist, "../../pi-agent-core/dist/agent.js")).href),
	import(pathToFileURL(join(piDist, "../../pi-ai/dist/utils/event-stream.js")).href),
]);

async function loadGoal(t, sessionManager = SessionManager.inMemory(repositoryRoot), state = { idle: true }) {
	const loaded = await loadExtensions([join(repositoryRoot, "home/.pi/agent/extensions/goal.ts")], repositoryRoot);
	assert.deepEqual(loaded.errors, []);
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, repositoryRoot, sessionManager, undefined);
	const errors = [];
	const sent = [];
	runner.onError((error) => errors.push(error));
	t.after(() => assert.deepEqual(errors, []));
	runner.bindCore({
		appendEntry: (type, data) => sessionManager.appendCustomEntry(type, data),
		sendMessage: (message, options) => sent.push({ message, options }),
	}, {
		isIdle: () => state.idle,
		hasPendingMessages: () => false,
	});
	await runner.emit({ type: "session_start", reason: "startup" });
	return {
		runner,
		sessionManager,
		state,
		sent,
		useUI(objective) {
			runner.setUIContext({
				...runner.createContext().ui,
				theme: { fg: (_color, text) => text },
				editor: async () => objective,
				confirm: async () => true,
			}, "tui");
		},
		async call(name, params = {}) {
			return runner.getToolDefinition(name).execute("test-call", params, undefined, undefined, runner.createContext());
		},
		async command(args) {
			await runner.getCommand("goal").handler(args, runner.createContext());
		},
		async start() {
			state.idle = false;
			await runner.emit({ type: "agent_start" });
		},
		async end(messages = []) {
			await runner.emit({ type: "agent_end", messages });
			state.idle = true;
		},
	};
}

async function rejectBlocked(h) {
	await assert.rejects(h.call("update_goal", { status: "blocked" }), /three consecutive goal turns/);
	assert.equal((await h.call("get_goal")).details.goal.status, "active");
}

async function reportTurn(h, blocker = "Access denied") {
	await h.start();
	await h.call("update_goal", { blocker });
}

function latestState(h) {
	return h.sessionManager.getBranch().findLast((entry) => entry.type === "custom" && entry.customType === "goal").data;
}

test("update_goal rejects blocking without three reported goal turns", async (t) => {
	const h = await loadGoal(t);
	await h.start();
	await h.call("create_goal", { objective: "Finish the requested work." });
	await rejectBlocked(h);
});

test("the original goal-creation turn counts, duplicate calls and model steps do not", async (t) => {
	const h = await loadGoal(t);
	await h.start();
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (let i = 0; i < 3; i++) {
		await h.runner.emit({ type: "turn_start", turnIndex: i, timestamp: Date.now() });
		await h.call("update_goal", { blocker: "  Access denied\n" });
		await rejectBlocked(h);
	}
	await h.end();
	await reportTurn(h);
	await rejectBlocked(h);
	await h.end();
	await reportTurn(h);
	const result = await h.call("update_goal", { status: "blocked" });
	assert.equal(result.details.goal.status, "blocked");
	await h.end();
	assert.equal(h.sent.filter(({ message }) => message.customType === "goal-continuation").length, 2);
});

test("changed identities restart the sequence, including changes in the same turn", async (t) => {
	const h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	await reportTurn(h);
	await h.end();
	await reportTurn(h);
	await h.call("update_goal", { blocker: "access denied" });
	await h.call("update_goal", { blocker: "Access denied" });
	await rejectBlocked(h);
	await h.end();
	await reportTurn(h);
	await rejectBlocked(h);
	await h.end();
	await reportTurn(h);
	assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
});

test("a zero-usage missing-report turn persists a gap across reload", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	let h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (let i = 0; i < 2; i++) {
		await reportTurn(h);
		await h.end();
	}
	await h.start();
	await h.end();
	assert.equal(latestState(h).turn, 3);
	assert.equal(latestState(h).turnRunning, false);
	assert.equal(latestState(h).goal.tokensUsed, 0);
	assert.equal(latestState(h).goal.timeUsedSeconds, 0);
	h = await loadGoal(t, h.sessionManager);
	for (let i = 0; i < 2; i++) {
		await reportTurn(h);
		await rejectBlocked(h);
		await h.end();
	}
	await reportTurn(h);
	assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
});

test("an earlier qualifying sequence cannot block a later unreported turn", async (t) => {
	const h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (let i = 0; i < 3; i++) {
		await reportTurn(h);
		await h.end();
	}
	await assert.rejects(h.call("update_goal", { status: "blocked" }), /three consecutive goal turns/);
	await h.start();
	await rejectBlocked(h);
});

test("unrelated turns while paused break the sequence", async (t) => {
	const h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (let i = 0; i < 2; i++) {
		await reportTurn(h);
		await h.end();
	}
	await h.command("pause");
	await h.start();
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /active goal/);
	await h.end();
	await h.command("resume");
	await reportTurn(h);
	await rejectBlocked(h);
});

test("update forms require one valid field, and reporting requires an active running goal", async (t) => {
	const h = await loadGoal(t);
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /active goal/);
	await h.start();
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /active goal/);
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (const params of [{}, { status: "active" }, { status: "paused" }, { status: "complete", blocker: "A" }, { blocker: " \n\t" }, { blocker: 3 }]) {
		await assert.rejects(h.call("update_goal", params));
	}
	assert.equal((await h.call("get_goal")).details.goal.status, "active");
	await h.end();
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /running goal turn/);
	await h.start();
	await h.command("pause");
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /active goal/);
	await h.call("update_goal", { status: "complete" });
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /active goal/);
});

test("existing goal transitions reset evidence", async (t) => {
	for (const transition of ["blocked resume", "blocked pause/resume", "objective edit", "replacement", "clear"]) {
		await t.test(transition, async (t) => {
			const h = await loadGoal(t);
			await h.call("create_goal", { objective: "Finish the requested work." });
			for (let i = 0; i < 3; i++) {
				if (i > 0) await h.end();
				await reportTurn(h);
			}
			h.useUI("Finish a different objective.");
			if (transition === "blocked resume" || transition === "blocked pause/resume") {
				await h.call("update_goal", { status: "blocked" });
				if (transition === "blocked pause/resume") await h.command("pause");
				await h.command("resume");
			} else if (transition === "objective edit") {
				await h.command("edit");
			} else if (transition === "replacement") {
				await h.command("Finish a replacement objective.");
			} else {
				await h.command("clear");
				assert.equal((await h.call("get_goal")).details.goal, null);
				await h.call("create_goal", { objective: "Finish a new objective." });
			}
			await rejectBlocked(h);
			await h.call("update_goal", { blocker: "Access denied" });
			await rejectBlocked(h);
			await h.end();
			await reportTurn(h);
			await rejectBlocked(h);
			await h.end();
			await reportTurn(h);
			assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
		});
	}
});

test("unchanged edits, active resume, and pause/resume alone preserve evidence", async (t) => {
	const h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (let i = 0; i < 2; i++) {
		await reportTurn(h);
		await h.end();
	}
	await h.start();
	h.useUI("  Finish the requested work.\n");
	await h.command("edit");
	await h.command("resume");
	await h.command("pause");
	await h.command("resume");
	await h.call("update_goal", { blocker: "Access denied" });
	assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
});

test("reload restores a reported turn without counting it again or mutating earlier snapshots", async (t) => {
	let h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	await reportTurn(h);
	const earlierSnapshot = latestState(h);
	const earlierText = JSON.stringify(earlierSnapshot);
	await h.end();
	await reportTurn(h);
	const turn = latestState(h).turn;
	h = await loadGoal(t, h.sessionManager, h.state);
	await h.call("update_goal", { blocker: "Access denied" });
	await h.call("update_goal", { blocker: "Access denied" });
	assert.equal(latestState(h).turn, turn);
	await rejectBlocked(h);
	assert.equal(JSON.stringify(earlierSnapshot), earlierText);
	await h.end();
	await reportTurn(h);
	assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
});

test("reload after a closed turn preserves evidence while Pi is still busy", async (t) => {
	let h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	for (let i = 0; i < 2; i++) {
		await reportTurn(h);
		await h.end();
	}
	assert.equal(latestState(h).turnRunning, false);
	h.state.idle = false;
	h = await loadGoal(t, h.sessionManager, h.state);
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /running goal turn/);
	await reportTurn(h);
	assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
});

test("tree navigation reconstructs only the selected branch", async (t) => {
	let h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work." });
	await reportTurn(h);
	await h.end();
	const fork = h.sessionManager.getLeafId();
	await reportTurn(h);
	await h.end();
	await reportTurn(h);
	const otherBranch = h.sessionManager.getLeafId();
	await h.end();
	h.sessionManager.branch(fork);
	h.state.idle = false;
	await h.runner.emit({ type: "session_tree" });
	await assert.rejects(h.call("update_goal", { blocker: "Access denied" }), /running goal turn/);
	await reportTurn(h);
	await rejectBlocked(h);
	await h.end();
	h.sessionManager.branch(otherBranch);
	h.state.idle = false;
	h = await loadGoal(t, h.sessionManager, h.state);
	assert.equal((await h.call("update_goal", { status: "blocked" })).details.goal.status, "blocked");
});

test("legacy and invalid audit entries grant no blocking permission", async (t) => {
	const goal = {
		id: "legacy", objective: "Finish the requested work.", status: "active",
		tokensUsed: 13, timeUsedSeconds: 7, createdAt: 1, updatedAt: 1,
	};
	const audit = { blocker: "Access denied", blockerTurn: 3, blockerTurns: 3 };
	for (const data of [
		{ version: 1, goal },
		{ version: 2, goal: { ...goal, ...audit } },
		{ turn: 3, turnRunning: true, goal: { ...goal, ...audit, blockerTurns: 2.5 } },
		{ turn: 3, turnRunning: true, goal: { ...goal, ...audit, blocker: " " } },
		{ turn: 3, turnRunning: true, goal: { ...goal, ...audit, blockerTurn: 4 } },
		{ turn: 3, turnRunning: true, goal: { ...goal, ...audit, blockerTurns: undefined } },
		{ turn: "3", turnRunning: true, goal: { ...goal, ...audit } },
	]) {
		const manager = SessionManager.inMemory(repositoryRoot);
		manager.appendCustomEntry("goal", data);
		const h = await loadGoal(t, manager, { idle: false });
		await rejectBlocked(h);
		await h.call("update_goal", { blocker: "Access denied" });
		await rejectBlocked(h);
		assert.equal((await h.call("get_goal")).details.goal.tokensUsed, 13);
	}
});

test("completion, budget accounting, and automatic error stops keep their behavior", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	const h = await loadGoal(t);
	await h.call("create_goal", { objective: "Finish the requested work.", token_budget: 1_000 });
	await h.start();
	await h.call("update_goal", { blocker: "Access denied" });
	t.mock.timers.tick(2_000);
	const complete = await h.call("update_goal", { status: "complete" });
	assert.equal(complete.details.goal.status, "complete");
	assert.match(complete.details.completionBudgetReport, /time used: 2s/);
	await h.end([
		{ role: "assistant", usage: { input: 100, cacheRead: 40, output: 10 } },
		{ role: "toolResult", usage: { totalTokens: 20 } },
	]);
	assert.equal((await h.call("get_goal")).details.goal.tokensUsed, 90);
	assert.equal(h.sent.length, 0);
	await h.call("create_goal", { objective: "Finish the next objective." });
	await h.start();
	await rejectBlocked(h);
	await h.end([{ role: "assistant", stopReason: "error", errorMessage: "Connection failed" }]);
	assert.equal((await h.call("get_goal")).details.goal.status, "blocked");
	assert.equal(h.sent.filter(({ message }) => message.customType === "goal-continuation").length, 0);
});

test("assistant errors persist the stop status without automatic continuation", async (t) => {
	for (const [errorMessage, status] of [
		["quota exceeded", "usageLimited"],
		["rate limit exceeded", "usageLimited"],
		["usage limit exceeded", "usageLimited"],
		["too many requests", "usageLimited"],
		["HTTP 429", "usageLimited"],
		["RaTe LiMiT exceeded", "usageLimited"],
		["Context length limit exceeded", "blocked"],
		["Request size limit exceeded", "blocked"],
		["Unexpected usage value", "blocked"],
		["Invalid sampling rate", "blocked"],
		["Limit exceeded", "blocked"],
		["Connection failed", "blocked"],
		["HTTP 1429", "blocked"],
		["HTTP 4290", "blocked"],
	]) {
		await t.test(errorMessage, async (t) => {
			const h = await loadGoal(t);
			await h.call("create_goal", { objective: "Finish the requested work." });
			await h.start();
			await h.end([{ role: "assistant", stopReason: "error", errorMessage }]);
			assert.equal((await h.call("get_goal")).details.goal.status, status);
			assert.equal(latestState(h).goal.status, status);
			assert.equal(h.sent.filter(({ message }) => message.customType === "goal-continuation").length, 0);
		});
	}
});

test("audit turns do not change goal-creation accounting or budget stops", async (t) => {
	const h = await loadGoal(t);
	await h.start();
	await h.call("create_goal", { objective: "Finish the requested work.", token_budget: 100 });
	await h.call("update_goal", { blocker: "Access denied" });
	await h.end([{ role: "assistant", usage: { totalTokens: 80 } }]);
	assert.equal((await h.call("get_goal")).details.goal.tokensUsed, 0);
	await h.start();
	await h.call("update_goal", { blocker: "Access denied" });
	await h.end([{ role: "assistant", usage: { totalTokens: 100 } }]);
	const result = (await h.call("get_goal")).details;
	assert.equal(result.goal.tokensUsed, 100);
	assert.equal(result.goal.status, "budgetLimited");
	assert.equal(result.remainingTokens, 0);
	assert.equal(h.sent.filter(({ message }) => message.customType === "goal-continuation").length, 1);
});

test("automatic continuations, reload, and tree navigation preserve goal runs through AgentSession", { timeout: 10_000 }, async (t) => {
	let loaded = await loadExtensions([join(repositoryRoot, "home/.pi/agent/extensions/goal.ts")], repositoryRoot);
	assert.deepEqual(loaded.errors, []);
	const model = {
		id: "offline", name: "offline", provider: "offline", api: "openai-completions",
		baseUrl: "http://unused.invalid", reasoning: false, input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000,
	};
	const responses = [
		["create_goal", { objective: "Finish the requested work." }],
		["update_goal", { blocker: "Access denied" }],
		["update_goal", { status: "blocked" }],
		null,
		["update_goal", { blocker: "Access denied" }],
		["update_goal", { status: "blocked" }],
		null,
		["update_goal", { blocker: "Access denied" }],
		["update_goal", { status: "blocked" }],
		null,
	];
	const requests = [];
	const agent = new Agent({
		initialState: { model },
		streamFn: async (_model, context) => {
			const index = requests.length;
			assert.ok(index < responses.length, "unexpected extra model request");
			requests.push(structuredClone(context));
			if (index === 5) await session.reload();
			const call = responses[index];
			const message = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: call ? [{ type: "toolCall", id: `call-${index}`, name: call[0], arguments: call[1] }]
					: [{ type: "text", text: "The external condition has not changed." }],
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } },
				stopReason: call ? "toolUse" : "stop", timestamp: Date.now(),
			};
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "done", reason: message.stopReason, message });
			return stream;
		},
	});
	const sessionManager = SessionManager.inMemory(repositoryRoot);
	const runnerRef = {};
	const session = new AgentSession({
		agent, sessionManager, cwd: repositoryRoot, extensionRunnerRef: runnerRef,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
		modelRuntime: {
			hasConfiguredAuth: () => true,
			getAuth: async () => ({ auth: { apiKey: "offline-fixture" } }),
			getModel: () => model,
			getPhysicalModel: () => model,
		},
		resourceLoader: {
			getExtensions: () => loaded,
			getSkills: () => ({ skills: [] }),
			getPrompts: () => ({ prompts: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => "Offline goal regression.",
			getAppendSystemPrompt: () => [],
			reload: async () => {
				loaded = await loadExtensions([join(repositoryRoot, "home/.pi/agent/extensions/goal.ts")], repositoryRoot);
				assert.deepEqual(loaded.errors, []);
			},
		},
		baseToolsOverride: {},
	});
	t.after(() => session.dispose());
	const errors = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt("Create a goal and pursue the requested work.");
	assert.deepEqual(errors, []);
	assert.equal(requests.length, responses.length);
	assert.equal(events.filter(({ type }) => type === "agent_start").length, 3);
	assert.equal(events.filter(({ type }) => type === "agent_end").length, 3);
	const blockResults = session.messages.filter((message) => message.role === "toolResult" &&
		["call-2", "call-5", "call-8"].includes(message.toolCallId));
	assert.deepEqual(blockResults.map(({ isError }) => isError), [true, true, false]);
	assert.equal(blockResults[2].details.goal.status, "blocked");
	const continuations = session.messages.filter((message) => message.customType === "goal-continuation");
	assert.equal(continuations.length, 2);
	for (const continuation of continuations) {
		assert.match(continuation.content, /update_goal\(\{ blocker: "stable identity" \}\)/);
		assert.match(continuation.content, /including this turn/);
		assert.doesNotMatch(continuation.content, /Do not call update_goal unless/);
	}
	const secondTurnEnd = sessionManager.getBranch().find((entry) => entry.type === "custom" &&
		entry.customType === "goal" && entry.data.turn === 2 && entry.data.turnRunning === false);
	assert.ok(secondTurnEnd);
	assert.equal((await session.navigateTree(secondTurnEnd.id)).cancelled, false);
	await assert.rejects(runnerRef.current.getToolDefinition("update_goal").execute(
		"idle-report", { blocker: "Access denied" }, undefined, undefined, runnerRef.current.createContext(),
	), /running goal turn/);
	responses.push(["update_goal", { blocker: "Access denied" }], ["update_goal", { status: "blocked" }], null);
	await session.prompt("Check the same blocker again.");
	assert.deepEqual(errors, []);
	const thirdReportResult = session.messages.find((message) => message.toolCallId === "call-11" && message.role === "toolResult");
	assert.equal(thirdReportResult.isError, false);
	assert.equal(thirdReportResult.details.goal.status, "blocked");
});
