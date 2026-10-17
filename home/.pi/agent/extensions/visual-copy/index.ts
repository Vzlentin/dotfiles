import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { copyDiagram, copyImage, imageFile } from "./clipboard.ts";
import { collectBlocks, contentWidth, type Node } from "./transcript.ts";
import { VisualCopy, type CopyResult } from "./view.ts";

function describe(text: string): string {
  const lines = text.split("\n");
  const preview = lines.find((l) => l.trim())?.trim().slice(0, 60) ?? "";
  return `Copied ${lines.length} line${lines.length === 1 ? "" : "s"}: ${preview}`;
}

async function copyResult(ctx: ExtensionContext, result: CopyResult): Promise<void> {
  switch (result.kind) {
    case "image": {
      const { image } = result;
      if (!result.path) {
        await copyImage(image);
        ctx.ui.notify(`Copied image${image.path ? `: ${image.path}` : ""}`, "info");
        return;
      }
      const path = image.path && existsSync(image.path) ? image.path : imageFile(image);
      await copyToClipboard(path);
      ctx.ui.notify(`Copied path: ${path}`, "info");
      return;
    }
    case "diagram": {
      const size = await copyDiagram(result.diagram, ctx.ui.theme);
      ctx.ui.notify(`Copied diagram image (${size})`, "info");
      return;
    }
    case "text":
      await copyToClipboard(result.text);
      ctx.ui.notify(describe(result.text), "info");
  }
}

async function visualCopy(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/vc requires interactive mode", "error");
    return;
  }

  const result = await ctx.ui.custom<CopyResult | undefined>((tui, theme, _kb, done) => {
    const document = (tui as unknown as Node).children?.[0];
    const blocks = document ? collectBlocks(document, contentWidth(tui)) : [];
    if (blocks.length > 0) return new VisualCopy(tui, theme, blocks, done);
    ctx.ui.notify("No agent messages to copy yet", "warning");
    queueMicrotask(() => done(undefined));
    return { render: () => [], invalidate: () => {} };
  });

  if (result === undefined) return;
  try {
    await copyResult(ctx, result);
  } catch (error) {
    ctx.ui.notify(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("vc", {
    description: "Visual copy: move through agent message blocks in the transcript and copy them",
    handler: async (_args, ctx) => visualCopy(ctx),
  });
  // A shortcut keeps the draft in the editor, which a typed /vc would replace.
  pi.registerShortcut("ctrl+shift+y", {
    description: "Visual copy (/vc)",
    handler: visualCopy,
  });
}
