#!/usr/bin/env node
// Renders one Mermaid diagram to SVG with Pele, from the global npm install.
// Usage: render-mermaid.mjs <diagram.mmd> <diagram.svg>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
	console.error("usage: render-mermaid.mjs <diagram.mmd> <diagram.svg>");
	process.exit(2);
}

const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
const entry = join(prefix, "lib", "node_modules", "pele", "dist", "pele.js");

if (!existsSync(entry)) {
	console.error(`pele not found at ${join(prefix, "lib", "node_modules", "pele")}`);
	console.error("install it with: npm install -g pele");
	process.exit(3);
}

const { render } = await import(pathToFileURL(entry).href);
const { svg } = render(readFileSync(input, "utf8"), { padding: 16 });

// Pele leaves the background transparent, which is unreadable in GitHub's dark theme.
const opened = svg.indexOf(">") + 1;
writeFileSync(output, `${svg.slice(0, opened)}<rect width="100%" height="100%" fill="var(--_bg)"/>${svg.slice(opened)}`);
console.log(output);
