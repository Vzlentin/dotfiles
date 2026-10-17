import { stripTerminalSequences } from "@earendil-works/pi-tui";

// One terminal sequence: CSI, OSC, APC or a two-byte escape.
export const ESCAPE = /\x1b(?:\[[0-9;:?<=>]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x1b]*\x1b\\|[@-Z\\-_])/y;

export interface Range {
  start: number;
  end: number;
}

export type Style = [string, string];

export function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim() === "";
}

// Gives the visible text of a rendered line, and the position in the line of each code unit of it.
export function plainText(line: string): { text: string; index: number[] } {
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
export function occurrences(text: string, query: string): number[] {
  const fold = query === query.toLowerCase();
  const haystack = fold ? text.toLowerCase() : text;
  const found: number[] = [];
  for (let at = haystack.indexOf(query); at !== -1; at = haystack.indexOf(query, at + query.length)) found.push(at);
  return found;
}

// Puts each visible character of the ranges between the open and close sequences of its range.
// Each character gets its own sequences, so the colors of the line cannot cancel them.
export function highlightLine(line: string, ranges: Array<Range & { style: Style }>): string {
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
export function inverseRuns(line: string): Range[] {
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
