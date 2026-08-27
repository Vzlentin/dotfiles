import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface PaneSplitResponse {
  result?: {
    pane?: {
      pane_id?: string;
    };
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function requireSuccess(result: ExecResult, action: string): void {
  if (result.code === 0) return;

  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
  throw new Error(`${action}: ${detail}`);
}

function isPaneNotFound(result: ExecResult): boolean {
  return `${result.stderr}\n${result.stdout}`.includes('"code":"pane_not_found"');
}

function parsePaneId(output: string): string {
  let response: PaneSplitResponse;

  try {
    response = JSON.parse(output) as PaneSplitResponse;
  } catch {
    throw new Error("Herdr returned an invalid pane split response");
  }

  const paneId = response.result?.pane?.pane_id;
  if (!paneId) throw new Error("Herdr did not return a pane ID");
  return paneId;
}

export default function (pi: ExtensionAPI) {
  let editing = false;
  let runtimeActive = false;
  let activePaneId: string | undefined;

  pi.on("session_start", () => {
    runtimeActive = true;
  });

  pi.on("session_shutdown", async () => {
    runtimeActive = false;
    const paneId = activePaneId;
    activePaneId = undefined;
    if (paneId) await pi.exec("herdr", ["pane", "close", paneId]);
  });

  pi.registerShortcut("ctrl+shift+g", {
    description: "Edit prompt in Vim in a vertical Herdr split",
    handler: async (ctx) => {
      if (editing) {
        ctx.ui.notify("Side Edit is already open", "warning");
        return;
      }

      if (process.env.HERDR_ENV !== "1") {
        ctx.ui.notify("Ctrl+Shift+G requires Pi to run inside Herdr", "error");
        return;
      }

      editing = true;
      let directory: string | undefined;
      let paneId: string | undefined;

      try {
        directory = await mkdtemp(join(tmpdir(), "pi-side-edit-"));
        const promptPath = join(directory, "prompt.md");
        const statusPath = join(directory, "status");
        await writeFile(promptPath, ctx.ui.getEditorText(), "utf8");

        const split = await pi.exec("herdr", [
          "pane",
          "split",
          "--current",
          "--direction",
          "right",
          "--cwd",
          ctx.cwd,
          "--focus",
        ]);
        requireSuccess(split, "Could not create Herdr split");
        paneId = parsePaneId(split.stdout.trim());
        activePaneId = paneId;

        const marker = `__PI_SIDE_EDIT_DONE_${randomUUID().replaceAll("-", "")}__`;
        const markerMiddle = Math.floor(marker.length / 2);
        const command = [
          `vim -- ${shellQuote(promptPath)}`,
          "__pi_vim_status=$?",
          `printf '%s' \"$__pi_vim_status\" > ${shellQuote(statusPath)}`,
          `printf '\\n%s%s\\n' ${shellQuote(marker.slice(0, markerMiddle))} ${shellQuote(marker.slice(markerMiddle))}`,
        ].join("; ");

        const run = await pi.exec("herdr", ["pane", "run", paneId, command]);
        requireSuccess(run, "Could not start Vim");

        const wait = await pi.exec("herdr", [
          "pane",
          "wait-output",
          paneId,
          "--match",
          marker,
          "--source",
          "recent-unwrapped",
        ]);
        if (isPaneNotFound(wait)) return;
        requireSuccess(wait, "Vim did not finish editing");
        if (!runtimeActive) return;

        const status = (await readFile(statusPath, "utf8")).trim();
        if (!runtimeActive) return;
        if (status !== "0") {
          ctx.ui.notify(`Vim exited with status ${status}; prompt was not changed`, "warning");
          return;
        }

        const editedPrompt = (await readFile(promptPath, "utf8")).replace(/\n$/, "");
        if (!runtimeActive) return;
        ctx.ui.setEditorText(editedPrompt);
        ctx.ui.notify("Prompt updated from Vim", "info");
      } catch (error) {
        if (runtimeActive) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(message, "error");
        }
      } finally {
        if (activePaneId === paneId) activePaneId = undefined;
        if (paneId && runtimeActive) {
          await pi.exec("herdr", ["pane", "close", paneId]);
        }
        if (directory) {
          await rm(directory, { recursive: true, force: true });
        }
        editing = false;
      }
    },
  });
}
