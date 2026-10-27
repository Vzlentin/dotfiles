#!/usr/bin/env node
// Builds the page of a parley: the page source that you write, with the decision cards of the record.
// Usage: page.mjs [--share] <record.md> <page.md> [out.html]
// The record is the contract. The page source is Markdown and HTML that you lay out for the topic:
// - {{cards}} is where the decision cards go: a line of its own, with a blank line before and after it.
// - {?3} is a blank: the answer to decision 3, or its plan while it is open.
// A live page ends with the bar of the way back. The page itself comes from artifacts, diagrams from show-me.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdown, escapeHtml, frontmatter, plainText, renderPage } from "../artifacts/render.mjs";
import { renderMermaid } from "../show-me/mermaid.mjs";
import { blankKind, blankText, freshCard } from "./state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The lines of a decision in the record.
const HEADING = /^(\d+) · (.+?) · (your|my) call$/;
const OPTION = /^- ([a-z]) · (.+?)(?: · (plan))?\s*$/;
const GAIN = /^\s+\+ (.*)$/;
const COST = /^\s+- (.*)$/;
const ANSWER = /^Answer: ([a-z]|own)(?: · (.+?))?\s*$/;

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const [recordPath, pagePath, outPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const share = flags.has("--share");
if (!pagePath) {
	console.error("usage: page.mjs [--share] <record.md> <page.md> [out.html]");
	process.exit(2);
}

const { meta, body } = frontmatter(readFileSync(recordPath, "utf8"));
if (!meta.page) throw new Error("The record needs a `page:` slug in its frontmatter");
const status = meta.status ?? "open";
if (!["open", "readback", "contract"].includes(status)) throw new Error(`Unknown status: ${status}`);
// The contract and the share copy are read, not answered: they have no interactive part.
const live = status !== "contract" && !share;
const round = Number(meta.round ?? 1);

const decisionsText = splitAt(body, "## ").find((section) => section.startsWith("Decisions\n")) ?? "";
const decisions = splitAt(decisionsText, "### ").slice(1).map(parseDecision);
const byNumber = new Map(decisions.map((decision) => [decision.n, decision]));
const recordMarkdown = createMarkdown({ base: dirname(resolve(recordPath)), code: drawDiagram });
const block = recordMarkdown.markdown;
const inline = recordMarkdown.inline;

const source = readFileSync(pagePath, "utf8");
const pageBody = frontmatter(source).body;
let cardsWritten = 0;
const cards = {
	name: "cards",
	level: "block",
	tokenizer(src) {
		const match = src.match(/^\{\{cards\}\}[ \t]*(?:\n|$)/);
		return match ? { type: "cards", raw: match[0] } : undefined;
	},
	renderer() {
		cardsWritten++;
		return renderDecisions();
	},
};
// The cards are a part of the page, so this one pass fills the blanks of the page and of the cards.
const pageHtml = fillBlanks(createMarkdown({ base: dirname(resolve(pagePath)), code: drawDiagram, extensions: [cards] }).markdown(pageBody));
if (cardsWritten !== 1) {
	throw new Error(`The page source has ${cardsWritten} {{cards}} lines, it needs 1: write it alone on its line, with a blank line before and after it`);
}
const title = plainText(pageBody.match(/^# (.+)$/m)?.[1] ?? meta.title ?? meta.page);

const data = {
	slug: meta.page,
	round,
	status,
	decisions: decisions.map(({ n, whose, plan, decided, answer, labels, shown }) => ({ n, whose, plan, decided, answer, labels, shown })),
};
const script = () => {
	// The page has no modules: each `export function` of state.mjs becomes a plain function.
	const state = readFileSync(join(here, "state.mjs"), "utf8").replace(/^export function /gm, "function ");
	if (/^export\b/m.test(state)) throw new Error("state.mjs can export only with `export function`");
	return `<script type="application/json" id="parley-data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>
<script>(() => {
${state}
${readFileSync(join(here, "cards.js"), "utf8")}
})();</script>`;
};

const html = `<div class="parley ${status}">
${pageHtml}
${live ? bar() : ""}
</div>
<style>${readFileSync(join(here, "cards.css"), "utf8")}</style>
${live ? script() : ""}`;

// One saved state for each round: a new round starts from the record.
const page = await renderPage({ slug: meta.page, key: `${meta.page} r${round}`, title, body: html, source, sourcePath: pagePath, share, out: outPath });
const decided = decisions.filter((decision) => decision.decided).length;
console.log(`${page.target} ${page.bytes} bytes, ${decisions.length} decisions (${decided} decided), colors: ${page.colors}`);

// ---------------------------------------------------------------- record

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

// A decision, in this order:
// - "### 3 · How you answer · your call"
// - the tension, the options with their gains and costs, and the reason for the plan
// - on a decided card: "Answer: <letter or own>", the user's words as a quote, then the follow-up
function parseDecision(chunk) {
	const [heading, ...lines] = chunk.split("\n");
	const match = heading.trim().match(HEADING);
	if (!match) throw new Error(`Bad decision heading: "### ${heading.trim()}". Write "### <n> · <title> · your call" or "· my call"`);
	const n = Number(match[1]);

	const answerAt = lines.findIndex((line) => ANSWER.test(line));
	const card = answerAt < 0 ? lines : lines.slice(0, answerAt);
	const optionsAt = indexFrom(card, 0, (line) => OPTION.test(line));
	const whyAt = indexFrom(card, optionsAt, (line) => line.trim() !== "" && ![OPTION, GAIN, COST].some((pattern) => pattern.test(line)));
	const options = parseOptions(card.slice(optionsAt, whyAt));

	const answer = answerAt < 0 ? undefined : lines[answerAt].match(ANSWER);
	const rest = answerAt < 0 ? [] : lines.slice(answerAt + 1);
	const afterAt = indexFrom(rest, 0, (line) => line.trim() !== "" && !line.startsWith(">"));
	const receipt = rest.slice(0, afterAt).join("\n");

	const planned = options.filter((option) => option.plan);
	if (planned.length !== 1) {
		throw new Error(`Decision ${n} has ${planned.length} plan options, it needs 1. Write each option on its own line as "- a · **label**", and end one of them with " · plan"`);
	}
	const decided = Boolean(answer);
	const picked = decided && answer[1] !== "own" ? answer[1] : null;
	if (picked && !options.some((option) => option.key === picked)) throw new Error(`Decision ${n} answers "${picked}", which is not an option`);
	if (decided && !receipt.trim()) {
		throw new Error(`Decision ${n} has an answer but not the user's words. Under "Answer:", quote them: > "words" (you, 10-25 13:27)`);
	}
	const own = decided && !picked ? (answer[2] ?? receipt.match(/"([^"]+)"/)?.[1]) : undefined;
	const labels = Object.fromEntries(options.map((option) => [option.key, label(option.label)]));
	const plan = planned[0].key;
	return {
		n,
		title: match[2],
		whose: match[3],
		options,
		tension: card.slice(0, optionsAt).join("\n"),
		why: card.slice(whyAt).join("\n"),
		decided,
		answer: decided ? picked : undefined,
		own,
		receipt,
		after: rest.slice(afterAt).join("\n"),
		plan,
		labels,
		// What the card and its blanks show before the user picks: the answer, or the plan while the decision is open.
		shown: !decided ? labels[plan] : picked ? labels[picked] : (own ?? "your own answer"),
	};
}

function parseOptions(lines) {
	const options = [];
	for (const line of lines) {
		const [option, gain, cost] = [OPTION, GAIN, COST].map((pattern) => line.match(pattern));
		if (option) options.push({ key: option[1], label: option[2], plan: Boolean(option[3]), gains: [], costs: [] });
		else if (gain) options.at(-1).gains.push(gain[1]);
		else if (cost) options.at(-1).costs.push(cost[1]);
	}
	return options;
}

// The index of the first line from `from` that passes `test`, or the length.
function indexFrom(lines, from, test) {
	const at = lines.findIndex((line, index) => index >= from && test(line));
	return at < 0 ? lines.length : at;
}

// ---------------------------------------------------------------- page parts

// A Mermaid block in the record becomes the SVG of show-me, in the page colors.
function drawDiagram({ text, lang }) {
	if ((lang ?? "").trim().split(/\s+/)[0] === "mermaid") return `<figure class="fig">${renderMermaid(text, { large: true })}</figure>\n`;
}

// Alpine attributes go only on a live page: the contract and the share copy stay plain HTML.
// The HTML always gives the state at the start. A live page binds classes as objects, so Alpine can take them away.
function on(attributes) {
	return live ? ` ${attributes}` : "";
}

function renderDecisions() {
	const hint = {
		open: "Your calls start empty: only you can answer them. My calls are set to my plan; open one to change it. Any card takes your own words, or a request to explain it first.",
		readback: "Every call has an answer. Each card shows your words. To correct one, open it and pick another option, or write your words.",
		contract: "What we agreed, with your words.",
	}[status];
	const group = (whose, name) => {
		const cards = decisions.filter((decision) => decision.whose === whose).map(renderCard).join("\n");
		return cards ? `<h3 class="group">${name}</h3><div class="cards">${cards}</div>` : "";
	};
	return `<p class="hint">${hint}</p>${group("your", "Your calls")}${group("my", "My calls")}`;
}

function renderCard(decision) {
	const n = decision.n;
	const head = `<span class="num">${n}</span><span class="dtitle">${inline(decision.title)}</span><span class="whose ${decision.whose}">${decision.whose} call</span>`;
	const why = decision.why.trim() ? `<div class="why">${block(decision.why)}</div>` : "";
	const inner = `<div class="tension">${block(decision.tension)}</div><div class="opts">${decision.options.map((option) => renderOption(decision, option)).join("")}</div>
${why}${live ? renderActs(decision) : ""}`;
	const state = on(`x-data :class="{ asked: $store.parley.card(${n}).ask, changed: $store.parley.changed(${n}) }"`);
	if (decision.decided) {
		const after = decision.after.trim() ? `<div class="after">${block(decision.after)}</div>` : "";
		return `<article class="dec decided" id="d-${n}"${state}><header>${head}</header>
<p class="decidedline">decided: <b>${escapeHtml(decision.shown)}</b></p><div class="receipt">${block(decision.receipt)}</div>
${after}
<details class="more"><summary>The options and the reasons</summary>${inner}</details></article>`;
	}
	if (decision.whose === "your") return `<article class="dec" id="d-${n}"${state}><header>${head}</header>${inner}</article>`;
	return `<details class="dec mine" id="d-${n}"${state}><summary>${head}<span class="planline">plan: ${escapeHtml(decision.labels[decision.plan])}</span></summary>${inner}</details>`;
}

function renderOption(decision, option) {
	const n = decision.n;
	const selected = freshCard(decision).pick === option.key;
	const binding = on(`:class="{ sel: $store.parley.card(${n}).pick === '${option.key}' }" @click.prevent="$store.parley.pick(${n}, '${option.key}')"`);
	const badge = option.plan ? ' <i class="planbadge">plan</i>' : "";
	return `<button class="opt${selected ? " sel" : ""}"${binding}><span class="key">${option.key}</span><span class="body">
<span class="label">${inline(option.label)}${badge}</span>
${option.gains.map((gain) => `<span class="gain">${inline(gain)}</span>`).join("")}
${option.costs.map((cost) => `<span class="cost">${inline(cost)}</span>`).join("")}</span></button>`;
}

function renderActs(decision) {
	const n = decision.n;
	const placeholder = decision.decided ? "Your words: a correction" : "Your words: a note on your pick, or your own answer";
	return `<div class="acts"><textarea rows="2" placeholder="${placeholder}" x-model="$store.back.values['${n} note']"></textarea>
<label class="ask"><input type="checkbox" x-model="$store.back.values['${n} ask']"> Explain this first <code>?${n}</code></label></div>`;
}

// "{?3}" in the text of the page becomes a blank: the answer to decision 3, or its plan while it is open.
// Tags, code, scripts, styles and SVGs keep their text.
function fillBlanks(html) {
	return html.replace(/(<(pre|code|script|style|svg)\b[\s\S]*?<\/\2>|<[^>]*>)|\{\?(\d+)\}/g, (all, kept, name, n) => kept ?? renderBlank(Number(n)));
}

function renderBlank(n) {
	const decision = byNumber.get(n);
	if (!decision) throw new Error(`Blank {?${n}} names no decision`);
	const card = freshCard(decision);
	return `<a class="blank ${blankKind(decision, card)}"${on(`:class="$store.parley.blank(${n})"`)} href="#d-${n}"${on("x-data")}><b${on(`x-text="$store.parley.shown(${n})"`)}>${escapeHtml(blankText(decision, card))}</b><sup>${n}</sup></a>`;
}

// The bar of the way back of artifacts, with the state of the cards and a Reset.
function bar() {
	return `<div class="bar dock" x-data>
  <div class="meta"><span><span :class="$store.parley.head.state" x-text="$store.parley.head.text"></span><span x-show="$store.parley.asks" x-text="' · ' + $store.parley.asks + ' to explain'"></span></span><div class="dots"><template x-for="d in $store.parley.P.decisions" :key="d.n"><i :class="$store.parley.dot(d)" :title="d.n" @click="$store.parley.go(d.n)"></i></template></div></div>
  <div class="line" x-text="$store.back.text"></div>
  <div class="btns"><button @click="confirm('Clear your answers and notes?') && $store.back.reset()">Reset</button><button class="primary" x-show="typeof sendPrompt === 'function'" x-cloak @click="sendPrompt($store.back.text)">Send</button><button class="primary" @click="$store.back.copy()">Copy</button></div>
</div>`;
}

// ---------------------------------------------------------------- text helpers

// A label for a blank, a button or a title: plain text, with no closing "(...)".
function label(markdown) {
	return plainText(markdown).replace(/\s*\(.*?\)\s*$/, "");
}
