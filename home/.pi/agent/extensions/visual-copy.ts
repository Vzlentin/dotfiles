import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  Marked,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

// Pi has no public API for the transcript, so /vc reads the live component tree.
// These are the internal shapes it depends on.
interface Node extends Component {
  children?: Node[];
}

interface MarkdownNode extends Node {
  text: string;
  paddingX: number;
  options?: { transform?: (text: string, width: number) => string };
  cachedTokens?: WeakRef<{ tokens: Token[] }>;
  renderToken(token: Token, ...rest: unknown[]): string[];
}

interface AssistantNode extends Node {
  contentContainer: Node;
  updateContent: unknown;
}

interface ImageNode extends Node {
  base64Data: string;
  mimeType: string;
}

interface ToolNode extends Node {
  toolName: string;
  args?: Record<string, unknown>;
  cwd?: string;
  imageComponents: ImageNode[];
}

type Owner = AssistantNode | ToolNode;

interface ScrollViewNode {
  child: Node;
  scrollTop: number;
  viewportHeight: number;
  isFollowingEnd: boolean;
  getContentWidth(width: number): number;
  scrollTo(top: number, options?: { disableFollow?: boolean }): void;
  scrollToEnd(): void;
}

interface Token {
  type: string;
  lang?: string;
  raw: string;
  text?: string;
  tokens?: Token[];
  items?: Array<{ raw: string; tokens: Token[] }>;
}

type Rows = [number, number];

// A selectable part of one Markdown component: a top-level element, a list item or a code block.
interface Segment {
  rows: Rows;
  raw: string;
  code?: string;
  parent?: number;
  // A Mermaid code block: its source, and the colored diagram rows when pi shows it as a diagram.
  diagram?: { source: string; lines?: string[] };
}

// An image that a tool result shows, with the file path when the tool read one.
interface ImageRef {
  data: string;
  mimeType: string;
  path?: string;
}

interface Block extends Segment {
  owner: Owner;
  image?: ImageNode;
  imagePath?: string;
  message: number;
  part: number;
  index: number;
  // Index of the containing block in the block list, such as the list item around a code block.
  container?: number;
}

const RAW_FLASH_MS = 150;

// One match of the search query: a row of a rendered assistant message, and the
// columns in its visible text. `block` is the innermost block that has the row.
interface Match {
  block: number;
  owner: Owner;
  row: number;
  start: number;
  end: number;
}

type CopyResult =
  | { text: string }
  | { diagram: { source: string; lines?: string[] } }
  | { image: ImageRef; path: boolean };

interface MermaidSpan {
  cls: "border" | "text" | "edge" | "edgeLabel" | "title" | "none";
  text: string;
}

interface MermaidArt {
  styled: MermaidSpan[][];
}
const MARK = /\x1b\]vc;(\d+);([se])\x07/g;
const BAR_SLOT = /^((?:\x1b\][^\x07]*\x07)*) /;
const RESET = /\x1b\[(?:0|49)?m/g;
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
const SGR = /\x1b\[([\d;]*)m/g;
// One terminal sequence: CSI, OSC, APC or a two-byte escape.
const ESCAPE = /\x1b(?:\[[0-9;:?<=>]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x1b]*\x1b\\|[@-Z\\-_])/y;
const segmentCache = new WeakMap<MarkdownNode, { width: number; text: string; segments: Segment[] }>();

function isMarkdown(node: unknown): node is MarkdownNode {
  const n = node as Partial<MarkdownNode> | undefined;
  return typeof n?.renderToken === "function" && typeof n.text === "string";
}

function isAssistant(node: unknown): node is AssistantNode {
  const n = node as Partial<AssistantNode> | undefined;
  return typeof n?.updateContent === "function" && Array.isArray(n.contentContainer?.children);
}

function isTool(node: unknown): node is ToolNode {
  const n = node as Partial<ToolNode> | undefined;
  return typeof n?.toolName === "string" && Array.isArray(n.imageComponents);
}

function findOwners(root: Node, found: Owner[] = []): Owner[] {
  if (isAssistant(root) || isTool(root)) found.push(root);
  else for (const child of root.children ?? []) findOwners(child, found);
  return found;
}

// Gives the absolute path of the file that a tool such as read opened, if there is one.
function toolPath(tool: ToolNode): string | undefined {
  const value = tool.args?.path ?? tool.args?.file_path;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const path = value.trim().replace(/^@/, "").replace(/^~(?=\/|$)/, homedir());
  return resolve(tool.cwd ?? process.cwd(), path);
}

function textParts(owner: AssistantNode): MarkdownNode[] {
  return (owner.contentContainer.children ?? []).filter(isMarkdown);
}

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim() === "";
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length))).join("\n");
}

// Renders the Markdown one time with invisible start and end marks around each token,
// and gives the rows between the marks.
function markedRows(markdown: MarkdownNode, width: number): { rows: Map<Token, Rows>; tokens: Token[] } {
  const ids = new Map<Token, number>();
  const renderToken = markdown.renderToken;
  markdown.renderToken = function (token, ...rest) {
    const lines = renderToken.call(this, token, ...rest);
    const first = lines.findIndex((l) => !isBlank(l));
    if (first === -1) return lines;
    const last = lines.length - 1 - [...lines].reverse().findIndex((l) => !isBlank(l));
    const id = ids.get(token) ?? ids.size;
    ids.set(token, id);
    const marked = lines.slice();
    marked[first] = `\x1b]vc;${id};s\x07${marked[first]}`;
    marked[last] = `${marked[last]}\x1b]vc;${id};e\x07`;
    return marked;
  };

  let lines: string[];
  let tokens: Token[];
  try {
    markdown.invalidate();
    lines = markdown.render(width);
    tokens = markdown.cachedTokens?.deref()?.tokens ?? [];
  } finally {
    delete (markdown as Partial<MarkdownNode>).renderToken;
    markdown.invalidate();
  }

  const starts = new Map<number, number>();
  const rowsById = new Map<number, Rows>();
  lines.forEach((line, row) => {
    for (const [, id, kind] of line.matchAll(MARK)) {
      if (kind === "s") starts.set(Number(id), row);
      else rowsById.set(Number(id), [starts.get(Number(id)) ?? row, row]);
    }
  });

  const rows = new Map<Token, Rows>();
  for (const [token, id] of ids) {
    const r = rowsById.get(id);
    if (r) rows.set(token, r);
  }
  return { rows, tokens };
}

// Gives the rows of a token list. Lists inside list items do not go through renderToken,
// so their rows come from their items.
function spanOf(tokens: Token[], rows: Map<Token, Rows>): Rows | undefined {
  let span: Rows | undefined;
  for (const token of tokens) {
    const r = rows.get(token) ?? (token.items && spanOf(token.items.flatMap((i) => i.tokens), rows));
    if (r) span = span ? [Math.min(span[0], r[0]), Math.max(span[1], r[1])] : r;
  }
  return span;
}

function isMermaid(token: Token): boolean {
  return token.type === "code" && token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}

// Pi replaces each Mermaid code block with one inline code span for each diagram row.
// This gives the source tokens, by the rendered Markdown that replaces them.
function diagramSources(markdown: MarkdownNode, width: number): Map<string, Token> {
  const sources = new Map<string, Token>();
  const transform = markdown.options?.transform;
  if (!transform || !/^\s*(```|~~~)\s*mermaid/im.test(markdown.text)) return sources;
  const contentWidth = Math.max(1, width - markdown.paddingX * 2);
  for (const token of new Marked().lexer(markdown.text) as Token[]) {
    if (!isMermaid(token)) continue;
    const rendered = transform(token.raw, contentWidth);
    if (rendered !== token.raw) sources.set(rendered.trim(), token);
  }
  return sources;
}

// Gives the text in one inline code span row, as pi writes it for a diagram.
function codeSpanText(line: string): string {
  const row = line.replace(/ +$/, "");
  const fence = row.match(/^`+/)?.[0].length ?? 0;
  let text = row.slice(fence, row.length - fence);
  if (/^ `/.test(text) || /` $/.test(text)) text = text.slice(1, -1);
  return text === "\u00a0" ? "" : text;
}

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
async function diagramLines(diagram: { source: string; lines?: string[] }, theme: Theme): Promise<string[]> {
  if (diagram.lines) return diagram.lines;
  const art = await renderMermaid(diagram.source);
  if (!art) throw new Error("grok-mermaid cannot draw this diagram");
  return art.styled.map((row) => row.map((span) => styleSpan(span, theme)).join(""));
}

async function copyDiagram(diagram: { source: string; lines?: string[] }, theme: Theme): Promise<string> {
  if (process.platform !== "darwin") throw new Error("image copy requires macOS");
  const lines = await diagramLines(diagram, theme);
  const input = JSON.stringify(diagramImage(lines, theme));
  const { stdout } = await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", DIAGRAM_SCRIPT, input]);
  return stdout.trim();
}

// Gives the visible text of a rendered line, and the position in the line of each code unit of it.
function plainText(line: string): { text: string; index: number[] } {
  let text = "";
  const index: number[] = [];
  let i = 0;
  while (i < line.length) {
    ESCAPE.lastIndex = i;
    const escape = ESCAPE.exec(line);
    if (escape) {
      i += escape[0].length;
      continue;
    }
    const char = String.fromCodePoint(line.codePointAt(i)!);
    for (let unit = 0; unit < char.length; unit++) index.push(i + unit);
    text += char;
    i += char.length;
  }
  return { text, index };
}

// Gives the start of each match of the query in the text. The query ignores case
// unless it has an uppercase letter, as Vim does with smartcase.
function occurrences(text: string, query: string): number[] {
  const fold = query === query.toLowerCase();
  const haystack = fold ? text.toLowerCase() : text;
  const found: number[] = [];
  for (let at = haystack.indexOf(query); at !== -1; at = haystack.indexOf(query, at + query.length)) found.push(at);
  return found;
}

// Puts each visible character of the ranges between the open and close sequences of its range.
// Each character gets its own sequences, so the colors of the line cannot cancel them.
function highlightLine(line: string, ranges: Array<{ start: number; end: number; style: [string, string] }>): string {
  const { index } = plainText(line);
  const styles = new Map<number, [string, string]>();
  for (const { start, end, style } of ranges) {
    for (let k = start; k < end && k < index.length; k++) styles.set(index[k], style);
  }
  let out = "";
  let i = 0;
  while (i < line.length) {
    ESCAPE.lastIndex = i;
    const escape = ESCAPE.exec(line);
    if (escape) {
      out += escape[0];
      i += escape[0].length;
      continue;
    }
    const char = String.fromCodePoint(line.codePointAt(i)!);
    const style = styles.get(i);
    out += style ? style[0] + char + style[1] : char;
    i += char.length;
  }
  return out;
}

function segmentsOf(markdown: MarkdownNode, width: number): Segment[] {
  const cached = segmentCache.get(markdown);
  if (cached?.width === width && cached.text === markdown.text) return cached.segments;

  const { rows, tokens } = markedRows(markdown, width);
  const diagrams = diagramSources(markdown, width);
  const segments: Segment[] = [];
  const add = (span: Rows | undefined, raw: string, code?: string, parent?: number) => {
    if (span) segments.push({ rows: span, raw: raw.trim(), code, parent });
  };
  const walk = (list: Token[], top: boolean, parent?: number) => {
    for (const token of list) {
      if (token.items) {
        for (const item of token.items) {
          add(spanOf(item.tokens, rows), item.raw, undefined, parent);
          walk(item.tokens, false, segments.length - 1);
        }
      } else if (top && diagrams.has(token.raw.trim())) {
        const source = diagrams.get(token.raw.trim())!;
        if (rows.has(token)) {
          const lines = token.raw.trim().split("\n").map(codeSpanText);
          const diagram = { source: dedent(source.text ?? ""), lines };
          segments.push({ rows: rows.get(token)!, raw: source.raw.trim(), parent, diagram });
        }
      } else if (top || token.type === "code") {
        const code = token.type === "code" ? dedent(token.text ?? "") : undefined;
        add(rows.get(token), token.raw, code, parent);
        if (isMermaid(token) && code !== undefined && rows.has(token)) segments[segments.length - 1].diagram = { source: code };
        if (token.tokens) walk(token.tokens, false, segments.length - 1);
      } else if (token.tokens) {
        walk(token.tokens, false, parent);
      }
    }
  };
  walk(tokens, true);

  if (segments.length === 0) {
    const lines = markdown.render(width);
    const first = lines.findIndex((l) => !isBlank(l));
    if (first !== -1) add([first, lines.length - 1 - [...lines].reverse().findIndex((l) => !isBlank(l))], markdown.text);
  }
  segmentCache.set(markdown, { width, text: markdown.text, segments });
  return segments;
}

function collectBlocks(document: Node, width: number): Block[] {
  const blocks: Block[] = [];
  let message = 0;
  for (const owner of findOwners(document)) {
    const before = blocks.length;
    if (isTool(owner)) {
      const path = toolPath(owner);
      owner.imageComponents.forEach((image, index) => {
        const raw = path ?? `[image ${image.mimeType}]`;
        blocks.push({ rows: [0, 0], raw, owner, image, imagePath: path, message, part: 0, index });
      });
      if (blocks.length > before) message++;
      continue;
    }
    textParts(owner).forEach((markdown, part) => {
      const first = blocks.length;
      segmentsOf(markdown, width).forEach((segment, index) => {
        const container = segment.parent === undefined ? undefined : first + segment.parent;
        blocks.push({ ...segment, owner, message, part, index, container });
      });
    });
    if (blocks.length > before) message++;
  }
  return blocks;
}

// Gives the row of `target` inside the rendered output of `root`.
function offsetOf(root: Node, target: Node, width: number): number | undefined {
  if (root === target) return 0;
  let row = 0;
  for (const child of root.children ?? []) {
    const inner = offsetOf(child, target, width);
    if (inner !== undefined) return row + inner;
    row += child.render(width).length;
  }
  return undefined;
}

// Gives the rows of a block inside its assistant message. With `inner`, a code block
// gives only its code rows, without the two fence rows.
function blockRows(block: Block, width: number, inner: boolean): Rows | undefined {
  if (block.image) return imageRows(block.owner, block.image, width);
  if (!isAssistant(block.owner)) return undefined;
  const markdown = textParts(block.owner)[block.part];
  const offset = markdown && offsetOf(block.owner, markdown, width);
  const segment = markdown && segmentsOf(markdown, width)[block.index];
  if (offset === undefined || !segment) return undefined;
  const [start, end] = segment.rows;
  const trim = inner && block.code !== undefined && end - start >= 2 ? 1 : 0;
  return [offset + start + trim, offset + end - trim];
}

// Image rows are blank except for the one row with the terminal image sequence,
// so this finds that row in the output of the tool.
function imageRows(owner: Owner, image: ImageNode, width: number): Rows | undefined {
  const own = Object.getPrototypeOf(owner) as Node;
  const lines = own.render.call(owner, width);
  const imageLines = image.render(width);
  const index = imageLines.findIndex((l) => l !== "");
  const row = index === -1 ? -1 : lines.indexOf(imageLines[index]);
  if (row === -1) return undefined;
  return [row - index, row - index + imageLines.length - 1];
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

// Writes the image data to a temporary file, one file for each image.
function imageFile(image: ImageRef): string {
  const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
  const file = join(tmpdir(), `pi-vc-${hash}.${EXTENSIONS[image.mimeType] ?? "img"}`);
  if (!existsSync(file)) writeFileSync(file, Buffer.from(image.data, "base64"));
  return file;
}

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

async function copyImage(image: ImageRef): Promise<void> {
  if (process.platform !== "darwin") throw new Error("image copy requires macOS");
  await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", IMAGE_SCRIPT, imageFile(image), image.mimeType]);
}

class VisualCopy implements Component {
  private cursor: number;
  private anchor: number | undefined;
  private raw = false;
  private pendingReveal = true;
  // The query while the user types it after `/` or `?`, and the cursor before the search started.
  private search: { query: string; origin: number; backward: boolean } | undefined;
  private query = "";
  private backward = false;
  private matches: Match[] = [];
  private matchWidth = -1;
  private renderWidth: number | undefined;
  private current: number | undefined;
  private notice: { text: string; error: boolean } | undefined;
  private readonly renders = new Map<Owner, (width: number) => string[]>();
  private readonly matchStyles: { other: [string, string]; current: [string, string] };
  private readonly scrollView: ScrollViewNode | undefined;
  private readonly savedScroll: number | "end" | undefined;
  private readonly background: [string, string];

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly blocks: Block[],
    private readonly done: (result: CopyResult | undefined) => void,
  ) {
    this.cursor = blocks.length - 1;
    this.scrollView = (tui as unknown as { getPrimaryScrollView?: () => ScrollViewNode }).getPrimaryScrollView?.();
    this.savedScroll = this.scrollView?.isFollowingEnd ? "end" : this.scrollView?.scrollTop;
    const [open, close] = theme.bg("selectedBg", "\u0000").split("\u0000");
    this.background = [open, close];
    this.matchStyles = {
      other: ["\x1b[7m", "\x1b[27m"],
      current: [theme.getFgAnsi("warning").replace("[38;", "[48;") + "\x1b[30m", "\x1b[39m\x1b[49m"],
    };

    for (const owner of new Set(blocks.map((b) => b.owner))) {
      const render = owner.render;
      this.renders.set(owner, render);
      owner.render = (width) => this.decorate(owner, render.call(owner, width), width);
    }
  }

  dispose(): void {
    for (const owner of new Set(this.blocks.map((b) => b.owner))) delete (owner as Partial<Node>).render;
    if (this.savedScroll === "end") this.scrollView?.scrollToEnd();
    else if (this.savedScroll !== undefined) this.scrollView?.scrollTo(this.savedScroll);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.raw) return;
    const key = decodeKittyPrintable(data) ?? data;
    if (this.search) return this.handleSearchInput(data, key);
    this.notice = undefined;
    const last = this.blocks.length - 1;
    const message = this.blocks[this.cursor].message;
    const messageStart = (m: number) => this.blocks.findIndex((b) => b.message === m);
    const nextMessage = this.blocks.findIndex((b) => b.message > message);

    if (matchesKey(data, "escape")) {
      if (this.anchor === undefined) return this.done(undefined);
      this.anchor = undefined;
    } else if (key === "q") {
      return this.done(undefined);
    } else if (this.image() && (key === "y" || key === "Y" || matchesKey(data, "ctrl+c") || matchesKey(data, "enter"))) {
      return this.done({ image: this.image()!, path: key === "Y" });
    } else if (key === "y" || matchesKey(data, "ctrl+c") || matchesKey(data, "enter")) {
      const diagram = this.diagram();
      return this.done(diagram ? { diagram } : { text: this.selectionText() });
    } else if (key === "Y" && this.diagram()) {
      return this.done({ text: this.diagram()!.source });
    } else if (key === "Y") {
      // Show the raw selection, fences included, for a moment before the copy.
      this.raw = true;
      setTimeout(() => this.done({ text: this.selectionText() }), RAW_FLASH_MS);
    } else if (key === "j" || matchesKey(data, "down")) {
      this.move(Math.min(this.cursor + 1, last));
    } else if (key === "k" || matchesKey(data, "up")) {
      this.move(Math.max(this.cursor - 1, 0));
    } else if ("}]J".includes(key) || matchesKey(data, "shift+down")) {
      this.move(nextMessage === -1 ? last : nextMessage);
    } else if ("{[K".includes(key) || matchesKey(data, "shift+up")) {
      const start = messageStart(message);
      this.move(this.cursor > start || message === 0 ? start : messageStart(message - 1));
    } else if (key === "g" || matchesKey(data, "home")) {
      this.move(0);
    } else if (key === "G" || matchesKey(data, "end")) {
      this.move(last);
    } else if (key === "/" || key === "?") {
      this.search = { query: "", origin: this.cursor, backward: key === "?" };
      this.findMatches(this.contentWidth());
    } else if ((key === "n" || key === "N") && this.query) {
      if (this.matchWidth !== this.contentWidth()) this.findMatches(this.contentWidth());
      this.jump(this.query, this.backward !== (key === "N"), this.cursor, this.anchor !== undefined);
    } else if (key === "v") {
      this.anchor = this.anchor === undefined ? this.cursor : undefined;
    } else if (key === "V") {
      this.anchor = messageStart(message);
      this.move(nextMessage === -1 ? last : nextMessage - 1);
    } else {
      return;
    }
    this.tui.requestRender();
  }

  // While the user types, the cursor goes to the first match from the start position, as Vim incsearch does.
  private handleSearchInput(data: string, key: string): void {
    const search = this.search!;
    if (matchesKey(data, "escape") || (matchesKey(data, "backspace") && !search.query)) {
      this.search = undefined;
      this.notice = undefined;
      this.findMatches(this.contentWidth());
      this.move(search.origin);
    } else if (matchesKey(data, "enter")) {
      this.search = undefined;
      // An empty query repeats the last search, as in Vim.
      if (search.query) this.query = search.query;
      this.backward = search.backward;
      const current = this.current;
      this.findMatches(this.contentWidth());
      if (search.query) this.current = current;
      else if (this.query) this.jump(this.query, search.backward, search.origin);
    } else if (matchesKey(data, "backspace")) {
      search.query = [...search.query].slice(0, -1).join("");
      this.incremental(search);
    } else if (/^[^\x00-\x1f\x7f]+$/.test(key)) {
      search.query += key;
      this.incremental(search);
    } else {
      return;
    }
    this.tui.requestRender();
  }

  private incremental(search: { query: string; origin: number; backward: boolean }): void {
    this.notice = undefined;
    this.findMatches(this.contentWidth());
    if (search.query) this.jump(search.query, search.backward, search.origin);
    else this.move(search.origin);
  }

  // Matches use the width that the messages get when they render.
  private contentWidth(): number {
    return this.renderWidth ?? this.scrollView?.getContentWidth(this.tui.terminal.columns) ?? this.tui.terminal.columns;
  }

  private activeQuery(): string {
    return this.search ? this.search.query : this.query;
  }

  // Finds each match of the active query in the rendered assistant messages, in document order.
  private findMatches(width: number): void {
    this.matchWidth = width;
    this.matches = [];
    this.current = undefined;
    const query = this.activeQuery();
    if (!query) return;
    const needle = query === query.toLowerCase() ? query.toLowerCase() : query;
    for (const [owner, render] of this.renders) {
      if (!isAssistant(owner)) continue;
      const spans: Array<{ block: number; rows: Rows }> = [];
      this.blocks.forEach((block, i) => {
        const rows = block.owner === owner && !block.image ? blockRows(block, width, false) : undefined;
        if (rows) spans.push({ block: i, rows });
      });
      if (spans.length === 0) continue;
      render.call(owner, width).forEach((line, row) => {
        let inner: { block: number; rows: Rows } | undefined;
        for (const span of spans) {
          if (row < span.rows[0] || row > span.rows[1]) continue;
          if (!inner || span.rows[1] - span.rows[0] < inner.rows[1] - inner.rows[0]) inner = span;
        }
        if (!inner) return;
        for (const start of occurrences(plainText(line).text, needle)) {
          this.matches.push({ block: inner.block, owner, row, start, end: start + needle.length });
        }
      });
    }
  }

  // Goes to the next match, or the previous one when `backward` is set. With no current match,
  // it starts after or before the `origin` block. At the ends it wraps, as Vim does.
  // With `byBlock`, it skips the other matches in the current block and stops on the
  // first match of the next block, so a range grows one block at a time.
  private jump(query: string, backward: boolean, origin: number, byBlock = false): void {
    const count = this.matches.length;
    if (count === 0) {
      this.notice = { text: `Pattern not found: ${query}`, error: true };
      this.move(origin);
      return;
    }
    let next: number;
    const step = backward ? -1 : 1;
    if (this.current !== undefined) {
      next = this.current + step;
      const block = this.matches[this.current].block;
      while (byBlock && next >= 0 && next < count && this.matches[next].block === block) next += step;
    } else if (backward) next = this.matches.findLastIndex((m) => m.block < origin);
    else next = this.matches.findIndex((m) => m.block > origin);
    if (next < 0 || next >= count) {
      next = backward ? count - 1 : 0;
      this.notice = { text: backward ? "search hit TOP, continuing at BOTTOM" : "search hit BOTTOM, continuing at TOP", error: false };
    }
    while (byBlock && next > 0 && this.matches[next - 1].block === this.matches[next].block) next--;
    this.move(this.matches[next].block, next);
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.pendingReveal) {
      this.pendingReveal = false;
      this.reveal();
    }

    const theme = this.theme;
    const block = this.blocks[this.cursor];
    const [from, to] = this.range();
    const inMessage = this.blocks.filter((b) => b.message === block.message);
    const mode = this.anchor === undefined
      ? theme.fg("accent", theme.bold(" COPY "))
      : theme.fg("warning", theme.bold(` VISUAL ${to - from + 1} `));
    const position = theme.fg(
      "muted",
      `msg ${block.message + 1}/${this.blocks[this.blocks.length - 1].message + 1}` +
        ` · block ${inMessage.indexOf(block) + 1}/${inMessage.length}`,
    );
    const count = this.matches.length;
    const counter = count === 0 ? "" : theme.fg("muted", ` [${this.current === undefined ? "-" : this.current + 1}/${count}]`);
    const notice = this.notice ? "  " + theme.fg(this.notice.error ? "error" : "warning", this.notice.text) : "";
    const border = theme.fg("borderAccent", "\u2500".repeat(width));
    if (this.search) {
      const prompt = theme.fg("accent", this.search.backward ? "?" : "/") + this.search.query + theme.inverse(" ");
      const line = ` ${prompt}${counter}${notice}`;
      const searchHints = [["enter", "keep"], ["esc", "cancel"]]
        .map(([k, label]) => theme.fg("accent", k) + theme.fg("dim", ` ${label}`))
        .join(theme.fg("dim", " \u00b7 "));
      const pad = " ".repeat(Math.max(2, width - visibleWidth(line) - visibleWidth(searchHints) - 1));
      return [border, truncateToWidth(line + pad + searchHints, width), border];
    }
    const searchState = this.query ? theme.fg("muted", `  ${this.backward ? "?" : "/"}${this.query}`) + counter : "";
    const hints = [
      ["j/k", "block"],
      ["{/}", "msg"],
      ["v", "range"],
      ["V", "msg range"],
      ["/ ?", "search"],
      ...(this.query ? [["n/N", this.anchor === undefined ? "next/prev" : "next/prev block"]] : []),
      ...(this.image()
        ? [["y", "copy image"], ["Y", "copy path"]]
        : this.diagram()
          ? [["y", "copy image"], ["Y", "copy source"]]
          : [["y", "copy"], ["Y", "copy raw"]]),
      ["esc", "exit"],
    ]
      .map(([k, label]) => theme.fg("accent", k) + theme.fg("dim", ` ${label}`))
      .join(theme.fg("dim", " · "));

    const left = `${mode} ${position}${searchState}${notice}`;
    const gap = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(hints) - 1));
    return [border, truncateToWidth(left + gap + hints, width), border];
  }

  private move(target: number, match?: number): void {
    this.cursor = target;
    this.current = match;
    this.pendingReveal = true;
  }

  private range(): Rows {
    const anchor = this.anchor ?? this.cursor;
    return [Math.min(anchor, this.cursor), Math.max(anchor, this.cursor)];
  }

  // Only one image block copies the image.
  private image(): ImageRef | undefined {
    const [from, to] = this.range();
    const { image, imagePath } = this.blocks[from];
    if (from !== to || !image) return undefined;
    return { data: image.base64Data, mimeType: image.mimeType, path: imagePath };
  }

  // Only one diagram block gives an image.
  private diagram(): Segment["diagram"] {
    const [from, to] = this.range();
    return from === to ? this.blocks[from].diagram : undefined;
  }

  // Only one code block, outside raw mode, gives its code without fences.
  private codeOnly(): boolean {
    const [from, to] = this.range();
    return !this.raw && from === to && this.blocks[from].code !== undefined;
  }

  private selectionText(): string {
    const [from, to] = this.range();
    if (this.codeOnly()) return this.blocks[from].code!;
    // A nested block is already in the raw text of its selected container.
    return this.blocks
      .slice(from, to + 1)
      .filter((b) => b.container === undefined || b.container < from)
      .map((b) => b.raw)
      .join("\n\n");
  }

  // Marks each match in the message rows, and the current match in its own color.
  private highlight(owner: Owner, lines: string[], width: number): string[] {
    this.renderWidth = width;
    if (!this.activeQuery()) return lines;
    if (width !== this.matchWidth) this.findMatches(width);
    const rows = new Map<number, Array<{ start: number; end: number; style: [string, string] }>>();
    this.matches.forEach((match, i) => {
      if (match.owner !== owner) return;
      const style = i === this.current ? this.matchStyles.current : this.matchStyles.other;
      const ranges = rows.get(match.row) ?? [];
      ranges.push({ start: match.start, end: match.end, style });
      rows.set(match.row, ranges);
    });
    if (rows.size === 0) return lines;
    const result = lines.slice();
    for (const [row, ranges] of rows) {
      if (row < result.length) result[row] = highlightLine(result[row], ranges);
    }
    return result;
  }

  private decorate(owner: Owner, rendered: string[], width: number): string[] {
    const lines = this.highlight(owner, rendered, width);
    const [from, to] = this.range();
    let span: Rows | undefined;
    let cursor: Rows | undefined;
    for (let i = from; i <= to; i++) {
      if (this.blocks[i].owner !== owner) continue;
      const rows = blockRows(this.blocks[i], width, this.codeOnly());
      if (!rows) continue;
      if (i === this.cursor) cursor = rows;
      span = span ? [Math.min(span[0], rows[0]), Math.max(span[1], rows[1])] : rows;
    }
    if (!span) return lines;

    // Blocks in a range are contiguous, so every row between the first and the last one is selected.
    const [open, close] = this.background;
    const result = lines.slice();
    for (let row = span[0]; row <= span[1] && row < result.length; row++) {
      const marker = cursor && row >= cursor[0] && row <= cursor[1] ? "accent" : "borderMuted";
      // Image rows get spaces, so the background shows at the side of the image. The Kitty
      // row keeps the cursor at the start, and the image covers the spaces under it.
      if (isTool(owner) && (result[row] === "" || /^\x1b_G[^\x1b]*C=1/.test(result[row]))) {
        result[row] = result[row] + open + " ".repeat(width) + close;
        continue;
      }
      const line = result[row].replace(BAR_SLOT, (_, prefix: string) => prefix + this.theme.fg(marker, "▌"));
      result[row] = open + line.replace(RESET, (reset) => reset + open) + close;
    }
    return result;
  }

  private reveal(): void {
    const view = this.scrollView;
    if (!view) return;
    const width = view.getContentWidth(this.tui.terminal.columns);
    const block = this.blocks[this.cursor];
    const owner = offsetOf(view.child, block.owner, width);
    const rows = blockRows(block, width, this.codeOnly());
    if (owner === undefined || !rows) return;

    const margin = 2;
    const top = owner + rows[0] - margin;
    const bottom = owner + rows[1] + margin;
    const match = this.current === undefined ? undefined : this.matches[this.current];
    if (match?.block === this.cursor && bottom - top + 1 > view.viewportHeight) {
      // The block is taller than the view, so the view goes to the match row and puts it in the middle.
      const row = owner + match.row;
      if (row - margin < view.scrollTop || row + margin >= view.scrollTop + view.viewportHeight) {
        view.scrollTo(Math.max(0, row - Math.floor(view.viewportHeight / 2)), { disableFollow: true });
      }
      return;
    }
    if (top < view.scrollTop || bottom - top + 1 > view.viewportHeight) {
      view.scrollTo(top, { disableFollow: true });
    } else if (bottom >= view.scrollTop + view.viewportHeight) {
      view.scrollTo(bottom - view.viewportHeight + 1, { disableFollow: true });
    }
  }
}

function describe(text: string): string {
  const lines = text.split("\n");
  const preview = lines.find((l) => l.trim())?.trim().slice(0, 60) ?? "";
  return `Copied ${lines.length} line${lines.length === 1 ? "" : "s"}: ${preview}`;
}

async function visualCopy(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/vc requires interactive mode", "error");
    return;
  }

  const result = await ctx.ui.custom<CopyResult | undefined>((tui, theme, _kb, done) => {
    const document = (tui as unknown as Node).children?.[0];
    const blocks = document ? collectBlocks(document, tui.terminal.columns) : [];
    if (blocks.length > 0) return new VisualCopy(tui, theme, blocks, done);
    ctx.ui.notify("No agent messages to copy yet", "warning");
    queueMicrotask(() => done(undefined));
    return { render: () => [], invalidate: () => {} };
  });

  if (result === undefined) return;
  try {
    if ("image" in result) {
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
    if ("diagram" in result) {
      const size = await copyDiagram(result.diagram, ctx.ui.theme);
      ctx.ui.notify(`Copied diagram image (${size})`, "info");
      return;
    }
    await copyToClipboard(result.text);
    ctx.ui.notify(describe(result.text), "info");
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
