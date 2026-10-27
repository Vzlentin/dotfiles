#!/usr/bin/env node
// Renders one Mermaid diagram to SVG with Pele, from the global npm install.
// Usage: mermaid.mjs [--page] <diagram.mmd> <diagram.svg>
// --page: an SVG for an artifacts page. It takes the page colors and draws its text 30% larger.
// Other scripts import renderMermaid() from this file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
const peleDir = join(prefix, "lib", "node_modules", "pele");
const entry = join(peleDir, "dist", "pele.js");
const pele = existsSync(entry) ? await import(pathToFileURL(entry).href) : undefined;

// Pele's colors, mapped to the CSS variables of an artifacts page.
const PAGE_COLORS = [
	"--pele-bg:transparent",
	"--pele-fg:var(--text)",
	"--pele-muted:var(--muted)",
	"--pele-line:var(--border-muted)",
	"--pele-surface:var(--card)",
	"--pele-surface-alt:var(--selected-bg)",
	"--pele-border:var(--border)",
	"--pele-accent:var(--accent)",
	"--pele-error:var(--error)",
	"--pele-critical:var(--error)",
	"--pele-font:var(--sans)",
	"--pele-font-mono:var(--mono)",
	"--pele-radius:8px",
].join(";");

// A Mermaid parse error throws: the source is wrong.
export function renderMermaid(source, { padding = 16, page = false } = {}) {
	if (!pele) throw new Error(`pele not found at ${peleDir}: npm install -g pele`);
	const { svg } = pele.render(source, { padding: page ? 12 : padding });
	// Pele leaves the background transparent, which is unreadable in GitHub's dark theme.
	// --_bg is --pele-bg: white on its own, the page color inside a page.
	const opened = svg.indexOf(">") + 1;
	const open = page ? forPage(svg.slice(0, opened)) : svg.slice(0, opened);
	return `${open}<rect width="100%" height="100%" fill="var(--_bg)"/>${svg.slice(opened)}`;
}

// Pele draws 12 px text: draw it 30% larger. A phone scrolls a wide diagram sideways.
function forPage(open) {
	return open
		.replace(/ (width|height)="([\d.]+)"/g, (all, name, value) => ` ${name}="${Math.round(value * 1.3)}"`)
		.replace(/ style="/, ` style="${PAGE_COLORS};`);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const page = args.includes("--page");
	const [input, output] = args.filter((arg) => arg !== "--page");
	if (!input || !output) {
		console.error("usage: mermaid.mjs [--page] <diagram.mmd> <diagram.svg>");
		process.exit(2);
	}
	writeFileSync(output, renderMermaid(readFileSync(input, "utf8"), { page }));
	console.log(output);
}
