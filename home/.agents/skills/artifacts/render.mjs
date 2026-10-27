#!/usr/bin/env node
// Builds one self-contained HTML page: the theme, the base shell, and Alpine when the page uses it.
// Usage: render.mjs [--share] <source.md> [out.html]
//        render.mjs --theme
// The page goes to /tmp/pages/<slug>/index.html by default: build output stays out of the vault.
// --share: a light copy for other people and for print. --theme: the colors as CSS variables.
// Other scripts import createMarkdown() and renderPage() from this file.
// A page gets Alpine when its body has an Alpine attribute.
//
// It uses what is already on the machine, first from the Pi install, then from the global npm prefix:
// - Markdown and code colors: marked and highlight.js
// - colors: Pi's `system` theme computed from the Ghostty colors (as herdr-pi-theme does).
//   Without Pi: the terminal theme (Ghostty colors, mapped by color number). Without both: saved colors.
// PAGES_NO_PI=1 renders as if Pi were not installed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// A light page: the colors of a terminal with a white background.
const LIGHT = {
	name: "light",
	background: "#ffffff",
	foreground: "#1b1f24",
	palette: ["#1b1f24", "#b42318", "#2e7d32", "#8a5a00", "#0055a5", "#7b1fa2", "#00796b", "#5f6b7a", "#5f6b7a", "#d92d20", "#43a047", "#a66f00", "#1565c0", "#8e24aa", "#00897b", "#1b1f24"],
};
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
// An Alpine attribute with a plain quote. In a code block the quote is escaped, so a code sample does not count.
const ALPINE_ATTRIBUTE = /\s(x-[a-z][\w:.-]*|@[a-z][\w:.-]*|:[a-z][\w-]*)="/;

const pi = process.env.PAGES_NO_PI === "1" ? undefined : piInstall();
const npmModules = join(execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim(), "lib/node_modules");
const moduleDirs = [pi?.modules, npmModules].filter(Boolean);
const markedDir = findModule("marked");
if (!markedDir) throw new Error("marked not found in Pi or in the global npm prefix: npm install -g marked");
const { Marked } = await import(pathToFileURL(join(markedDir, "lib/marked.esm.js")).href);
const hljsDir = findModule("highlight.js");
const hljs = hljsDir ? createRequire(import.meta.url)(hljsDir) : undefined;

// base: the directory that local images resolve from, the directory of the source.
// code: a renderer for a code block. It returns HTML, or undefined to leave the block to this file.
// extensions: marked extensions, for the syntax of a script that builds on this file.
export function createMarkdown({ base, code, extensions = [] }) {
	const md = new Marked({ gfm: true });
	md.use({
		extensions,
		renderer: {
			code: (token) => code?.(token) ?? renderCode(token),
			heading: renderHeading,
			image: (token) => renderImage(token, base),
			paragraph: renderParagraph,
		},
	});
	return {
		markdown: (text) => md.parse(unlink(text)).replaceAll("<table>", '<div class="tw"><table>').replaceAll("</table>", "</table></div>"),
		inline: (text) => md.parseInline(unlink(text)),
	};
}

export function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// body is HTML. source is the text that the page carries inside, so any copy of the page gives it back.
// key: the name of the state that the browser keeps for the page. Another key starts from the defaults.
export async function renderPage({ slug, key = slug, title, body, source, sourcePath, share = false, out }) {
	const theme = share ? { source: "light", colors: terminalTokens(LIGHT) } : await loadTheme();
	const interactive = ALPINE_ATTRIBUTE.test(body);
	const vendor = (name) => readFileSync(join(here, name), "utf8");
	const parts = {
		title: escapeHtml(title),
		slug: escapeHtml(slug),
		key: escapeHtml(key),
		tokens: cssTokens(theme.colors),
		// Alpine starts when its own script runs: the plugin and the store of the way back come first, the page last.
		head: interactive ? `<script>${vendor("vendor/alpine-persist.min.js")}</script>\n<script>${vendor("back.js")}</script>` : "",
		alpine: interactive ? `<script>${vendor("vendor/alpine.min.js")}</script>` : "",
		body,
		footer: footer(sourcePath, theme.source),
		source: (source ?? "").replaceAll("</script", "<\\/script"),
		bodyClass: share ? "share" : "",
	};
	// A replacer function: page parts contain "$" sequences that a replacement string would expand.
	const page = vendor("shell.html").replace(/\{\{(\w+)\}\}/g, (all, name) => {
		if (!(name in parts)) throw new Error(`shell.html names an unknown part: ${all}`);
		return parts[name];
	});
	const target = out ?? join("/tmp/pages", slug, share ? "share.html" : "index.html");
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, page);
	return { target, bytes: page.length, colors: theme.source, interactive };
}

export function frontmatter(text) {
	const match = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) return { meta: {}, body: text };
	const meta = {};
	for (const line of match[1].split("\n")) {
		const at = line.indexOf(":");
		if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"(.*)"$/, "$1");
	}
	return { meta, body: text.slice(match[0].length) };
}

// Markdown to plain text: the emphasis and code marks go.
export function plainText(markdown) {
	return markdown.replace(/[*_`]/g, "").trim();
}

export function slug(text) {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

if (import.meta.main) {
	const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
	const [sourcePath, out] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
	if (flags.has("--theme")) {
		const theme = await loadTheme();
		console.log(`:root{${cssTokens(theme.colors)}}`);
		process.exit(0);
	}
	if (!sourcePath) {
		console.error("usage: render.mjs [--share] <source.md> [out.html] | render.mjs --theme");
		process.exit(2);
	}
	const source = readFileSync(sourcePath, "utf8");
	const { meta, body } = frontmatter(source);
	if (!meta.page) throw new Error("The source needs a `page:` slug in its frontmatter");
	const { markdown } = createMarkdown({ base: dirname(resolve(sourcePath)) });
	const title = plainText(body.match(/^# (.+)$/m)?.[1] ?? meta.title ?? meta.page);
	const page = await renderPage({ slug: meta.page, title, body: markdown(body), source, sourcePath, share: flags.has("--share"), out });
	console.log(`${page.target} ${page.bytes} bytes, ${page.interactive ? "Alpine" : "no Alpine"}, colors: ${page.colors}`);
}

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

// ---------------------------------------------------------------- markdown

function renderCode({ text, lang }) {
	const language = (lang ?? "").trim().split(/\s+/)[0];
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

function renderHeading({ tokens, depth, text }) {
	return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
}

// A local SVG goes into the page as it is, so it takes the page colors. Other local images become data URLs.
function renderImage({ href, text }, base) {
	if (/^[a-z]+:/i.test(href)) return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">`;
	const path = resolve(base, href.replace(/^~(?=\/)/, homedir()));
	const type = extname(path).toLowerCase();
	if (type === ".svg") return `<figure class="fig" role="img" aria-label="${escapeHtml(text)}">${readFileSync(path, "utf8")}</figure>`;
	if (!IMAGE_TYPES[type]) throw new Error(`Unknown image type: ${href}`);
	return `<img src="data:${IMAGE_TYPES[type]};base64,${readFileSync(path).toString("base64")}" alt="${escapeHtml(text)}">`;
}

// An image alone in its paragraph is a figure, not text.
function renderParagraph({ tokens }) {
	const body = this.parser.parseInline(tokens);
	return tokens.length === 1 && tokens[0].type === "image" ? `${body}\n` : `<p>${body}</p>\n`;
}

// Vault wikilinks have no target on a page: keep their label.
function unlink(text) {
	return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, target, label) => label ?? target.split("/").at(-1));
}

function footer(sourcePath, colors) {
	const short = (path) => path.replace(homedir(), "~");
	const from = sourcePath ? ` from <code>${escapeHtml(short(resolve(sourcePath)))}</code>` : "";
	return `Built by <code>${escapeHtml(short(join(here, "render.mjs")))}</code>${from}. Colors: ${escapeHtml(colors)}. The source is inside this page: <code>#page-source</code>.`;
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
