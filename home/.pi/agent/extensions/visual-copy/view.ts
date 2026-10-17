import type { Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { highlightLine, type Range, type Style } from "./ansi.ts";
import type { Diagram, ImageRef } from "./clipboard.ts";
import {
  baseRender,
  buildLayout,
  contentWidth,
  findMatches,
  isGone,
  isTool,
  nextMatch,
  offsetOf,
  scrollViewOf,
  spanRanges,
  type Block,
  type Layout,
  type Match,
  type Owner,
  type Rows,
  type ScrollViewNode,
  type Span,
} from "./transcript.ts";

export type CopyResult =
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

export class VisualCopy implements Component {
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
