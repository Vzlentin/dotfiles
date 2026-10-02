import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadSkillsFromDir, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";

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

export function findDeepestSkills(skillDirectories: string[]): Map<string, Skill> {
  const skills = new Map<string, Skill>();
  for (const dir of skillDirectories) {
    for (const skill of loadSkillsFromDir({ dir, source: "agents" }).skills) {
      if (!skills.has(skill.name)) {
        skills.set(skill.name, skill);
      }
    }
  }
  return skills;
}

// Same block that Pi builds for /skill:name, which always uses the first skill loaded with that name.
export function expandSkillCommand(text: string, skills: Map<string, Skill>): string | undefined {
  const match = /^\/skill:(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const skill = match && skills.get(match[1]);
  if (!skill) {
    return undefined;
  }

  const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
  const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
  const args = match[2]?.trim();
  return args ? `${block}\n\n${args}` : block;
}

export default function ancestorAgentSkills(pi: ExtensionAPI): void {
  let deepestSkills = new Map<string, Skill>();

  // Pi stops its own .agents/skills search at the Git root and loads ~/.agents/skills before
  // extension paths. When names collide, Pi keeps the first skill, so a client skill above the
  // repository would lose to the user skill. The hooks below make the deepest skill win.
  pi.on("resources_discover", (event, ctx) => {
    const skillPaths = ctx.isProjectTrusted() ? findAncestorSkillDirectories(event.cwd) : [];
    deepestSkills = findDeepestSkills(skillPaths);
    return { skillPaths };
  });

  pi.on("input", (event) => {
    const text = expandSkillCommand(event.text, deepestSkills);
    return text === undefined ? { action: "continue" } : { action: "transform", text };
  });

  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    options.skills = options.skills.map((skill) => deepestSkills.get(skill.name) ?? skill);
  });
}
