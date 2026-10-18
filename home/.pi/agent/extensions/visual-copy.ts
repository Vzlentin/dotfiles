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

// One terminal sequence: CSI, OSC, APC or a two-byte escape.
const ESCAPE = /\x1b(?:\[[0-9;:?<=>]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x1b]*\x1b\\|[@-Z\\-_])/y;

interface Range {
  start: number;
  end: number;
}

type Style = [string, string];

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim() === "";
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
function highlightLine(line: string, ranges: Array<Range & { style: Style }>): string {
  const { index } = plainText(line);
  const styles = new Map<number, Style>();
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

// Gives the runs of visible text where inverse video (SGR 7) is on, without their trailing spaces.
// The line starts with inverse off, as each terminal row does after the reset at its end.
function inverseRuns(line: string): Range[] {
  const runs: Range[] = [];
  let on = false;
  let col = 0;
  let start = 0;
  let text = "";
  const close = () => {
    let end = col;
    while (end > start && text[end - 1] === " ") end--;
    if (end > start) runs.push({ start, end });
  };
  let i = 0;
  while (i < line.length) {
    ESCAPE.lastIndex = i;
    const escape = ESCAPE.exec(line);
    if (escape) {
      i += escape[0].length;
      const sgr = /^\x1b\[([\d;]*)m$/.exec(escape[0]);
      if (!sgr) continue;
      const params = sgr[1].split(";");
      let next = on;
      for (let p = 0; p < params.length; p++) {
        const code = Number(params[p] || 0);
        // Extended colors take their own parameters, which can contain 7 or 27.
        if (code === 38 || code === 48) p += params[p + 1] === "5" ? 2 : 4;
        else if (code === 7) next = true;
        else if (code === 0 || code === 27) next = false;
      }
      if (next && !on) start = col;
      if (!next && on) close();
      on = next;
      continue;
    }
    const char = String.fromCodePoint(line.codePointAt(i)!);
    text += char;
    col += char.length;
    i += char.length;
  }
  if (on) close();
  return runs;
}

// A Mermaid code block: its source, and the colored diagram rows when pi shows it as a diagram.
interface Diagram {
  source: string;
  lines?: string[];
}

// An image that a tool result shows, with the file path when the tool read one.
interface ImageRef {
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

async function copyDiagram(diagram: Diagram, theme: Theme): Promise<string> {
  if (process.platform !== "darwin") throw new Error("image copy requires macOS");
  const lines = await diagramLines(diagram, theme);
  const input = JSON.stringify(diagramImage(lines, theme));
  const { stdout } = await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", DIAGRAM_SCRIPT, input]);
  return stdout.trim();
}

// Writes the image data to a temporary file, one file for each image.
function imageFile(image: ImageRef): string {
  const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
  const file = join(tmpdir(), `pi-vc-${hash}.${EXTENSIONS[image.mimeType] ?? "img"}`);
  if (!existsSync(file)) writeFileSync(file, Buffer.from(image.data, "base64"));
  return file;
}

async function copyImage(image: ImageRef): Promise<void> {
  if (process.platform !== "darwin") throw new Error("image copy requires macOS");
  await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", IMAGE_SCRIPT, imageFile(image), image.mimeType]);
}

// Pi has no public API for the transcript, so /vc reads the live component tree.
// These are the internal shapes it depends on.
interface Node extends Component {
  children?: Node[];
}

interface MarkdownNode extends Node {
  text: string;
  paddingX: number;
  theme: { code(text: string): string };
  options?: { transform?: (text: string, width: number) => string };
  cachedTokens?: WeakRef<{ tokens: Token[] }>;
  renderToken(token: Token, ...rest: unknown[]): string[];
  renderInlineTokens(tokens: Token[], ...rest: unknown[]): string;
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
type Position = [number, number];

// A selectable part of the transcript. A text block is a top-level element, a list item or a
// code block of one Markdown node. `container` is the index of the block around it, such as
// the list item around a code block.
interface TextBlock {
  kind: "text";
  owner: AssistantNode;
  markdown: MarkdownNode;
  segment: number;
  message: number;
  container?: number;
  raw: string;
  code?: string;
  diagram?: Diagram;
}

// An image that a tool result shows, with the file path when the tool read one.
interface ImageBlock {
  kind: "image";
  owner: ToolNode;
  image: ImageNode;
  path?: string;
  message: number;
}

type Block = TextBlock | ImageBlock;

// A part of one Markdown node, with its rows in the node.
interface Segment {
  rows: Rows;
  raw: string;
  code?: string;
  parent?: number;
  diagram?: Diagram;
}

// An inline code span in a rendered Markdown node. Positions are [row, column] in the visible
// text of the rows, and the end column is exclusive. `id` is the order in which the render
// styles the span, and `segment` is the innermost segment that has it.
interface SpanPosition {
  id: number;
  segment: number;
  start: Position;
  end: Position;
  text: string;
  raw: string;
}

// An inline code span with its rows in the owner.
interface Span extends SpanPosition {
  block: number;
  owner: AssistantNode;
  markdown: MarkdownNode;
}

// The geometry of the blocks at one width. Rows are rows in the owner. `offsets` gives the row
// of each Markdown node in its owner. `owners` gives the rendered rows of each assistant
// message and its blocks, for search.
interface Layout {
  width: number;
  rows: Array<Rows | undefined>;
  offsets: Map<MarkdownNode, number>;
  owners: Array<{ owner: AssistantNode; lines: string[]; blocks: number[] }>;
  spans: Span[];
}

// One match of the search query: a row of a rendered assistant message, and the
// columns in its visible text. `block` is the innermost block that has the row.
interface Match {
  block: number;
  owner: Owner;
  row: number;
  start: number;
  end: number;
}

// Marks around blocks (b) and inline code spans (c), with their start (s) and end (e).
// OSC sequences have no width, so they do not change wrapping or table columns.
const MARK = /\x1b\]vc;([bc])(\d+);([se])\x07/g;

function mark(kind: "b" | "c", id: number, edge: "s" | "e"): string {
  return `\x1b]vc;${kind}${id};${edge}\x07`;
}

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

// The width that the transcript gets when it renders.
function scrollViewOf(tui: TUI): ScrollViewNode | undefined {
  return (tui as unknown as { getPrimaryScrollView?: () => ScrollViewNode }).getPrimaryScrollView?.();
}

function contentWidth(tui: TUI): number {
  return scrollViewOf(tui)?.getContentWidth(tui.terminal.columns) ?? tui.terminal.columns;
}

// /vc puts its own render on each owner, so the rows of an owner come from the class render.
function baseRender(owner: Owner, width: number): string[] {
  return (Object.getPrototypeOf(owner) as Node).render.call(owner, width);
}

// Gives the row of `target` inside the rendered output of `root`. Owners give their base
// rows, so the count does not decorate them.
function offsetOf(root: Node, target: Node, width: number): number | undefined {
  if (root === target) return 0;
  let row = 0;
  for (const child of root.children ?? []) {
    const inner = offsetOf(child, target, width);
    if (inner !== undefined) return row + inner;
    row += (isAssistant(child) || isTool(child) ? baseRender(child, width) : child.render(width)).length;
  }
  return undefined;
}

// Renders the Markdown with the patch on the node, then restores the node and clears its cache.
function probe(markdown: MarkdownNode, patch: Partial<MarkdownNode>, width: number): string[] {
  const saved = Object.keys(patch).map((key) => [key, Object.getOwnPropertyDescriptor(markdown, key)] as const);
  Object.assign(markdown, patch);
  try {
    markdown.invalidate();
    return markdown.render(width);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(markdown, key, descriptor);
      else delete (markdown as unknown as Record<string, unknown>)[key];
    }
    markdown.invalidate();
  }
}

// Gives a patch that passes each inline code span through `wrap`, with the order in which the
// render styles it. Each call of renderInlineTokens puts its code span tokens on a stack, and
// theme.code takes the next one, so a table that renders a cell more than one time gives the
// same id each time.
function codePatch(markdown: MarkdownNode, wrap: (id: number, styled: string) => string) {
  const ids = new Map<Token, number>();
  const tokens: Token[] = [];
  const pending: Token[][] = [];
  const theme = markdown.theme;
  const renderInline = markdown.renderInlineTokens;
  const patch: Partial<MarkdownNode> = {
    theme: Object.assign(Object.create(theme) as typeof theme, {
      code(text: string) {
        const styled = theme.code(text);
        const token = pending[pending.length - 1]?.shift();
        if (!token) return styled;
        if (!ids.has(token)) {
          ids.set(token, tokens.length);
          tokens.push(token);
        }
        return wrap(ids.get(token)!, styled);
      },
    }),
    renderInlineTokens(list: Token[], ...rest: unknown[]) {
      pending.push(list.filter((token) => token.type === "codespan"));
      try {
        return renderInline.call(this, list, ...rest);
      } finally {
        pending.pop();
      }
    },
  };
  return { patch, tokens };
}

// Gives the index of the smallest row range that has the row. The first one wins a tie.
function innermost(ranges: Array<Rows | undefined>, row: number): number | undefined {
  let found: number | undefined;
  ranges.forEach((rows, i) => {
    if (!rows || row < rows[0] || row > rows[1]) return;
    const best = found === undefined ? undefined : ranges[found]!;
    if (!best || rows[1] - rows[0] < best[1] - best[0]) found = i;
  });
  return found;
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

function dedent(text: string): string {
  const lines = text.split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length))).join("\n");
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

function leadingSpaces(text: string): number {
  return text.length - text.trimStart().length;
}

// Renders the Markdown one time with marks around each block token and each inline code span,
// and gives the segments and the code spans. Diagram rows are not code spans.
function markdownLayout(markdown: MarkdownNode, width: number): { segments: Segment[]; spans: SpanPosition[] } {
  const ids = new Map<Token, number>();
  const renderToken = markdown.renderToken;
  const code = codePatch(markdown, (id, styled) => mark("c", id, "s") + styled + mark("c", id, "e"));
  const lines = probe(markdown, {
    ...code.patch,
    renderToken(token: Token, ...rest: unknown[]) {
      const lines = renderToken.call(this, token, ...rest);
      const first = lines.findIndex((l) => !isBlank(l));
      if (first === -1) return lines;
      const last = lines.length - 1 - [...lines].reverse().findIndex((l) => !isBlank(l));
      const id = ids.get(token) ?? ids.size;
      ids.set(token, id);
      const marked = lines.slice();
      marked[first] = mark("b", id, "s") + marked[first];
      marked[last] = marked[last] + mark("b", id, "e");
      return marked;
    },
  }, width);
  const tokens = markdown.cachedTokens?.deref()?.tokens ?? [];

  const blockStarts = new Map<number, number>();
  const blockRows = new Map<number, Rows>();
  const codeMarks = { s: new Map<number, Position>(), e: new Map<number, Position>() };
  lines.forEach((line, row) => {
    for (const found of line.matchAll(MARK)) {
      const [, kind, idText, edge] = found;
      const id = Number(idText);
      if (kind === "c") codeMarks[edge as "s" | "e"].set(id, [row, plainText(line.slice(0, found.index)).text.length]);
      else if (edge === "s") blockStarts.set(id, row);
      else blockRows.set(id, [blockStarts.get(id) ?? row, row]);
    }
  });
  const rows = new Map<Token, Rows>();
  for (const [token, id] of ids) {
    const r = blockRows.get(id);
    if (r) rows.set(token, r);
  }

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
    const first = lines.findIndex((l) => !isBlank(l));
    if (first !== -1) add([first, lines.length - 1 - [...lines].reverse().findIndex((l) => !isBlank(l))], markdown.text);
  }

  const plain = lines.map((line) => plainText(line).text);
  const segmentRows = segments.map((s) => s.rows);
  const spans: SpanPosition[] = [];
  code.tokens.forEach((token, id) => {
    let start = codeMarks.s.get(id);
    let end = codeMarks.e.get(id);
    if (!start || !end) return;
    // A wrap can put a mark at the end of the row before the span or at the start of the row after it.
    if (start[1] >= plain[start[0]].trimEnd().length && start[0] + 1 < plain.length) {
      start = [start[0] + 1, leadingSpaces(plain[start[0] + 1])];
    }
    if (end[0] > start[0] && end[1] <= leadingSpaces(plain[end[0]])) {
      end = [end[0] - 1, plain[end[0] - 1].trimEnd().length];
    }
    const segment = innermost(segmentRows, start[0]);
    if (segment === undefined || segments[segment].diagram) return;
    spans.push({ id, segment, start, end, text: token.text ?? "", raw: token.raw });
  });
  spans.sort((a, b) => a.start[0] - b.start[0] || a.start[1] - b.start[1]);
  return { segments, spans };
}

function collectBlocks(document: Node, width: number): Block[] {
  const blocks: Block[] = [];
  let message = 0;
  for (const owner of findOwners(document)) {
    const before = blocks.length;
    if (isTool(owner)) {
      const path = toolPath(owner);
      for (const image of owner.imageComponents) blocks.push({ kind: "image", owner, image, path, message });
    } else {
      for (const markdown of textParts(owner)) {
        const first = blocks.length;
        markdownLayout(markdown, width).segments.forEach(({ raw, code, diagram, parent }, segment) => {
          const container = parent === undefined ? undefined : first + parent;
          blocks.push({ kind: "text", owner, markdown, segment, message, container, raw, code, diagram });
        });
      }
    }
    if (blocks.length > before) message++;
  }
  return blocks;
}

// Pi replaces the Markdown nodes of a message while it streams. The blocks of a replaced
// node drop out of the layout, and y still copies the text that they had when /vc opened.
function isGone(block: Block): boolean {
  return block.kind === "text" && !textParts(block.owner).includes(block.markdown);
}

// Image rows are blank except for the one row with the terminal image sequence,
// so this finds that row in the output of the tool.
function imageRows(owner: ToolNode, image: ImageNode, width: number): Rows | undefined {
  const lines = baseRender(owner, width);
  const imageLines = image.render(width);
  const index = imageLines.findIndex((l) => l !== "");
  const row = index === -1 ? -1 : lines.indexOf(imageLines[index]);
  if (row === -1) return undefined;
  return [row - index, row - index + imageLines.length - 1];
}

function buildLayout(blocks: Block[], width: number): Layout {
  const rows: Array<Rows | undefined> = blocks.map(() => undefined);
  const parsed = new Map<MarkdownNode, { layout: ReturnType<typeof markdownLayout>; offset: number; blocks: Map<number, number> }>();
  const owners = new Map<AssistantNode, number[]>();
  blocks.forEach((block, i) => {
    if (block.kind === "image") {
      rows[i] = imageRows(block.owner, block.image, width);
      return;
    }
    if (isGone(block)) return;
    let entry = parsed.get(block.markdown);
    if (!entry) {
      const offset = offsetOf(block.owner, block.markdown, width);
      if (offset === undefined) return;
      entry = { layout: markdownLayout(block.markdown, width), offset, blocks: new Map() };
      parsed.set(block.markdown, entry);
    }
    const segment = entry.layout.segments[block.segment];
    if (!segment) return;
    rows[i] = [entry.offset + segment.rows[0], entry.offset + segment.rows[1]];
    entry.blocks.set(block.segment, i);
    const list = owners.get(block.owner) ?? [];
    list.push(i);
    owners.set(block.owner, list);
  });

  const spans: Span[] = [];
  const offsets = new Map<MarkdownNode, number>();
  for (const [markdown, { layout, offset, blocks: bySegment }] of parsed) {
    offsets.set(markdown, offset);
    for (const span of layout.spans) {
      const block = bySegment.get(span.segment);
      if (block === undefined) continue;
      const owner = (blocks[block] as TextBlock).owner;
      const start: Position = [offset + span.start[0], span.start[1]];
      const end: Position = [offset + span.end[0], span.end[1]];
      spans.push({ ...span, start, end, block, owner, markdown });
    }
  }
  return {
    width,
    rows,
    offsets,
    owners: [...owners].map(([owner, list]) => ({ owner, lines: baseRender(owner, width), blocks: list })),
    spans,
  };
}

// Finds each match of the query in the rendered assistant messages, in document order.
function findMatches(layout: Layout, query: string): Match[] {
  const matches: Match[] = [];
  if (!query) return matches;
  for (const { owner, lines, blocks } of layout.owners) {
    const ranges = blocks.map((block) => layout.rows[block]);
    lines.forEach((line, row) => {
      const inner = innermost(ranges, row);
      if (inner === undefined) return;
      for (const start of occurrences(plainText(line).text, query)) {
        matches.push({ block: blocks[inner], owner, row, start, end: start + query.length });
      }
    });
  }
  return matches;
}

// Gives the next match, or the previous one when `backward` is set. With no current match,
// it starts after or before the `origin` block. At the ends it wraps, as Vim does.
// With `byBlock`, it skips the other matches in the current block and stops on the
// first match of the next block, so a range grows one block at a time.
function nextMatch(
  matches: Match[],
  current: number | undefined,
  origin: number,
  backward: boolean,
  byBlock: boolean,
): { index: number; wrapped: boolean } | undefined {
  const count = matches.length;
  if (count === 0) return undefined;
  let next: number;
  const step = backward ? -1 : 1;
  if (current !== undefined) {
    next = current + step;
    const block = matches[current].block;
    while (byBlock && next >= 0 && next < count && matches[next].block === block) next += step;
  } else if (backward) next = matches.findLastIndex((m) => m.block < origin);
  else next = matches.findIndex((m) => m.block > origin);
  const wrapped = next < 0 || next >= count;
  if (wrapped) next = backward ? count - 1 : 0;
  while (byBlock && next > 0 && matches[next - 1].block === matches[next].block) next--;
  return { index: next, wrapped };
}

// Gives the columns of the span on each of its rows. A render with the span in inverse video
// shows them: wrapTextWithAnsi opens the style again on each wrapped row, after the blockquote
// border and the list indent, and a table cell closes it before its padding.
function spanRanges(layout: Layout, span: Span): Array<Range & { row: number }> {
  const offset = layout.offsets.get(span.markdown);
  if (offset === undefined) return [];
  const code = codePatch(span.markdown, (id, styled) => (id === span.id ? `\x1b[7m${styled}\x1b[27m` : styled));
  const lines = probe(span.markdown, code.patch, layout.width);
  return lines.flatMap((line, i) => {
    const row = offset + i;
    if (row < span.start[0] || row > span.end[0]) return [];
    return inverseRuns(line).map((range) => ({ row, ...range }));
  });
}

type CopyResult =
  | { kind: "text"; text: string }
  | { kind: "diagram"; diagram: Diagram }
  | { kind: "image"; image: ImageRef; path: boolean };

type Paint = (layout: Layout, owner: Owner, lines: string[]) => string[];

// What y or Y copies. With `flash`, the view shows that paint for a moment before the copy.
interface Copy {
  result: CopyResult;
  flash?: Paint;
}

// The query while the user types it after `/` or `?`, and the cursor before the search started.
interface Search {
  query: string;
  origin: number;
  backward: boolean;
}

type BlocksMode = { kind: "blocks"; anchor?: number; search?: Search };
type Mode = BlocksMode | { kind: "code"; index: number };

// The selection. `rows` are the rows in `owner` that reveal shows, and `focus` is a row
// that reveal centers when the rows do not fit in the view.
interface Target {
  owner: Owner;
  rows?: Rows;
  focus?: number;
  paint: Paint;
  copy: Copy;
  copyAlt: Copy;
  hints: Array<[string, string]>;
}

type Action =
  | "down"
  | "up"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "copy"
  | "copyAlt"
  | "back"
  | "quit"
  | "nextMessage"
  | "prevMessage"
  | "search"
  | "searchBack"
  | "next"
  | "prev"
  | "range"
  | "messageRange"
  | "code";

const RAW_FLASH_MS = 150;
const BAR_SLOT = /^((?:\x1b\][^\x07]*\x07)*) /;
const RESET = /\x1b\[(?:0|49)?m/g;

function action(data: string): Action | undefined {
  const key = decodeKittyPrintable(data) ?? data;
  const one = (keys: string) => key.length === 1 && keys.includes(key);
  if (matchesKey(data, "escape")) return "back";
  if (key === "q") return "quit";
  if (key === "y" || matchesKey(data, "ctrl+c") || matchesKey(data, "enter")) return "copy";
  if (key === "Y") return "copyAlt";
  if (key === "j" || matchesKey(data, "down")) return "down";
  if (key === "k" || matchesKey(data, "up")) return "up";
  if (key === "h" || matchesKey(data, "left")) return "left";
  if (key === "l" || matchesKey(data, "right")) return "right";
  if (one("}]J") || matchesKey(data, "shift+down")) return "nextMessage";
  if (one("{[K") || matchesKey(data, "shift+up")) return "prevMessage";
  if (key === "g" || matchesKey(data, "home")) return "top";
  if (key === "G" || matchesKey(data, "end")) return "bottom";
  if (key === "/") return "search";
  if (key === "?") return "searchBack";
  if (key === "n") return "next";
  if (key === "N") return "prev";
  if (key === "v") return "range";
  if (key === "V") return "messageRange";
  if (key === "w") return "code";
  return undefined;
}

function statusLine(theme: Theme, width: number, left: string, hints: Array<[string, string]>): string[] {
  const border = theme.fg("borderAccent", "\u2500".repeat(width));
  const right = hints
    .map(([key, label]) => theme.fg("accent", key) + theme.fg("dim", ` ${label}`))
    .join(theme.fg("dim", " \u00b7 "));
  const gap = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right) - 1));
  return [border, truncateToWidth(left + gap + right, width), border];
}

// Gives the span on the next or previous row that is nearest to the column of the span at `index`.
function rowNeighbor(spans: Span[], index: number, step: 1 | -1): number | undefined {
  const sameRow = (a: Span, b: Span) => a.owner === b.owner && a.start[0] === b.start[0];
  const span = spans[index];
  let i = index;
  while (i >= 0 && i < spans.length && sameRow(spans[i], span)) i += step;
  if (i < 0 || i >= spans.length) return undefined;
  let best = i;
  for (let k = i; k >= 0 && k < spans.length && sameRow(spans[k], spans[i]); k += step) {
    if (Math.abs(spans[k].start[1] - span.start[1]) < Math.abs(spans[best].start[1] - span.start[1])) best = k;
  }
  return best;
}

class VisualCopy implements Component {
  private cursor: number;
  private mode: Mode = { kind: "blocks" };
  private pendingReveal = true;
  private query = "";
  private backward = false;
  private matches: Match[] = [];
  private current: Match | undefined;
  private notice: { text: string; error: boolean } | undefined;
  private flash: Paint | undefined;
  private cache: { width: number; layout: Layout } | undefined;
  // The columns of the selected span, found one time for each selection.
  private spanPaint: { span: Span; ranges: Array<Range & { row: number }> } | undefined;
  private readonly owners: Set<Owner>;
  private readonly matchStyles: { other: Style; current: Style };
  private readonly spanStyle: Style;
  private readonly background: Style;
  private readonly scrollView: ScrollViewNode | undefined;
  private readonly savedScroll: number | "end" | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly blocks: Block[],
    private readonly done: (result: CopyResult | undefined) => void,
  ) {
    this.cursor = blocks.length - 1;
    this.scrollView = scrollViewOf(tui);
    this.savedScroll = this.scrollView?.isFollowingEnd ? "end" : this.scrollView?.scrollTop;
    const [open, close] = theme.bg("selectedBg", "\u0000").split("\u0000");
    this.background = [open, close];
    this.matchStyles = {
      other: ["\x1b[7m", "\x1b[27m"],
      current: [theme.getFgAnsi("warning").replace("[38;", "[48;") + "\x1b[30m", "\x1b[39m\x1b[49m"],
    };
    this.spanStyle = [theme.getFgAnsi("accent").replace("[38;", "[48;") + "\x1b[30m", "\x1b[39m\x1b[49m"];
    this.owners = new Set(blocks.map((b) => b.owner));
    for (const owner of this.owners) {
      owner.render = (width) => this.decorate(owner, baseRender(owner, width));
    }
  }

  dispose(): void {
    for (const owner of this.owners) delete (owner as Partial<Owner>).render;
    if (this.savedScroll === "end") this.scrollView?.scrollToEnd();
    else if (this.savedScroll !== undefined) this.scrollView?.scrollTo(this.savedScroll);
    this.tui.requestRender();
  }

  invalidate(): void {}

  // Gives the layout at the width of the transcript. A new width or a replaced Markdown node
  // makes a new layout, and the matches follow it.
  private layout(): Layout {
    const width = contentWidth(this.tui);
    const cached = this.cache;
    if (cached?.width === width && !cached.layout.rows.some((rows, i) => rows && isGone(this.blocks[i]))) {
      return cached.layout;
    }
    const layout = buildLayout(this.blocks, width);
    this.cache = { width, layout };
    this.matches = findMatches(layout, this.activeQuery());
    return layout;
  }

  private activeQuery(): string {
    return this.mode.kind === "blocks" && this.mode.search ? this.mode.search.query : this.query;
  }

  handleInput(data: string): void {
    if (this.flash) return;
    const layout = this.layout();
    if (this.mode.kind === "blocks" && this.mode.search) return this.handleSearchInput(layout, this.mode, this.mode.search, data);
    const act = action(data);
    this.notice = undefined;
    if (!act) return;
    if (act === "quit") return this.done(undefined);
    // A new layout can have no spans, and then the view shows and handles block mode.
    if (this.mode.kind === "code" && layout.spans.length === 0) this.mode = { kind: "blocks" };
    if (act === "copy" || act === "copyAlt") {
      const target = this.target(layout);
      return this.copy(act === "copy" ? target.copy : target.copyAlt);
    } else if (this.mode.kind === "code" ? !this.codeAction(layout, this.mode.index, act) : !this.blockAction(layout, this.mode, act)) {
      return;
    }
    this.tui.requestRender();
  }

  private copy(copy: Copy): void {
    if (!copy.flash) return this.done(copy.result);
    this.flash = copy.flash;
    setTimeout(() => this.done(copy.result), RAW_FLASH_MS);
    this.tui.requestRender();
  }

  // In code mode, h and l go to the previous and next span, and j and k go to the span
  // on the next or previous row that is nearest to the column of the selected span.
  private codeAction(layout: Layout, selected: number, act: Action): boolean {
    const spans = layout.spans;
    const index = Math.min(selected, spans.length - 1);
    let next: number | undefined;
    switch (act) {
      case "back":
      case "code":
        this.mode = { kind: "blocks" };
        this.move(spans[index].block);
        return true;
      case "left":
        next = Math.max(index - 1, 0);
        break;
      case "right":
        next = Math.min(index + 1, spans.length - 1);
        break;
      case "down":
      case "up":
        next = rowNeighbor(spans, index, act === "down" ? 1 : -1);
        break;
      case "top":
        next = 0;
        break;
      case "bottom":
        next = spans.length - 1;
        break;
    }
    if (next === undefined) return false;
    this.selectSpan(layout, next);
    return true;
  }

  private selectSpan(layout: Layout, index: number): void {
    this.mode = { kind: "code", index };
    this.move(layout.spans[index].block);
  }

  private blockAction(layout: Layout, mode: BlocksMode, act: Action): boolean {
    const last = this.blocks.length - 1;
    const message = this.blocks[this.cursor].message;
    const messageStart = (m: number) => this.blocks.findIndex((b) => b.message === m);
    const nextMessage = this.blocks.findIndex((b) => b.message > message);
    switch (act) {
      case "back":
        if (mode.anchor === undefined) {
          this.done(undefined);
          return false;
        }
        mode.anchor = undefined;
        return true;
      case "down":
        this.move(Math.min(this.cursor + 1, last));
        return true;
      case "up":
        this.move(Math.max(this.cursor - 1, 0));
        return true;
      case "nextMessage":
        this.move(nextMessage === -1 ? last : nextMessage);
        return true;
      case "prevMessage": {
        const start = messageStart(message);
        this.move(this.cursor > start || message === 0 ? start : messageStart(message - 1));
        return true;
      }
      case "top":
        this.move(0);
        return true;
      case "bottom":
        this.move(last);
        return true;
      case "search":
      case "searchBack":
        mode.search = { query: "", origin: this.cursor, backward: act === "searchBack" };
        this.matches = [];
        this.current = undefined;
        return true;
      case "next":
      case "prev":
        if (!this.query) return false;
        this.jump(this.query, this.backward !== (act === "prev"), this.cursor, mode.anchor !== undefined);
        return true;
      case "range":
        mode.anchor = mode.anchor === undefined ? this.cursor : undefined;
        return true;
      case "messageRange":
        mode.anchor = messageStart(message);
        this.move(nextMessage === -1 ? last : nextMessage - 1);
        return true;
      case "code":
        this.enterCode(layout);
        return true;
      default:
        return false;
    }
  }

  // Selects the first code span in or after the cursor block, or the last one when there is none.
  private enterCode(layout: Layout): void {
    const spans = layout.spans;
    if (spans.length === 0) {
      this.notice = { text: "No inline code in agent messages", error: true };
      return;
    }
    const next = spans.findIndex((s) => s.block >= this.cursor);
    this.selectSpan(layout, next === -1 ? spans.length - 1 : next);
  }

  // While the user types, the cursor goes to the first match from the start position, as Vim incsearch does.
  private handleSearchInput(layout: Layout, mode: BlocksMode, search: Search, data: string): void {
    const key = decodeKittyPrintable(data) ?? data;
    if (matchesKey(data, "escape") || (matchesKey(data, "backspace") && !search.query)) {
      mode.search = undefined;
      this.notice = undefined;
      this.matches = findMatches(layout, this.query);
      this.move(search.origin);
    } else if (matchesKey(data, "enter")) {
      mode.search = undefined;
      this.backward = search.backward;
      // An empty query repeats the last search, as in Vim.
      if (search.query) {
        this.query = search.query;
      } else {
        this.matches = findMatches(layout, this.query);
        if (this.query) this.jump(this.query, search.backward, search.origin);
      }
    } else if (matchesKey(data, "backspace")) {
      search.query = [...search.query].slice(0, -1).join("");
      this.incremental(layout, search);
    } else if (/^[^\x00-\x1f\x7f]+$/.test(key)) {
      search.query += key;
      this.incremental(layout, search);
    } else {
      return;
    }
    this.tui.requestRender();
  }

  private incremental(layout: Layout, search: Search): void {
    this.notice = undefined;
    this.matches = findMatches(layout, search.query);
    if (search.query) this.jump(search.query, search.backward, search.origin);
    else this.move(search.origin);
  }

  // The current match is a match object, so a new layout, which makes new matches, has no current match.
  private currentIndex(): number {
    return this.current ? this.matches.indexOf(this.current) : -1;
  }

  private jump(query: string, backward: boolean, origin: number, byBlock = false): void {
    const current = this.currentIndex();
    const next = nextMatch(this.matches, current === -1 ? undefined : current, origin, backward, byBlock);
    if (!next) {
      this.notice = { text: `Pattern not found: ${query}`, error: true };
      this.move(origin);
      return;
    }
    if (next.wrapped) {
      const text = backward ? "search hit TOP, continuing at BOTTOM" : "search hit BOTTOM, continuing at TOP";
      this.notice = { text, error: false };
    }
    const match = this.matches[next.index];
    this.move(match.block, match);
  }

  private move(target: number, match?: Match): void {
    this.cursor = target;
    this.current = match;
    this.pendingReveal = true;
  }

  private target(layout: Layout): Target {
    const spans = layout.spans;
    if (this.mode.kind === "code" && spans.length > 0) return this.spanTarget(spans[Math.min(this.mode.index, spans.length - 1)]);
    return this.blockTarget(layout, this.mode.kind === "blocks" ? this.mode.anchor : undefined);
  }

  private spanTarget(span: Span): Target {
    const paint: Paint = (layout, owner, lines) => {
      if (owner !== span.owner) return lines;
      if (this.spanPaint?.span !== span) this.spanPaint = { span, ranges: spanRanges(layout, span) };
      const result = lines.slice();
      for (const { row, start, end } of this.spanPaint.ranges) {
        if (row < result.length) result[row] = highlightLine(result[row], [{ start, end, style: this.spanStyle }]);
      }
      return result;
    };
    return {
      owner: span.owner,
      rows: [span.start[0], span.end[0]],
      paint,
      copy: { result: { kind: "text", text: span.text } },
      copyAlt: { result: { kind: "text", text: span.raw } },
      hints: [["h/l", "prev/next"], ["j/k", "row"], ["y", "copy"], ["Y", "copy with backticks"], ["w/esc", "blocks"]],
    };
  }

  private blockTarget(layout: Layout, anchor: number | undefined): Target {
    const from = Math.min(anchor ?? this.cursor, this.cursor);
    const to = Math.max(anchor ?? this.cursor, this.cursor);
    const first = this.blocks[from];
    const single = from === to;
    const paint = (inner: boolean): Paint => (layout, owner, lines) => this.paintBlocks(layout, owner, lines, from, to, inner);
    let copy: Copy;
    let copyAlt: Copy;
    let copyHints: Array<[string, string]>;
    // One code block, a Mermaid block too, shows only its code rows, without fences.
    const inner = single && first.kind === "text" && first.code !== undefined;
    if (single && first.kind === "image") {
      const image = { data: first.image.base64Data, mimeType: first.image.mimeType, path: first.path };
      copy = { result: { kind: "image", image, path: false } };
      copyAlt = { result: { kind: "image", image, path: true } };
      copyHints = [["y", "copy image"], ["Y", "copy path"]];
    } else if (single && first.kind === "text" && first.diagram) {
      copy = { result: { kind: "diagram", diagram: first.diagram } };
      copyAlt = { result: { kind: "text", text: first.diagram.source } };
      copyHints = [["y", "copy image"], ["Y", "copy source"]];
    } else {
      // Only one code block gives its code without fences. Y shows the raw selection, fences
      // included, for a moment before the copy.
      const code = single && first.kind === "text" ? first.code : undefined;
      copy = { result: { kind: "text", text: code ?? this.selectionText(from, to) } };
      copyAlt = { result: { kind: "text", text: this.selectionText(from, to) }, flash: paint(false) };
      copyHints = [["y", "copy"], ["Y", "copy raw"]];
    }
    const current = this.matches[this.currentIndex()];
    const focus = current?.block === this.cursor ? current.row : undefined;
    return {
      owner: this.blocks[this.cursor].owner,
      rows: this.blockRows(layout, this.cursor, inner),
      focus,
      paint: paint(inner),
      copy,
      copyAlt,
      hints: [
        ["j/k", "block"],
        ["{/}", "msg"],
        ["v", "range"],
        ["V", "msg range"],
        ["/ ?", "search"],
        ["w", "code"],
        ...(this.query ? [["n/N", anchor === undefined ? "next/prev" : "next/prev block"] as [string, string]] : []),
        ...copyHints,
        ["esc", "exit"],
      ],
    };
  }

  // A nested block is already in the raw text of its selected container.
  private selectionText(from: number, to: number): string {
    return this.blocks
      .slice(from, to + 1)
      .filter((b) => b.kind === "image" || b.container === undefined || b.container < from)
      .map((b) => (b.kind === "text" ? b.raw : (b.path ?? `[image ${b.image.mimeType}]`)))
      .join("\n\n");
  }

  // Gives the rows of a block in its owner. With `inner`, a code block gives only its code
  // rows, without the two fence rows.
  private blockRows(layout: Layout, index: number, inner: boolean): Rows | undefined {
    const rows = layout.rows[index];
    const block = this.blocks[index];
    if (!rows) return undefined;
    const trim = inner && block.kind === "text" && block.code !== undefined && rows[1] - rows[0] >= 2 ? 1 : 0;
    return [rows[0] + trim, rows[1] - trim];
  }

  render(width: number): string[] {
    const layout = this.layout();
    if (this.pendingReveal) {
      this.pendingReveal = false;
      this.reveal(layout);
    }

    const theme = this.theme;
    const block = this.blocks[this.cursor];
    const count = this.matches.length;
    const current = this.currentIndex();
    const counter = count === 0 ? "" : theme.fg("muted", ` [${current === -1 ? "-" : current + 1}/${count}]`);
    const notice = this.notice ? "  " + theme.fg(this.notice.error ? "error" : "warning", this.notice.text) : "";
    const mode = this.mode;
    if (mode.kind === "blocks" && mode.search) {
      const prompt = theme.fg("accent", mode.search.backward ? "?" : "/") + mode.search.query + theme.inverse(" ");
      return statusLine(theme, width, ` ${prompt}${counter}${notice}`, [["enter", "keep"], ["esc", "cancel"]]);
    }
    const target = this.target(layout);
    const spans = layout.spans;
    if (mode.kind === "code" && spans.length > 0) {
      const index = Math.min(mode.index, spans.length - 1);
      const position = theme.fg("muted", `code ${index + 1}/${spans.length} · msg ${this.blocks[spans[index].block].message + 1}`);
      return statusLine(theme, width, `${theme.fg("success", theme.bold(" CODE "))} ${position}${notice}`, target.hints);
    }

    const anchor = mode.kind === "blocks" ? mode.anchor : undefined;
    const inMessage = this.blocks.filter((b) => b.message === block.message);
    const label = anchor === undefined
      ? theme.fg("accent", theme.bold(" COPY "))
      : theme.fg("warning", theme.bold(` VISUAL ${Math.abs(this.cursor - anchor) + 1} `));
    const position = theme.fg(
      "muted",
      `msg ${block.message + 1}/${this.blocks[this.blocks.length - 1].message + 1}` +
        ` · block ${inMessage.indexOf(block) + 1}/${inMessage.length}`,
    );
    const searchState = this.query ? theme.fg("muted", `  ${this.backward ? "?" : "/"}${this.query}`) + counter : "";
    return statusLine(theme, width, `${label} ${position}${searchState}${notice}`, target.hints);
  }

  // Marks each match in the message rows, and the current match in its own color.
  private highlight(owner: Owner, lines: string[]): string[] {
    const rows = new Map<number, Array<Range & { style: Style }>>();
    for (const match of this.matches) {
      if (match.owner !== owner) continue;
      const style = match === this.current ? this.matchStyles.current : this.matchStyles.other;
      const ranges = rows.get(match.row) ?? [];
      ranges.push({ start: match.start, end: match.end, style });
      rows.set(match.row, ranges);
    }
    if (rows.size === 0) return lines;
    const result = lines.slice();
    for (const [row, ranges] of rows) {
      if (row < result.length) result[row] = highlightLine(result[row], ranges);
    }
    return result;
  }

  private decorate(owner: Owner, rendered: string[]): string[] {
    const layout = this.layout();
    const lines = this.highlight(owner, rendered);
    return (this.flash ?? this.target(layout).paint)(layout, owner, lines);
  }

  private paintBlocks(layout: Layout, owner: Owner, lines: string[], from: number, to: number, inner: boolean): string[] {
    let span: Rows | undefined;
    let cursor: Rows | undefined;
    for (let i = from; i <= to; i++) {
      if (this.blocks[i].owner !== owner) continue;
      const rows = this.blockRows(layout, i, inner);
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
        result[row] = result[row] + open + " ".repeat(layout.width) + close;
        continue;
      }
      const line = result[row].replace(BAR_SLOT, (_, prefix: string) => prefix + this.theme.fg(marker, "▌"));
      result[row] = open + line.replace(RESET, (reset) => reset + open) + close;
    }
    return result;
  }

  // The row of the owner in the transcript comes from base renders each time, because the transcript grows.
  private reveal(layout: Layout): void {
    const view = this.scrollView;
    const target = this.target(layout);
    if (!view || !target.rows) return;
    const owner = offsetOf(view.child, target.owner, layout.width);
    if (owner === undefined) return;

    const margin = 2;
    const top = owner + target.rows[0] - margin;
    const bottom = owner + target.rows[1] + margin;
    if (target.focus !== undefined && bottom - top + 1 > view.viewportHeight) {
      // The block is taller than the view, so the view goes to the focus row and puts it in the middle.
      const row = owner + target.focus;
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
