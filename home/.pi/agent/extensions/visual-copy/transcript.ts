import { homedir } from "node:os";
import { resolve } from "node:path";
import { Marked, type Component, type TUI } from "@earendil-works/pi-tui";
import { inverseRuns, isBlank, occurrences, plainText, type Range } from "./ansi.ts";
import type { Diagram } from "./clipboard.ts";

// Pi has no public API for the transcript, so /vc reads the live component tree.
// These are the internal shapes it depends on.
export interface Node extends Component {
  children?: Node[];
}

export interface MarkdownNode extends Node {
  text: string;
  paddingX: number;
  theme: { code(text: string): string };
  options?: { transform?: (text: string, width: number) => string };
  cachedTokens?: WeakRef<{ tokens: Token[] }>;
  renderToken(token: Token, ...rest: unknown[]): string[];
  renderInlineTokens(tokens: Token[], ...rest: unknown[]): string;
}

export interface AssistantNode extends Node {
  contentContainer: Node;
  updateContent: unknown;
}

export interface ImageNode extends Node {
  base64Data: string;
  mimeType: string;
}

export interface ToolNode extends Node {
  toolName: string;
  args?: Record<string, unknown>;
  cwd?: string;
  imageComponents: ImageNode[];
}

export type Owner = AssistantNode | ToolNode;

export interface ScrollViewNode {
  child: Node;
  scrollTop: number;
  viewportHeight: number;
  isFollowingEnd: boolean;
  getContentWidth(width: number): number;
  scrollTo(top: number, options?: { disableFollow?: boolean }): void;
  scrollToEnd(): void;
}

export interface Token {
  type: string;
  lang?: string;
  raw: string;
  text?: string;
  tokens?: Token[];
  items?: Array<{ raw: string; tokens: Token[] }>;
}

export type Rows = [number, number];
export type Position = [number, number];

// A selectable part of the transcript. A text block is a top-level element, a list item or a
// code block of one Markdown node. `container` is the index of the block around it, such as
// the list item around a code block.
export interface TextBlock {
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
export interface ImageBlock {
  kind: "image";
  owner: ToolNode;
  image: ImageNode;
  path?: string;
  message: number;
}

export type Block = TextBlock | ImageBlock;

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
export interface Span extends SpanPosition {
  block: number;
  owner: AssistantNode;
  markdown: MarkdownNode;
}

// The geometry of the blocks at one width. Rows are rows in the owner. `offsets` gives the row
// of each Markdown node in its owner. `owners` gives the rendered rows of each assistant
// message and its blocks, for search.
export interface Layout {
  width: number;
  rows: Array<Rows | undefined>;
  offsets: Map<MarkdownNode, number>;
  owners: Array<{ owner: AssistantNode; lines: string[]; blocks: number[] }>;
  spans: Span[];
}

// One match of the search query: a row of a rendered assistant message, and the
// columns in its visible text. `block` is the innermost block that has the row.
export interface Match {
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

export function isAssistant(node: unknown): node is AssistantNode {
  const n = node as Partial<AssistantNode> | undefined;
  return typeof n?.updateContent === "function" && Array.isArray(n.contentContainer?.children);
}

export function isTool(node: unknown): node is ToolNode {
  const n = node as Partial<ToolNode> | undefined;
  return typeof n?.toolName === "string" && Array.isArray(n.imageComponents);
}

export function findOwners(root: Node, found: Owner[] = []): Owner[] {
  if (isAssistant(root) || isTool(root)) found.push(root);
  else for (const child of root.children ?? []) findOwners(child, found);
  return found;
}

// Gives the absolute path of the file that a tool such as read opened, if there is one.
export function toolPath(tool: ToolNode): string | undefined {
  const value = tool.args?.path ?? tool.args?.file_path;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const path = value.trim().replace(/^@/, "").replace(/^~(?=\/|$)/, homedir());
  return resolve(tool.cwd ?? process.cwd(), path);
}

function textParts(owner: AssistantNode): MarkdownNode[] {
  return (owner.contentContainer.children ?? []).filter(isMarkdown);
}

// The width that the transcript gets when it renders.
export function scrollViewOf(tui: TUI): ScrollViewNode | undefined {
  return (tui as unknown as { getPrimaryScrollView?: () => ScrollViewNode }).getPrimaryScrollView?.();
}

export function contentWidth(tui: TUI): number {
  return scrollViewOf(tui)?.getContentWidth(tui.terminal.columns) ?? tui.terminal.columns;
}

// /vc puts its own render on each owner, so the rows of an owner come from the class render.
export function baseRender(owner: Owner, width: number): string[] {
  return (Object.getPrototypeOf(owner) as Node).render.call(owner, width);
}

// Gives the row of `target` inside the rendered output of `root`. Owners give their base
// rows, so the count does not decorate them.
export function offsetOf(root: Node, target: Node, width: number): number | undefined {
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
export function probe(markdown: MarkdownNode, patch: Partial<MarkdownNode>, width: number): string[] {
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
export function innermost(ranges: Array<Rows | undefined>, row: number): number | undefined {
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
export function markdownLayout(markdown: MarkdownNode, width: number): { segments: Segment[]; spans: SpanPosition[] } {
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

export function collectBlocks(document: Node, width: number): Block[] {
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
export function isGone(block: Block): boolean {
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

export function buildLayout(blocks: Block[], width: number): Layout {
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
export function findMatches(layout: Layout, query: string): Match[] {
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
export function nextMatch(
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
export function spanRanges(layout: Layout, span: Span): Array<Range & { row: number }> {
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
