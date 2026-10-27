#!/usr/bin/env node
// Renders one Mermaid diagram to SVG with Pele, from the global npm install.
// Usage: mermaid.mjs <diagram.mmd> <diagram.svg>
// Other scripts import renderMermaid() from this file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
const peleDir = join(prefix, "lib", "node_modules", "pele");
const entry = join(peleDir, "dist", "pele.js");
const pele = existsSync(entry) ? await import(pathToFileURL(entry).href) : undefined;

// A Mermaid parse error throws: the source is wrong.
export function renderMermaid(source, { padding = 16 } = {}) {
	if (!pele) throw new Error(`pele not found at ${peleDir}: npm install -g pele`);
	const { svg } = pele.render(source, { padding });
	// Pele leaves the background transparent, which is unreadable in GitHub's dark theme.
	// --_bg is --pele-bg: white on its own, the page color inside a page.
	const opened = svg.indexOf(">") + 1;
	return `${svg.slice(0, opened)}<rect width="100%" height="100%" fill="var(--_bg)"/>${svg.slice(opened)}`;
}

if (import.meta.main) {
	const [input, output] = process.argv.slice(2);
	if (!input || !output) {
		console.error("usage: mermaid.mjs <diagram.mmd> <diagram.svg>");
		process.exit(2);
	}
	writeFileSync(output, renderMermaid(readFileSync(input, "utf8")));
	console.log(output);
}
