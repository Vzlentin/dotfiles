#!/usr/bin/env node
// Renders one Markdown source into one self-contained HTML page.
// Usage: render.mjs [--share] <source.md> [out.html]
//        render.mjs --theme
// The page goes to /tmp/pages/<slug>/index.html by default: build output stays out of the vault.
// --share: a light copy for other people and for print. --theme: the colors as CSS variables.
//
// It uses what is already on the machine, first from the Pi install, then from the global npm prefix:
// - Markdown and code colors: marked and highlight.js
// - diagrams: the Pele script of the show-me skill
// - colors: Pi's `system` theme computed from the Ghostty colors (as herdr-pi-theme does).
//   Without Pi: the terminal theme (Ghostty colors, mapped by color number). Without both: saved colors.
// PAGES_NO_PI=1 renders as if Pi were not installed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderMermaid } from "../show-me/mermaid.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const [recordPath, outPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const share = flags.has("--share");
if (!recordPath && !flags.has("--theme")) {
	console.error("usage: render.mjs [--share] <source.md> [out.html] | render.mjs --theme");
	process.exit(2);
}

// A light page: the colors of a terminal with a white background.
const LIGHT = {
	name: "light",
	background: "#ffffff",
	foreground: "#1b1f24",
	palette: ["#1b1f24", "#b42318", "#2e7d32", "#8a5a00", "#0055a5", "#7b1fa2", "#00796b", "#5f6b7a", "#5f6b7a", "#d92d20", "#43a047", "#a66f00", "#1565c0", "#8e24aa", "#00897b", "#1b1f24"],
};

const pi = process.env.PAGES_NO_PI === "1" ? undefined : piInstall();
const npmModules = join(execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim(), "lib/node_modules");
const moduleDirs = [pi?.modules, npmModules].filter(Boolean);
const markedDir = findModule("marked");
if (!markedDir) throw new Error("marked not found in Pi or in the global npm prefix: npm install -g marked");
const { Marked } = await import(pathToFileURL(join(markedDir, "lib/marked.esm.js")).href);
const hljsDir = findModule("highlight.js");
const hljs = hljsDir ? createRequire(import.meta.url)(hljsDir) : undefined;
const theme = share ? { source: "light", colors: terminalTokens(LIGHT) } : await loadTheme();
if (flags.has("--theme")) {
	console.log(`:root{${cssTokens(theme.colors)}}`);
	process.exit(0);
}

const source = readFileSync(recordPath, "utf8");
const { meta, body } = frontmatter(source);
const status = meta.status ?? "open";
if (!meta.page) throw new Error("The source needs a `page:` slug in its frontmatter");
const { intro, sections } = splitSections(body);
const decisions = splitAt(sections.find((section) => section.title === "Decisions")?.text ?? "", "### ")
	.slice(1)
	.map(parseDecision);
const byNumber = new Map(decisions.map((decision) => [decision.n, decision]));

const md = new Marked({ gfm: true });
md.use({ renderer: { code: renderCode } });
const block = (text) =>
	fillBlanks(md.parse(unlink(text))).replaceAll("<table>", '<div class="tw"><table>').replaceAll("</table>", "</table></div>");
const inline = (text) => fillBlanks(md.parseInline(unlink(text)));

const title = (intro.match(/^# (.+)$/m)?.[1] ?? meta.title ?? meta.page).trim();
const lede = intro.replace(/^# .+$/m, "").trim();
const counts = {
	you: decisions.filter((decision) => decision.whose === "you").length,
	me: decisions.filter((decision) => decision.whose === "me").length,
	decided: decisions.filter((decision) => decision.decided).length,
};
const round = Number(meta.round ?? 1);
const stage = { open: "open", readback: "read-back", contract: "contract" }[status];
if (!stage) throw new Error(`Unknown status: ${status}`);

const nav = [];
const main = sections
	.map((section) => {
		const id = slug(section.title);
		nav.push(`<a href="#${id}">${escapeHtml(section.title)}</a>`);
		const kind = { Terms: "terms", Settled: "settled" }[section.title] ?? "learn";
		const inner = section.title === "Decisions" ? renderDecisions() : block(section.text);
		const heading = `<h2>${escapeHtml(section.title)}</h2>`;
		// Settled holds the earlier answers: it opens on demand.
		const body = kind === "settled" ? `<details class="fold"><summary>${heading}</summary>${inner}</details>` : heading + inner;
		return `<section id="${id}" class="${kind}">${body}</section>`;
	})
	.join("\n");

const data = {
	slug: meta.page,
	round,
	status,
	decisions: decisions.map(({ n, whose, plan, options, decided, answer, own }) => ({
		n,
		whose,
		plan,
		decided,
		answer,
		own,
		labels: Object.fromEntries(options.map((option) => [option.key, plainText(option.label)])),
	})),
};

// Replacer functions: page parts contain "$" sequences that a replacement string would expand.
const parts = {
	title: escapeHtml(title),
	tokens: cssTokens(theme.colors),
	kicker: decisions.length ? `round ${round} · ${stage}` : "",
	h1: inline(title),
	lede: block(lede),
	stats: stats(),
	nav: nav.join(""),
	main,
	footer: footer(),
	data: JSON.stringify(data).replaceAll("<", "\\u003c"),
	record: source.replaceAll("</script", "<\\/script"),
	bodyClass: share ? `${status} share` : status,
};
const page = readFileSync(join(here, "page.html"), "utf8").replace(/\{\{(\w+)\}\}/g, (all, name) => {
	if (!(name in parts)) throw new Error(`page.html names an unknown part: ${all}`);
	return parts[name];
});

const target = outPath ?? join("/tmp/pages", meta.page, share ? "share.html" : "index.html");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, page);
console.log(`${target} ${page.length} bytes, ${decisions.length} decisions (${counts.decided} decided), colors: ${theme.source}`);

// ---------------------------------------------------------------- modules

function piInstall() {
	const root = join(homedir(), ".pi/agent/install");
	try {
		const version = readFileSync(join(root, "current-version"), "utf8").trim();
		const modules = join(root, "releases", version, "node_modules");
		return existsSync(modules) ? { version, modules } : undefined;
	} catch {
		return undefined;
	}
}

function findModule(name) {
	return moduleDirs.map((dir) => join(dir, name)).find((dir) => existsSync(join(dir, "package.json")));
}

// ---------------------------------------------------------------- record

function frontmatter(text) {
	const match = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) return { meta: {}, body: text };
	const meta = {};
	for (const line of match[1].split("\n")) {
		const at = line.indexOf(":");
		if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"(.*)"$/, "$1");
	}
	return { meta, body: text.slice(match[0].length) };
}

function splitSections(text) {
	const [intro, ...parts] = splitAt(text, "## ");
	const sections = parts.map((part) => {
		const end = part.indexOf("\n");
		return { title: part.slice(0, end).trim(), text: part.slice(end + 1) };
	});
	return { intro, sections };
}

// Splits before each line that starts with `marker`, but not inside a fenced code block.
function splitAt(text, marker) {
	const parts = [[]];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (/^(```|~~~)/.test(line)) fenced = !fenced;
		if (!fenced && line.startsWith(marker)) parts.push([line.slice(marker.length)]);
		else parts.at(-1).push(line);
	}
	return parts.map((lines) => lines.join("\n"));
}

// "### 3 · How you answer · your call", then the tension, the options and the reason for the plan.
// A decided card adds "Answer: <letter or own>", the user's words as a quote, then the follow-up.
function parseDecision(chunk) {
	const end = chunk.indexOf("\n");
	const head = chunk.slice(0, end).trim();
	const match = head.match(/^(\d+) · (.+?) · (your call|my call)$/);
	if (!match) throw new Error(`Bad decision heading: "### ${head}". Write "### <n> · <title> · your call" or "· my call"`);
	const decision = { n: Number(match[1]), title: match[2], whose: match[3] === "your call" ? "you" : "me", options: [] };
	const text = { tension: [], why: [], receipt: [], after: [] };
	let part = "tension";
	for (const line of chunk.slice(end + 1).split("\n")) {
		const option = part !== "receipt" && part !== "after" && line.match(/^- ([a-z]) · (.+?)(?: · (plan))?\s*$/);
		if (option) {
			decision.options.push({ key: option[1], label: option[2], plan: Boolean(option[3]), gains: [], costs: [] });
			part = "options";
			continue;
		}
		const answer = line.match(/^Answer: ([a-z]|own)(?: · (.+?))?\s*$/);
		if (answer) {
			decision.answer = answer[1] === "own" ? null : answer[1];
			decision.own = answer[1] === "own" ? answer[2] : undefined;
			part = "receipt";
			continue;
		}
		if (part === "options") {
			const gain = line.match(/^\s+\+ (.*)$/);
			const cost = line.match(/^\s+- (.*)$/);
			if (gain) decision.options.at(-1).gains.push(gain[1]);
			else if (cost) decision.options.at(-1).costs.push(cost[1]);
			else if (line.trim() !== "") part = "why";
			if (part === "options") continue;
		}
		if (part === "receipt" && line.trim() !== "" && !line.startsWith(">")) part = "after";
		text[part].push(line);
	}
	const planned = decision.options.filter((option) => option.plan);
	if (planned.length !== 1) {
		throw new Error(
			`Decision ${decision.n} has ${planned.length} plan options, it needs 1. Write each option on its own line as "- a · **label**", and end one of them with " · plan"`,
		);
	}
	const decided = "answer" in decision;
	if (decided && decision.answer && !decision.options.some((option) => option.key === decision.answer)) {
		throw new Error(`Decision ${decision.n} answers "${decision.answer}", which is not an option`);
	}
	if (decided && !text.receipt.join("").trim()) {
		throw new Error(`Decision ${decision.n} has an answer but not the user's words. Under "Answer:", quote them: > "words" (you, 10-25 13:27)`);
	}
	if (decided && decision.answer === null) decision.own ??= text.receipt.join("\n").match(/"([^"]+)"/)?.[1];
	const joined = Object.fromEntries(Object.entries(text).map(([name, lines]) => [name, lines.join("\n")]));
	return { ...decision, ...joined, decided, plan: planned[0].key };
}

// ---------------------------------------------------------------- page parts

function renderDecisions() {
	const card = (decision) => {
		const options = decision.options
			.map(
				(option) => `<button class="opt" data-k="${option.key}"><span class="key">${option.key}</span><span class="body">
<span class="label">${inline(option.label)}${option.plan ? ' <i class="planbadge">plan</i>' : ""}</span>
${option.gains.map((gain) => `<span class="gain">${inline(gain)}</span>`).join("")}
${option.costs.map((cost) => `<span class="cost">${inline(cost)}</span>`).join("")}</span></button>`,
			)
			.join("");
		const head = `<span class="num">${decision.n}</span><span class="dtitle">${inline(decision.title)}</span><span class="whose ${decision.whose}">${decision.whose === "you" ? "your call" : "my call"}</span>`;
		const inner = `<div class="tension">${block(decision.tension)}</div><div class="opts">${options}</div>
${decision.why.trim() ? `<div class="why">${block(decision.why)}</div>` : ""}
<div class="acts"><textarea rows="2" placeholder="${decision.decided ? "Your words: a correction" : "Your words: a note on your pick, or your own answer"}"></textarea>
<label class="ask"><input type="checkbox"> Explain this first <code>?${decision.n}</code></label></div>`;
		const label = (key) => plainText(decision.options.find((option) => option.key === key).label);
		if (decision.decided) {
			const chosen = decision.answer ? label(decision.answer) : (decision.own ?? "your own answer");
			return `<article class="dec decided" id="d-${decision.n}" data-n="${decision.n}"><header>${head}</header>
<p class="decidedline">decided: <b>${escapeHtml(chosen)}</b></p><div class="receipt">${block(decision.receipt)}</div>
${decision.after.trim() ? `<div class="after">${block(decision.after)}</div>` : ""}
<details class="more"><summary>The options and the reasons</summary>${inner}</details></article>`;
		}
		return decision.whose === "you"
			? `<article class="dec" id="d-${decision.n}" data-n="${decision.n}"><header>${head}</header>${inner}</article>`
			: `<details class="dec mine" id="d-${decision.n}" data-n="${decision.n}"><summary>${head}<span class="planline">plan: ${escapeHtml(label(decision.plan))}</span></summary>${inner}</details>`;
	};
	const hint = {
		open: "Your calls start empty: only you can answer them. My calls are set to my plan; open one to change it. Any card takes your own words, or a request to explain it first.",
		readback: "Every call has an answer. Each card shows your words. To correct one, open it and pick another option, or write your words.",
		contract: "What we agreed, with your words.",
	}[status];
	const group = (whose, name) => {
		const cards = decisions.filter((decision) => decision.whose === whose).map(card).join("\n");
		return cards ? `<h3 class="group">${name}</h3>${cards}` : "";
	};
	return `<p class="hint">${hint}</p>${group("you", "Your calls")}${group("me", "My calls")}`;
}

// "{?3}" in any text becomes a live blank: the answer to decision 3, or its plan while it is open.
function fillBlanks(html) {
	return html.replace(/\{\?(\d+)\}/g, (all, n) => {
		const decision = byNumber.get(Number(n));
		if (!decision) throw new Error(`Blank {?${n}} names no decision`);
		const key = decision.decided ? decision.answer : decision.plan;
		const shown = key ? plainText(decision.options.find((option) => option.key === key).label) : (decision.own ?? "your own answer");
		return `<a class="blank" href="#d-${n}" data-n="${n}"><b>${escapeHtml(shown)}</b><sup>${n}</sup></a>`;
	});
}

function renderCode({ text, lang }) {
	const language = (lang ?? "").trim().split(/\s+/)[0];
	if (language === "mermaid") return diagram(text);
	if (language === "diff") {
		const lines = text.split("\n").map((line) => {
			const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
			return `<span class="${kind}">${escapeHtml(line)}</span>`;
		});
		return `<pre class="code diff"><code>${lines.join("\n")}</code></pre>`;
	}
	const colored = hljs && language && hljs.getLanguage(language);
	return `<pre class="code"><code>${colored ? hljs.highlight(text, { language }).value : escapeHtml(text)}</code></pre>`;
}

function diagram(text) {
	// Pele draws 12 px text. Draw it 30% larger; a phone scrolls a wide diagram sideways.
	const svg = renderMermaid(text, { padding: 12 });
	const sized = svg.replace(/^<svg[^>]*>/, (open) =>
		open.replace(/ (width|height)="([\d.]+)"/g, (all, name, value) => ` ${name}="${Math.round(value * 1.3)}"`),
	);
	return `<figure class="fig">${sized}</figure>`;
}

function stats() {
	const items =
		status === "open"
			? [
					[counts.you, "your calls"],
					[counts.me, "my calls"],
				]
			: [[counts.decided, status === "contract" ? "decisions agreed" : "decisions answered"]];
	return items.map(([value, label]) => `<span><b>${value}</b> ${label}</span>`).join("");
}

function footer() {
	const short = (path) => path.replace(homedir(), "~");
	return `Built by <code>${escapeHtml(short(join(here, "render.mjs")))}</code> from <code>${escapeHtml(short(resolve(recordPath)))}</code>. Colors: ${escapeHtml(theme.source)}. The source is inside this page: <code>#page-source</code>.`;
}

// ---------------------------------------------------------------- colors

async function loadTheme() {
	let terminal;
	try {
		terminal = ghosttyColors();
	} catch (error) {
		console.error(`No terminal colors (${error.message})`);
	}
	if (terminal && pi) {
		try {
			const generator = join(pi.modules, "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/system-theme.js");
			const { generateSystemThemeColors } = await import(pathToFileURL(generator).href);
			const { colors } = generateSystemThemeColors({
				name: terminal.name,
				background: rgb(terminal.background),
				foreground: rgb(terminal.foreground),
				palette: terminal.palette.map(rgb),
			});
			return {
				source: `Pi ${pi.version} system theme, from Ghostty ${terminal.name}`,
				colors: { ...colors, bg: terminal.background, fg: terminal.foreground },
			};
		} catch (error) {
			console.error(`Pi theme not available (${error.message})`);
		}
	}
	if (terminal) return { source: `terminal theme, Ghostty ${terminal.name}`, colors: terminalTokens(terminal) };
	return { source: "saved colors", colors: JSON.parse(readFileSync(join(here, "saved-colors.json"), "utf8")) };
}

// Ghostty's own values; `+show-config` omits the defaults, so read those from `--default` first.
function ghosttyColors() {
	const values = { ...showConfig(["--default"]), ...showConfig([]) };
	const palette = Array.from({ length: 16 }, (_, index) => values[`palette ${index}`]);
	for (const color of [values.background, values.foreground, ...palette]) rgb(color);
	return { name: values.theme || "default", background: values.background, foreground: values.foreground, palette };
}

function showConfig(extra) {
	const values = {};
	for (const line of execFileSync("ghostty", ["+show-config", ...extra], { encoding: "utf8" }).split("\n")) {
		const match = line.match(/^([a-z-]+) = (.*)$/);
		if (!match) continue;
		const palette = match[1] === "palette" && match[2].match(/^(\d+)=(#[0-9a-f]{6})$/i);
		if (palette) values[`palette ${palette[1]}`] = palette[2];
		else values[match[1]] = match[2];
	}
	return values;
}

// The terminal theme without Pi: the same token names, taken from the color numbers.
function terminalTokens({ background: bg, foreground: fg, palette: p }) {
	const mix = (a, b, share) => {
		const [x, y] = [rgb(a), rgb(b)];
		const channel = (key) => Math.round(x[key] * share + y[key] * (1 - share)).toString(16).padStart(2, "0");
		return `#${channel("r")}${channel("g")}${channel("b")}`;
	};
	return {
		bg,
		fg,
		text: fg,
		accent: p[4],
		success: p[2],
		warning: p[3],
		error: p[1],
		muted: mix(fg, bg, 0.65),
		dim: mix(fg, bg, 0.5),
		border: p[4],
		borderMuted: mix(fg, bg, 0.35),
		selectedBg: mix(p[4], bg, 0.25),
		userMessageBg: mix(p[4], bg, 0.2),
		toolPendingBg: mix(fg, bg, 0.07),
		toolSuccessBg: mix(p[2], bg, 0.16),
		mdHeading: p[3],
		mdLink: p[12],
		mdCode: p[6],
		mdCodeBlockBorder: mix(fg, bg, 0.25),
		mdListBullet: p[4],
		syntaxKeyword: p[5],
		syntaxString: p[2],
		syntaxComment: mix(fg, bg, 0.5),
		syntaxNumber: p[3],
		syntaxFunction: p[4],
		syntaxType: p[6],
		syntaxVariable: fg,
		syntaxPunctuation: mix(fg, bg, 0.65),
		toolDiffAdded: p[2],
		toolDiffRemoved: p[1],
		toolDiffContext: mix(fg, bg, 0.65),
	};
}

function rgb(hex) {
	if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) throw new Error(`not a color: ${hex}`);
	return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

// Tokens -> CSS variables. An empty Pi token means the terminal's own foreground.
function cssTokens(colors) {
	return Object.entries(colors)
		.map(([name, value]) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value || colors.fg};`)
		.join("");
}

// ---------------------------------------------------------------- text helpers

function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Vault wikilinks have no target on a page: keep their label.
function unlink(text) {
	return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, target, label) => label ?? target.split("/").at(-1));
}

function plainText(markdown) {
	return markdown.replace(/[*_`]/g, "").replace(/\s*\(.*?\)\s*$/, "").trim();
}

function slug(text) {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
