import { readdirSync, statSync, type Dirent } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

const QUOTED_ENV_PATH =
  /(?:^|[\t =])("\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})(\/[^"]*)?)$/;
const UNQUOTED_ENV_PATH =
  /(?:^|[\t =])(\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})(\/[^\s"'=]*)?)$/;
const BRACED_ENV_VARIABLE = /(?:^|[\t ="])(\$\{([A-Za-z_][A-Za-z0-9_]*)?\}?)$/;
const UNBRACED_ENV_VARIABLE = /(?:^|[\t ="])(\$([A-Za-z_][A-Za-z0-9_]*)?)$/;
const MAX_SUGGESTIONS = 100;

type Environment = Readonly<Record<string, string | undefined>>;

type EnvironmentPathToken = {
  prefix: string;
  variableExpression: string;
  variableName: string;
  relativePath: string | undefined;
  quoted: boolean;
};

function extractEnvironmentPathToken(
  textBeforeCursor: string,
): EnvironmentPathToken | undefined {
  const quotedMatch = textBeforeCursor.match(QUOTED_ENV_PATH);
  const match = quotedMatch ?? textBeforeCursor.match(UNQUOTED_ENV_PATH);
  if (!match) return undefined;

  const prefix = match[1];
  const variableName = match[2] ?? match[3];
  if (!prefix || !variableName) return undefined;

  const relativePath = match[4];
  const quoted = quotedMatch !== null;
  const unquotedPrefix = quoted ? prefix.slice(1) : prefix;
  const variableExpression = relativePath
    ? unquotedPrefix.slice(0, -relativePath.length)
    : unquotedPrefix;

  return { prefix, variableExpression, variableName, relativePath, quoted };
}

function getEnvironmentVariableSuggestions(
  textBeforeCursor: string,
  environment: Environment,
): AutocompleteSuggestions | undefined {
  const bracedMatch = textBeforeCursor.match(BRACED_ENV_VARIABLE);
  const match = bracedMatch ?? textBeforeCursor.match(UNBRACED_ENV_VARIABLE);
  if (!match) return undefined;

  const prefix = match[1];
  const namePrefix = match[2] ?? "";
  if (!prefix) return undefined;

  const items: AutocompleteItem[] = Object.keys(environment)
    .filter((name) => name.startsWith(namePrefix))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_SUGGESTIONS)
    .map((name) => ({
      value: bracedMatch ? "${" + name + "}" : "$" + name,
      label: name,
      description: "environment variable",
    }));

  return { items, prefix };
}

function isDirectory(searchDirectory: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;

  const entryPath = resolve(searchDirectory, entry.name);

  try {
    return statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

export function getEnvironmentPathSuggestions(
  textBeforeCursor: string,
  cwd: string,
  environment: Environment = process.env,
): AutocompleteSuggestions | null | undefined {
  const variableSuggestions = getEnvironmentVariableSuggestions(
    textBeforeCursor,
    environment,
  );
  if (variableSuggestions) {
    return variableSuggestions.items.length > 0 ? variableSuggestions : null;
  }

  const token = extractEnvironmentPathToken(textBeforeCursor);
  if (!token) return undefined;
  if (!token.relativePath) return null;

  const environmentPath = environment[token.variableName];
  if (!environmentPath) return null;

  const lastSlash = token.relativePath.lastIndexOf("/");
  const relativeDirectory = token.relativePath.slice(1, lastSlash + 1);
  const searchPrefix = token.relativePath.slice(lastSlash + 1);
  const environmentRoot = isAbsolute(environmentPath)
    ? environmentPath
    : resolve(cwd, environmentPath);
  const searchDirectory = resolve(environmentRoot, relativeDirectory || ".");
  const displayDirectory = `${token.variableExpression}${token.relativePath.slice(0, lastSlash + 1)}`;

  try {
    const items: AutocompleteItem[] = readdirSync(searchDirectory, { withFileTypes: true })
      .filter((entry) => entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase()))
      .map((entry) => {
        const directory = isDirectory(searchDirectory, entry);
        const suffix = directory ? "/" : "";
        const displayPath = `${displayDirectory}${entry.name}${suffix}`;
        const needsQuotes = token.quoted || /\s/.test(displayPath);

        return {
          value: needsQuotes ? `"${displayPath}"` : displayPath,
          label: `${entry.name}${suffix}`,
          description: `${resolve(searchDirectory, entry.name)}${suffix}`,
        };
      })
      .sort((left, right) => {
        const leftDirectory = left.label.endsWith("/");
        const rightDirectory = right.label.endsWith("/");
        if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
        return left.label.localeCompare(right.label);
      })
      .slice(0, MAX_SUGGESTIONS);

    return items.length > 0 ? { items, prefix: token.prefix } : null;
  } catch {
    return null;
  }
}

function createEnvironmentPathProvider(
  current: AutocompleteProvider,
  cwd: string,
): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "$"])],

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      if (options.signal.aborted) return null;

      const currentLine = lines[cursorLine] ?? "";
      const suggestions = getEnvironmentPathSuggestions(
        currentLine.slice(0, cursorCol),
        cwd,
      );
      if (suggestions !== undefined) return suggestions;

      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.addAutocompleteProvider((current) =>
      createEnvironmentPathProvider(current, ctx.cwd),
    );
  });
}
