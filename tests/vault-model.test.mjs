// Run from the repository root: node --test tests/vault-model.test.mjs

import assert from "node:assert/strict";
import {
	existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const piDist = join(
	homedir(),
	".pi/agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent/dist",
);
const [{ loadExtensions }, { ExtensionRunner }, { SessionManager }] = await Promise.all([
	"core/extensions/loader.js",
	"core/extensions/runner.js",
	"core/session-manager.js",
].map((path) => import(pathToFileURL(join(piDist, path)).href)));

const modelA = { provider: "offline", id: "session-a" };
const modelB = { provider: "offline", id: "session-b" };
const overrideModel = { provider: "offline-override", id: "router" };
const assistantText = "Offline assistant reply.\n\nSecond paragraph.\n- First item\n- Second item";
const manualContent = "# Manual\n";
const recommendedContent = "# Recommended\n";

async function loadVault(t, { override, sessionModel, unauthenticatedModel, initialContent = manualContent }) {
	const fixtureRoot = mkdtempSync(join(repositoryRoot, ".vault-model-test-"));
	t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
	const vaultRoot = join(fixtureRoot, "vault");
	mkdirSync(vaultRoot);
	if (initialContent === null) writeFileSync(join(vaultRoot, "existing.md"), "# Existing\n");
	else writeFileSync(join(vaultRoot, "manual.md"), initialContent);
	writeFileSync(join(vaultRoot, "recommended.md"), recommendedContent);
	for (const [name, value] of [["VAULT", vaultRoot], ["PI_VAULT_MODEL", override]]) {
		const previous = process.env[name];
		t.after(() => {
			if (previous === undefined) delete process.env[name];
			else process.env[name] = previous;
		});
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}

	const loaded = await loadExtensions([join(repositoryRoot, "home/.pi/agent/extensions/vault.ts")], repositoryRoot);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	const sessionManager = SessionManager.inMemory(repositoryRoot);
	sessionManager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: assistantText }],
		stopReason: "stop",
	});
	const state = { model: sessionModel };
	const getAll = t.mock.fn(() => [modelA, modelB, overrideModel]);
	const hasConfiguredAuth = t.mock.fn((model) => model !== unauthenticatedModel);
	const complete = t.mock.fn(async () => ({
		stopReason: "stop",
		content: [{ type: "text", text: "1" }],
	}));
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, repositoryRoot, sessionManager, {
		getAll, hasConfiguredAuth, complete,
	});
	runner.bindCore({}, { getModel: () => state.model });
	const notifications = [];
	const screens = [];
	let selectedPath;
	const theme = { fg: (_color, text) => text };
	runner.setUIContext({
		...runner.createContext().ui,
		theme,
		notify: (message, type) => notifications.push({ message, type }),
		custom: async (factory) => {
			let finish;
			const result = new Promise((resolve) => { finish = resolve; });
			let requestRender;
			const routingReady = new Promise((resolve) => { requestRender = resolve; });
			const component = factory({
				terminal: { rows: 40, columns: 160 },
				requestRender,
			}, theme, {}, finish);
			component.focused = true;
			const pending = component.render(160);
			await routingReady;
			const routed = component.render(160);
			component.handleInput("\x15");
			component.handleInput(selectedPath);
			const edited = component.render(160);
			component.handleInput("\r");
			screens.push({ pending, routed, edited });
			return result;
		},
	}, "tui");
	const ctx = runner.createCommandContext();
	let commands = 0;
	let saves = 0;
	return {
		fixtureRoot, vaultRoot, state, getAll, hasConfiguredAuth, complete,
		async command(expectedError, { notePath = "manual.md", destinationError } = {}) {
			selectedPath = notePath;
			const notificationCount = notifications.length;
			await runner.getCommand("vault").handler("", ctx);
			commands += 1;
			assert.equal(screens.length, commands);
			const screen = screens.at(-1);
			assert.match(screen.pending[0], /finding a home/);
			if (expectedError) {
				assert.ok(screen.routed[0].includes(`no recommendation: ${expectedError}`), screen.routed[0]);
			} else {
				assert.match(screen.routed[0], /save it here/);
				assert.ok(screen.routed.join("\n").includes("recommended.md"));
			}
			assert.ok(screen.edited.join("\n").includes(notePath));
			if (destinationError) {
				assert.deepEqual(notifications.slice(notificationCount), [{ message: destinationError, type: "error" }]);
			} else {
				saves += 1;
				assert.deepEqual(notifications.slice(notificationCount), [{ message: "saved manual.md", type: "info" }]);
			}
			assert.equal(readFileSync(join(vaultRoot, "manual.md"), "utf8"), (initialContent ?? "") + `\n\n---\n\n${assistantText}`.repeat(saves));
			assert.equal(readFileSync(join(vaultRoot, "recommended.md"), "utf8"), recommendedContent);
		},
	};
}

test("every save adds a separator and preserves existing content", { timeout: 10_000 }, async (t) => {
	for (const [name, initialContent] of [
		["missing file", null],
		["empty file", ""],
		["populated file without a trailing newline", "# Manual\nExisting content."],
		["populated file with one trailing newline", "# Manual\nExisting content.\n"],
		["populated file with multiple trailing newlines", "# Manual\nExisting content.\n\n\n"],
	]) {
		await t.test(name, async (t) => {
			const h = await loadVault(t, { sessionModel: modelA, initialContent });
			await h.command();
		});
	}
});

test("an internal file link appends to its target with a symbolic-link VAULT root", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { sessionModel: modelA });
	const vaultLink = join(h.fixtureRoot, "vault-link");
	symlinkSync(h.vaultRoot, vaultLink, "dir");
	process.env.VAULT = vaultLink;
	const noteLink = join(h.vaultRoot, "linked.md");
	symlinkSync("manual.md", noteLink);

	await h.command(undefined, { notePath: "linked.md" });
	assert.ok(lstatSync(noteLink).isSymbolicLink());
	assert.equal(readlinkSync(noteLink), "manual.md");
	assert.ok(lstatSync(vaultLink).isSymbolicLink());
	assert.equal(readlinkSync(vaultLink), h.vaultRoot);
});

test("a link to a directory is rejected", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { sessionModel: modelA });
	const directory = join(h.vaultRoot, "directory");
	mkdirSync(directory);
	symlinkSync(directory, join(h.vaultRoot, "linked.md"), "dir");

	await h.command(undefined, {
		notePath: "linked.md",
		destinationError: "The note path is not a file",
	});
});

test("an outside file link is rejected without changing its target", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { sessionModel: modelA });
	const outsidePath = join(h.fixtureRoot, "outside.md");
	const outsideContent = "# Outside\nKeep this content.\n";
	writeFileSync(outsidePath, outsideContent);
	symlinkSync(outsidePath, join(h.vaultRoot, "linked.md"));

	await h.command(undefined, {
		notePath: "linked.md",
		destinationError: "The note path is not a file in VAULT",
	});
	assert.equal(readFileSync(outsidePath, "utf8"), outsideContent);
});

test("an outside parent-directory link is rejected for existing and missing notes", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { sessionModel: modelA });
	const outsideDirectory = join(h.fixtureRoot, "outside");
	mkdirSync(outsideDirectory);
	symlinkSync(outsideDirectory, join(h.vaultRoot, "linked-parent"), "dir");
	const outsidePath = join(outsideDirectory, "existing.md");
	const outsideContent = "# Outside\nKeep this content.\n";
	writeFileSync(outsidePath, outsideContent);

	await h.command(undefined, {
		notePath: "linked-parent/existing.md",
		destinationError: "The note path is not a file in VAULT",
	});
	assert.equal(readFileSync(outsidePath, "utf8"), outsideContent);
	await h.command(undefined, {
		notePath: "linked-parent/missing.md",
		destinationError: "The note parent path must be inside VAULT",
	});
	assert.equal(existsSync(join(outsideDirectory, "missing.md")), false);
});

test("dangling links are rejected without creating their targets", { timeout: 10_000 }, async (t) => {
	for (const location of ["inside", "outside"]) {
		await t.test(location, async (t) => {
			const h = await loadVault(t, { sessionModel: modelA });
			const targetPath = join(location === "inside" ? h.vaultRoot : h.fixtureRoot, "missing.md");
			const noteLink = join(h.vaultRoot, "dangling.md");
			symlinkSync(targetPath, noteLink);

			await h.command(undefined, {
				notePath: "dangling.md",
				destinationError: "The note path exists but cannot be resolved",
			});
			assert.equal(existsSync(targetPath), false);
			assert.ok(lstatSync(noteLink).isSymbolicLink());
			assert.equal(readlinkSync(noteLink), targetPath);
		});
	}
});

test("unset, empty, and whitespace-only overrides use the session model", { timeout: 10_000 }, async (t) => {
	for (const [name, override] of [["unset", undefined], ["empty", ""], ["whitespace", " \t\n "]]) {
		await t.test(name, async (t) => {
			const h = await loadVault(t, { override, sessionModel: modelA });
			await h.command();
			assert.equal(h.complete.mock.callCount(), 1);
			assert.equal(h.complete.mock.calls[0].arguments[0], modelA);
			assert.equal(h.hasConfiguredAuth.mock.calls[0].arguments[0], modelA);
			assert.equal(h.getAll.mock.callCount(), 0);
		});
	}
});

test("one loaded extension follows a session model switch", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { sessionModel: modelA });
	await h.command();
	h.state.model = modelB;
	await h.command();
	assert.deepEqual(h.complete.mock.calls.map((call) => call.arguments[0]), [modelA, modelB]);
	assert.deepEqual(h.hasConfiguredAuth.mock.calls.map((call) => call.arguments[0]), [modelA, modelB]);
});

test("a trimmed nonblank override wins over the session model", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { override: " \t offline-override/router \n ", sessionModel: modelA });
	await h.command();
	assert.equal(h.complete.mock.callCount(), 1);
	assert.equal(h.complete.mock.calls[0].arguments[0], overrideModel);
	assert.equal(h.hasConfiguredAuth.mock.calls[0].arguments[0], overrideModel);
	assert.equal(h.getAll.mock.callCount(), 1);
});

test("an unknown override does not fall back to a valid session model", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { override: "offline/missing", sessionModel: modelA });
	await h.command("offline/missing is not available");
	assert.equal(h.complete.mock.callCount(), 0);
	assert.equal(h.hasConfiguredAuth.mock.callCount(), 0);
});

test("a missing session model leaves manual saving available", { timeout: 10_000 }, async (t) => {
	const h = await loadVault(t, { sessionModel: undefined });
	await h.command("No session model is selected");
	assert.equal(h.complete.mock.callCount(), 0);
	assert.equal(h.hasConfiguredAuth.mock.callCount(), 0);
});

test("missing authentication names the selected model and permits manual saving", { timeout: 10_000 }, async (t) => {
	for (const [name, override, selectedModel] of [
		["session", undefined, modelA],
		["override", "offline-override/router", overrideModel],
	]) {
		await t.test(name, async (t) => {
			const h = await loadVault(t, { override, sessionModel: modelA, unauthenticatedModel: selectedModel });
			await h.command(`No authentication is configured for ${selectedModel.provider}/${selectedModel.id}`);
			assert.equal(h.complete.mock.callCount(), 0);
			assert.equal(h.hasConfiguredAuth.mock.callCount(), 1);
			assert.equal(h.hasConfiguredAuth.mock.calls[0].arguments[0], selectedModel);
		});
	}
});
