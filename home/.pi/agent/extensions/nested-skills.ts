import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function findAncestorSkillDirectories(cwd: string): string[] {
  const skillDirectories: string[] = [];
  let directory = resolve(cwd);

  while (true) {
    const skillsDirectory = join(directory, ".agents", "skills");
    if (isDirectory(skillsDirectory)) {
      skillDirectories.push(skillsDirectory);
    }

    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  return skillDirectories;
}

export default function ancestorAgentSkills(pi: ExtensionAPI): void {
  pi.on("resources_discover", (event, ctx) => ({
    // Pi keeps the first skill when names collide. Paths are ordered from the
    // current directory toward the filesystem root, so the deepest skill wins.
    skillPaths: ctx.isProjectTrusted() ? findAncestorSkillDirectories(event.cwd) : [],
  }));
}
