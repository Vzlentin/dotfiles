import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, McpServerConfig } from "@earendil-works/pi-coding-agent";

function mcpConfigPath(directory: string): string {
  return join(directory, ".pi", "mcp.json");
}

// Pi already reads <cwd>/.pi/mcp.json, so the search starts at the parent.
export function findAncestorMcpConfigDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let directory = resolve(cwd);

  while (true) {
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;

    if (existsSync(mcpConfigPath(directory))) {
      directories.push(directory);
    }
  }

  return directories;
}

export default function ancestorMcpServers(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.isProjectTrusted()) {
      return;
    }

    // A parent .pi/mcp.json does not trigger the trust prompt, so check the
    // saved decision for the folder that holds it.
    const trustStore = new ProjectTrustStore(getAgentDir());

    // Root first, so a deeper registration replaces a shallower one.
    for (const directory of findAncestorMcpConfigDirectories(ctx.cwd).reverse()) {
      if (trustStore.get(directory) !== true) {
        continue;
      }

      const path = mcpConfigPath(directory);
      let mcpServers: Record<string, McpServerConfig>;
      try {
        mcpServers = JSON.parse(readFileSync(path, "utf8")).mcpServers ?? {};
      } catch (error) {
        ctx.ui.notify(`${path}: ${error instanceof Error ? error.message : String(error)}`, "error");
        continue;
      }
      for (const [name, config] of Object.entries<McpServerConfig>(mcpServers)) {
        try {
          // Same rule as Pi for project files. registerMcpServer does not check it.
          if ("auth" in config) {
            throw new Error(`server "${name}": auth is only allowed in the global mcp.json`);
          }
          pi.registerMcpServer(name, config);
        } catch (error) {
          ctx.ui.notify(`${path}: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      }
    }
  });
}
