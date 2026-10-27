#!/usr/bin/env node
// Builds the page of a parley: the page source that you write, with the decision cards of the record.
// Usage: page.mjs [--share] <record.md> <page.md> [out.html]
// The record is the contract. The page source is Markdown and HTML that you lay out for the topic:
// - {{cards}} is where the decision cards go.
// - {?3} is a blank: the answer to decision 3, or its plan while it is open.
// A live page ends with the bar of the way back. The page itself comes from artifacts, diagrams from show-me.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdown, escapeHtml, frontmatter, plainText, renderPage } from "../artifacts/render.mjs";
import { renderMermaid } from "../show-me/mermaid.mjs";

const here = dirname(fileURLToPath(import.meta.url));
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

const decisions = splitAt(splitSections(body).sections.find((section) => section.title === "Decisions")?.text ?? "", "### ")
	.slice(1)
	.map(parseDecision);
const byNumber = new Map(decisions.map((decision) => [decision.n, decision]));
const recordMarkdown = createMarkdown({ base: dirname(resolve(recordPath)), code: drawDiagram });
const block = (text) => fillBlanks(recordMarkdown.markdown(text));
const inline = (text) => fillBlanks(recordMarkdown.inline(text));

const source = readFileSync(pagePath, "utf8");
const pageBody = frontmatter(source).body;
const CARDS = /(?:<p>)?\{\{cards\}\}(?:<\/p>)?/;
const pageHtml = fillBlanks(createMarkdown({ base: dirname(resolve(pagePath)), code: drawDiagram }).markdown(pageBody));
if (!CARDS.test(pageHtml)) throw new Error("The page source has no {{cards}}: write it where the decision cards go");
const title = plainText(pageBody.match(/^# (.+)$/m)?.[1] ?? meta.title ?? meta.page);

const data = {
	slug: meta.page,
	round,
	status,
	decisions: decisions.map(({ n, whose, plan, decided, answer, labels, shown }) => ({ n, whose, plan, decided, answer, labels, shown })),
};

const html = `<div class="parley ${status}">
${pageHtml.replace(CARDS, () => renderDecisions())}
${live ? bar() : ""}
</div>
<style>${readFileSync(join(here, "cards.css"), "utf8")}</style>
${live ? `<script type="application/json" id="parley-data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>\n<script>${readFileSync(join(here, "cards.js"), "utf8")}</script>` : ""}`;

const page = await renderPage({ slug: meta.page, title, body: html, source, sourcePath: pagePath, share, alpine: live, out: outPath });
const decided = decisions.filter((decision) => decision.decided).length;
console.log(`${page.target} ${page.bytes} bytes, ${decisions.length} decisions (${decided} decided), colors: ${page.colors}`);

// ---------------------------------------------------------------- record

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
	const labels = Object.fromEntries(decision.options.map((option) => [option.key, label(option.label)]));
	const plan = planned[0].key;
	// What the card and its blanks show before the user picks: the answer, or the plan while the decision is open.
	const shown = !decided ? labels[plan] : decision.answer ? labels[decision.answer] : (decision.own ?? "your own answer");
	return { ...decision, ...joined, decided, plan, labels, shown };
}

// ---------------------------------------------------------------- page parts

// A Mermaid block in the record becomes the SVG of show-me, in the page colors.
function drawDiagram({ text, lang }) {
	if ((lang ?? "").trim().split(/\s+/)[0] === "mermaid") return `<figure class="fig">${renderMermaid(text, { page: true })}</figure>\n`;
}

// Each Alpine attribute only on a live page: the contract and the share copy stay plain HTML.
function on(attributes) {
	return live ? ` ${attributes}` : "";
}

// The class of a part that shows the state of a card. On a live page Alpine owns that state: it sets
// `bound`, and the page writes no `fixed` class, because Alpine never removes a class that the HTML gives.
function classes(base, fixed, bound) {
	return live ? `class="${base}" :class="${bound}"` : `class="${[base, fixed].filter(Boolean).join(" ")}"`;
}

function renderDecisions() {
	const card = (decision) => {
		const n = decision.n;
		const options = decision.options
			.map(
				(option) => `<button ${classes("opt", decision.decided && option.key === decision.answer ? "sel" : "", `$store.parley.s(${n}).k === '${option.key}' && 'sel'`)}${on(`@click.prevent="$store.parley.pick(${n}, '${option.key}')"`)}><span class="key">${option.key}</span><span class="body">
<span class="label">${inline(option.label)}${option.plan ? ' <i class="planbadge">plan</i>' : ""}</span>
${option.gains.map((gain) => `<span class="gain">${inline(gain)}</span>`).join("")}
${option.costs.map((cost) => `<span class="cost">${inline(cost)}</span>`).join("")}</span></button>`,
			)
			.join("");
		const head = `<span class="num">${n}</span><span class="dtitle">${inline(decision.title)}</span><span class="whose ${decision.whose}">${decision.whose === "you" ? "your call" : "my call"}</span>`;
		const acts = live
			? `<div class="acts"><textarea rows="2" placeholder="${decision.decided ? "Your words: a correction" : "Your words: a note on your pick, or your own answer"}" x-model="$store.parley.s(${n}).note"></textarea>
<label class="ask"><input type="checkbox" x-model="$store.parley.s(${n}).ask"> Explain this first <code>?${n}</code></label></div>`
			: "";
		const inner = `<div class="tension">${block(decision.tension)}</div><div class="opts">${options}</div>
${decision.why.trim() ? `<div class="why">${block(decision.why)}</div>` : ""}${acts}`;
		const state = on(`x-data :class="{ asked: $store.parley.s(${n}).ask, changed: $store.parley.changed(${n}) }"`);
		if (decision.decided) {
			return `<article class="dec decided" id="d-${n}"${state}><header>${head}</header>
<p class="decidedline">decided: <b>${escapeHtml(decision.shown)}</b></p><div class="receipt">${block(decision.receipt)}</div>
${decision.after.trim() ? `<div class="after">${block(decision.after)}</div>` : ""}
<details class="more"><summary>The options and the reasons</summary>${inner}</details></article>`;
		}
		return decision.whose === "you"
			? `<article class="dec" id="d-${n}"${state}><header>${head}</header>${inner}</article>`
			: `<details class="dec mine" id="d-${n}"${state}><summary>${head}<span class="planline">plan: ${escapeHtml(decision.labels[decision.plan])}</span></summary>${inner}</details>`;
	};
	const hint = {
		open: "Your calls start empty: only you can answer them. My calls are set to my plan; open one to change it. Any card takes your own words, or a request to explain it first.",
		readback: "Every call has an answer. Each card shows your words. To correct one, open it and pick another option, or write your words.",
		contract: "What we agreed, with your words.",
	}[status];
	const group = (whose, name) => {
		const cards = decisions.filter((decision) => decision.whose === whose).map(card).join("\n");
		return cards ? `<h3 class="group">${name}</h3><div class="cards">${cards}</div>` : "";
	};
	return `<p class="hint">${hint}</p>${group("you", "Your calls")}${group("me", "My calls")}`;
}

// "{?3}" in any text becomes a blank: the answer to decision 3, or its plan while it is open.
function fillBlanks(html) {
	return html.replace(/\{\?(\d+)\}/g, (all, n) => {
		const decision = byNumber.get(Number(n));
		if (!decision) throw new Error(`Blank {?${n}} names no decision`);
		const kind = decision.decided ? (decision.answer ? "set" : "own") : "plan";
		return `<a ${classes("blank", kind, `$store.parley.blank(${n})`)} href="#d-${n}"${on("x-data")}><b${on(`x-text="$store.parley.shown(${n})"`)}>${escapeHtml(decision.shown)}</b><sup>${n}</sup></a>`;
	});
}

// The bar of the way back of artifacts, with the state of the cards and a Reset.
function bar() {
	return `<div class="bar dock" x-data>
  <div class="meta"><span><span :class="$store.parley.head.state" x-text="$store.parley.head.text"></span><span x-show="$store.parley.asks" x-text="' · ' + $store.parley.asks + ' to explain'"></span></span><div class="dots"><template x-for="d in $store.parley.P.decisions" :key="d.n"><i :class="$store.parley.s(d.n).ask ? 'ask' : $store.parley.kind(d)" :title="d.n" @click="$store.parley.go(d.n)"></i></template></div></div>
  <div class="line" x-text="$store.back.text"></div>
  <div class="btns"><button @click="$store.parley.reset()">Reset</button><button class="primary" x-show="typeof sendPrompt === 'function'" x-cloak @click="sendPrompt($store.back.text)">Send</button><button class="primary" @click="$store.back.copy()">Copy</button></div>
</div>`;
}

// ---------------------------------------------------------------- text helpers

// A label for a blank, a button or a title: plain text, with no closing "(...)".
function label(markdown) {
	return plainText(markdown).replace(/\s*\(.*?\)\s*$/, "");
}
