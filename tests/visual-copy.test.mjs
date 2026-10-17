// Run from the repository root: node --test tests/visual-copy.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const extensionDir = join(repositoryRoot, "home/.pi/agent/extensions/visual-copy");
const modules = join(homedir(), ".pi/agent/install/releases/1.3.0/node_modules");
const tuiEntry = join(modules, "@earendil-works/pi-tui/dist/index.js");
const agentDist = join(modules, "@earendil-works/pi-coding-agent/dist");

const [{ createJiti }, { Container, Markdown }, { discoverAndLoadExtensions }] = await Promise.all([
	join(modules, "jiti/lib/jiti.mjs"),
	tuiEntry,
	join(agentDist, "core/extensions/loader.js"),
].map((path) => import(pathToFileURL(path).href)));

// The same aliases that pi gives extensions, so the modules use this pi-tui.
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-tui": tuiEntry,
		"@earendil-works/pi-coding-agent": join(agentDist, "index.js"),
	},
});
const transcript = await jiti.import(join(extensionDir, "transcript.ts"));
const { plainText } = await jiti.import(join(extensionDir, "ansi.ts"));

const fg = (code) => (text) => `\x1b[${code}m${text}\x1b[39m`;
const theme = {
	heading: fg(33),
	link: fg(34),
	linkUrl: fg(90),
	code: fg(36),
	codeBlock: fg(32),
	codeBlockBorder: fg(90),
	quote: fg(37),
	quoteBorder: fg(90),
	hr: fg(90),
	listBullet: fg(36),
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	italic: (text) => `\x1b[3m${text}\x1b[23m`,
	underline: (text) => `\x1b[4m${text}\x1b[24m`,
	strikethrough: (text) => `\x1b[9m${text}\x1b[29m`,
};

const source = [
	"Intro with `alpha` here.",
	"",
	"- item one `beta`",
	"  - nested `gamma`",
	"",
	"```js",
	"const x = 1;",
	"```",
	"",
	"```mermaid",
	"graph TD; A-->B",
	"```",
	"",
	"> quote with `a long inline code span that wraps over rows` end",
	"",
	"| a | b |",
	"|---|---|",
	"| `wrapped code cell value here` | next |",
].join("\n");

// Pi shows a Mermaid block as one inline code span for each diagram row.
const transform = (text) => text.replace(/```mermaid\n[\s\S]*?```/, "`A--B`\n`row2`");

// The shape of pi's AssistantMessageComponent that /vc reads.
class Assistant extends Container {
	constructor(markdown) {
		super();
		this.contentContainer = new Container();
		this.contentContainer.addChild(markdown);
		this.addChild(this.contentContainer);
	}

	updateContent() {}
}

const width = 30;

function fixture() {
	const markdown = new Markdown(source, 1, 0, theme, undefined, { transform });
	const owner = new Assistant(markdown);
	const document = new Container();
	document.addChild(new Markdown("header", 0, 0, theme));
	document.addChild(owner);
	const blocks = transcript.collectBlocks(document, width);
	return { markdown, owner, blocks, layout: transcript.buildLayout(blocks, width) };
}

test("pi loads the visual-copy directory and registers /vc", async (t) => {
	const agentDir = mkdtempSync(join(tmpdir(), "vc-agent-"));
	t.after(() => rmSync(agentDir, { recursive: true, force: true }));
	const { extensions, errors } = await discoverAndLoadExtensions([extensionDir], agentDir, agentDir);
	assert.deepEqual(errors, []);
	assert.equal(extensions.length, 1);
	assert.ok(extensions[0].commands.has("vc"));
});

test("layout gives block rows and inline code spans of a real Markdown render", () => {
	const { markdown, owner, blocks, layout } = fixture();
	const lines = markdown.render(width).map((line) => plainText(line).text);

	assert.deepEqual(
		blocks.map((b) => [b.raw.split("\n")[0], b.container, b.code, b.diagram?.source]),
		[
			["Intro with `alpha` here.", undefined, undefined, undefined],
			["- item one `beta`", undefined, undefined, undefined],
			["- nested `gamma`", 1, undefined, undefined],
			["```js", undefined, "const x = 1;", undefined],
			["```mermaid", undefined, undefined, "graph TD; A-->B"],
			["> quote with `a long inline code span that wraps over rows` end", undefined, undefined, undefined],
			["| a | b |", undefined, undefined, undefined],
		],
	);
	assert.deepEqual(blocks[4].diagram.lines, ["A--B", "row2"]);
	assert.deepEqual(layout.rows, [[0, 0], [2, 3], [3, 3], [5, 7], [9, 10], [12, 14], [16, 21]]);
	assert.equal(layout.offsets.get(markdown), 0);
	assert.deepEqual(lines.slice(9, 11).map((l) => l.trim()), ["A--B", "row2"]);

	// Diagram rows are code spans in the render, but not spans of the layout.
	assert.deepEqual(
		layout.spans.map((s) => [s.text, s.raw, s.start, s.end, s.block, s.owner === owner]),
		[
			["alpha", "`alpha`", [0, 12], [0, 17], 0, true],
			["beta", "`beta`", [2, 12], [2, 16], 1, true],
			["gamma", "`gamma`", [3, 14], [3, 19], 2, true],
			["a long inline code span that wraps over rows", "`a long inline code span that wraps over rows`", [12, 14], [14, 7], 5, true],
			["wrapped code cell value here", "`wrapped code cell value here`", [19, 3], [20, 13], 6, true],
		],
	);
	for (const span of layout.spans.slice(0, 3)) {
		assert.equal(lines[span.start[0]].slice(span.start[1], span.end[1]), span.text);
	}
});

test("the paint of a wrapped span covers only the span characters", () => {
	const { markdown, layout } = fixture();
	const lines = markdown.render(width).map((line) => plainText(line).text);
	const painted = (span) =>
		transcript.spanRanges(layout, span).map(({ row, start, end }) => [row, start, lines[row].slice(start, end)]);
	const [quote, cell] = layout.spans.slice(3);

	// The rows after the first start after the `│ ` border, not on it.
	assert.deepEqual(painted(quote), [
		[12, 14, "a long inline"],
		[13, 3, "code span that wraps over"],
		[14, 3, "rows"],
	]);
	// The rows stop at the end of the cell text, before its padding and the next cell.
	assert.deepEqual(painted(cell), [
		[19, 3, "wrapped code cell"],
		[20, 3, "value here"],
	]);
	assert.deepEqual(painted(layout.spans[0]), [[0, 12, "alpha"]]);
});

test("a Mermaid block with no diagram selects only its code rows", async () => {
	const { VisualCopy } = await jiti.import(join(extensionDir, "view.ts"));
	const markdown = new Markdown(["Before.", "", "```mermaid", "graph TD; A-->B", "```", "", "After."].join("\n"), 0, 0, theme);
	const document = new Container();
	document.addChild(new Assistant(markdown));
	const tui = { terminal: { columns: width }, requestRender() {}, children: [document] };
	const viewTheme = {
		fg: (_, text) => text,
		bg: (_, text) => `\x1b[44m${text}\x1b[49m`,
		bold: (text) => text,
		inverse: (text) => text,
		getFgAnsi: () => "\x1b[38;5;1m",
	};
	const blocks = transcript.collectBlocks(document, width);
	const view = new VisualCopy(tui, viewTheme, blocks, () => {});
	view.handleInput("k");
	view.render(width);

	const selected = document
		.render(width)
		.filter((line) => line.includes("\x1b[44m"))
		.map((line) => plainText(line).text.trim());
	// The marker in front is the gutter of the selected block.
	assert.deepEqual(selected, ["▌ graph TD; A-->B"]);
});
