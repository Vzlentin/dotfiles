import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

// A Mermaid code block: its source, and the colored diagram rows when pi shows it as a diagram.
export interface Diagram {
  source: string;
  lines?: string[];
}

// An image that a tool result shows, with the file path when the tool read one.
export interface ImageRef {
  data: string;
  mimeType: string;
  path?: string;
}

interface MermaidSpan {
  cls: "border" | "text" | "edge" | "edgeLabel" | "title" | "none";
  text: string;
}

interface MermaidArt {
  styled: MermaidSpan[][];
}

const DIAGRAM_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const d = JSON.parse(argv[0]);
  const size = d.fontSize * 2;
  const regular = $.NSFont.fontWithNameSize("Menlo-Regular", size);
  const bold = $.NSFont.fontWithNameSize("Menlo-Bold", size);
  const cellW = $.NSString.stringWithString("M").sizeWithAttributes($({ NSFont: regular })).width;
  const cellH = Math.ceil(regular.ascender - regular.descender + regular.leading);
  const pad = size;
  const width = Math.ceil(d.cols * cellW + 2 * pad);
  const height = Math.ceil(d.rows * cellH + 2 * pad);
  const color = (hex) => $.NSColor.colorWithSRGBRedGreenBlueAlpha(
    parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1);
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, width, height, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  color(d.background).setFill;
  $.NSRectFill($.NSMakeRect(0, 0, width, height));
  const attrs = d.colors.map((hex) => [regular, bold].map((font) => $({ NSFont: font, NSColor: color(hex) })));
  // Each character goes in its own cell, so fallback fonts cannot move the columns.
  for (const [row, col, text, c, b] of d.cells) {
    const point = $.NSMakePoint(pad + col * cellW, height - pad - (row + 1) * cellH);
    $.NSString.stringWithString(text).drawAtPointWithAttributes(point, attrs[c][b]);
  }
  $.NSGraphicsContext.restoreGraphicsState;
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  const board = $.NSPasteboard.generalPasteboard;
  board.clearContents;
  if (!board.setDataForType(png, $.NSPasteboardTypePNG)) throw new Error("the pasteboard did not accept the image");
  return width + "x" + height;
}`;

const IMAGE_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const data = $.NSData.dataWithContentsOfFile(argv[0]);
  const board = $.NSPasteboard.generalPasteboard;
  board.clearContents;
  const ok = argv[1] === "image/png"
    ? board.setDataForType(data, $.NSPasteboardTypePNG)
    : board.writeObjects($([$.NSImage.alloc.initWithData(data)]));
  if (!ok) throw new Error("the pasteboard did not accept the image");
}`;

const SGR = /\x1b\[([\d;]*)m/g;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function xterm256(n: number): string {
  if (n < 16) {
    const base = [0, 0x80, 0xc0, 0xff];
    if (n === 7) return hex(0xc0, 0xc0, 0xc0);
    if (n === 8) return hex(0x80, 0x80, 0x80);
    const v = n < 8 ? base[1] : base[3];
    return hex(n & 1 ? v : 0, n & 2 ? v : 0, n & 4 ? v : 0);
  }
  if (n < 232) {
    const level = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    const i = n - 16;
    return hex(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
  }
  const v = 8 + (n - 232) * 10;
  return hex(v, v, v);
}

function ansiColor(ansi: string): string | undefined {
  for (const [, params] of ansi.matchAll(SGR)) {
    const p = params.split(";").map(Number);
    if (p[0] === 38 && p[1] === 2) return hex(p[2], p[3], p[4]);
    if (p[0] === 38 && p[1] === 5) return xterm256(p[2]);
  }
  return undefined;
}

// Converts the colored diagram rows to the input of DIAGRAM_SCRIPT.
function diagramImage(lines: string[], theme: Theme) {
  const foreground = ansiColor(theme.getFgAnsi("text")) ?? "#d4d4d4";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(foreground.slice(i, i + 2), 16));
  const background = 0.299 * r + 0.587 * g + 0.114 * b > 128 ? "#1d1f21" : "#ffffff";
  const colors = [foreground];
  const cells: Array<[number, number, string, number, number]> = [];
  let cols = 0;
  lines.forEach((line, row) => {
    let col = 0;
    let color = 0;
    let bold = 0;
    for (const part of line.split(/(\x1b\[[\d;]*m)/)) {
      if (part.startsWith("\x1b[")) {
        for (const p of part.slice(2, -1).split(";").map(Number)) {
          if (p === 0) [color, bold] = [0, 0];
          else if (p === 1) bold = 1;
          else if (p === 22) bold = 0;
          else if (p === 39) color = 0;
        }
        const next = ansiColor(part);
        if (next) {
          if (!colors.includes(next)) colors.push(next);
          color = colors.indexOf(next);
        }
        continue;
      }
      for (const char of stripTerminalSequences(part)) {
        if (char.trim()) cells.push([row, col, char, color, bold]);
        col += Math.max(1, visibleWidth(char));
      }
    }
    cols = Math.max(cols, col);
  });
  return { fontSize: 13, cols, rows: lines.length, colors, cells, background };
}

// Pi does not export its Mermaid renderer, so this loads grok-mermaid from the pi installation.
async function renderMermaid(source: string): Promise<MermaidArt | null> {
  const entry = createRequire(process.argv[1]).resolve("grok-mermaid");
  const { render } = (await import(pathToFileURL(entry).href)) as { render(src: string): MermaidArt | null };
  return render(source);
}

// Colors the diagram rows as pi does.
function styleSpan(span: MermaidSpan, theme: Theme): string {
  switch (span.cls) {
    case "border":
      return theme.fg("borderMuted", span.text);
    case "text":
      return theme.fg("text", span.text);
    case "edge":
      return theme.fg("accent", span.text);
    case "edgeLabel":
      return theme.fg("muted", span.text);
    case "title":
      return theme.fg("accent", theme.bold(span.text));
    case "none":
      return span.text;
  }
}

// A diagram that is wider than the terminal shows as code, so this draws it at its full width.
async function diagramLines(diagram: Diagram, theme: Theme): Promise<string[]> {
  if (diagram.lines) return diagram.lines;
  const art = await renderMermaid(diagram.source);
  if (!art) throw new Error("grok-mermaid cannot draw this diagram");
  return art.styled.map((row) => row.map((span) => styleSpan(span, theme)).join(""));
}

export async function copyDiagram(diagram: Diagram, theme: Theme): Promise<string> {
  if (process.platform !== "darwin") throw new Error("image copy requires macOS");
  const lines = await diagramLines(diagram, theme);
  const input = JSON.stringify(diagramImage(lines, theme));
  const { stdout } = await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", DIAGRAM_SCRIPT, input]);
  return stdout.trim();
}

// Writes the image data to a temporary file, one file for each image.
export function imageFile(image: ImageRef): string {
  const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
  const file = join(tmpdir(), `pi-vc-${hash}.${EXTENSIONS[image.mimeType] ?? "img"}`);
  if (!existsSync(file)) writeFileSync(file, Buffer.from(image.data, "base64"));
  return file;
}

export async function copyImage(image: ImageRef): Promise<void> {
  if (process.platform !== "darwin") throw new Error("image copy requires macOS");
  await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", IMAGE_SCRIPT, imageFile(image), image.mimeType]);
}
