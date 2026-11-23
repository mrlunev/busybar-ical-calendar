/**
 * The front screen's timeline (Figma "Apps for BUSY Bar Catalog", page ical): the days ahead as one page 72 px wide,
 * an hour 33 px tall, which the 72x16 front display shows a window of; the wheel moves the window pixel by pixel.
 *
 * - The day's name sticks to the top left, the time at the window's top edge to the top right (in 5 minute steps);
 *   the next day or hour pushes them up when it comes. Both lie under the plates; where an hour's number is over a
 *   plate, that part takes the plate's border colour.
 * - A meeting is a plate: the service's 4x4 mark (left out when only one calendar is set up), the time, the title
 *   wrapped when the plate is tall enough, otherwise a marquee fading out at the plate's edge. Meetings that overlap
 *   stand side by side, each over the one before it (by 4 px for two, 2 px for three or more) with a light shadow.
 * - All-day events open each day: a grey band fading into the black, a row an event with the service's mark.
 * - Hour lines are dots over everything, at 25 % opacity: over a plate they lighten it as Screen would.
 * - The red line is now; its time's colon blinks.
 * - The picker on the left stays mid-screen. The plate or all-day row under it lights up; side-by-side plates under
 *   it share their rows, left to right going down.
 *
 * The firmware cannot scroll a region: every step is one draw request with the elements that moved, at about 3 ms
 * an element. So what can be one element is one: a plate's mark and time, an hour's number and the red time are
 * XPM images drawn from the firmware's own glyphs. The page's layout is worked out once (`buildTimeline`); a frame
 * only places what is in the window.
 */

import type { Instance } from "./agenda.ts";
import { cleanText, fitsSmall } from "./glyphs.ts";
import type { Vendor } from "./sources.ts";

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const HOUR_PX = 33;
/** The first midnight line on the page, leaving room for the day's name above it. */
const TOP = 12;
const W = 72;
/** The picker's row on screen. */
export const PICK_Y = 8;
const ALLDAY_TOP = 7;
const ALLDAY_ROW = 8;
/** "HH:MM" in tiny, right-aligned at 71, starts at x 54; the plates end at x 62. */
const LABEL_X = 54;

const DIM = "#363843FF";
const LIGHT = "#8E9099FF";
export const RED = "#FF5656FF";
const RED_DIM = "#6B2A2AFF";
const WHITE = "#FFFFFFFF";
const FREE_TEXT = "#A9ADB8FF";

export type Element = Record<string, unknown> & { id: string; y: number };

// ---- the services: plates and marks ------------------------------------------------------------------------------

interface Look { fill: string; lit: string; border: string; text: string; mark: string[]; colors: Record<string, string> }

/** A 4x4 mark with a 1 px shadow to its lower right ("s"), as 5 rows. */
const shadowed = (rows: string[]) => [`${rows[0]} `, `${rows[1]}s`, `${rows[2]}s`, `${rows[3]}s`, " ssss"];

const LOOKS: Record<Vendor, Look> = {
  microsoft: { fill: "15253A", lit: "1E3655", border: "24406A", text: "#C4ECFCFF", mark: shadowed(["aaaa", "bbbb", "bbbb", "bbbb"]), colors: { a: "#0A4FA3", b: "#28A8EA" } },
  google: { fill: "202C40", lit: "2D3E5A", border: "34466A", text: "#D0E1FDFF", mark: shadowed(["bbby", "bwwy", "bwwy", "gggg"]), colors: { b: "#4285F4", w: "#FFFFFF", y: "#FBBC04", g: "#34A853" } },
  apple: { fill: "2E1E22", lit: "432A30", border: "5A3640", text: "#FFD9D6FF", mark: shadowed(["rrrr", "wwww", "wkkw", "wwww"]), colors: { r: "#FF3B30", w: "#FFFFFF", k: "#1C1C1E" } },
  proton: { fill: "241F3D", lit: "342C57", border: "46397A", text: "#DED6FFFF", mark: shadowed(["pppp", "pwwp", "pwwp", "pppp"]), colors: { p: "#6D4AFF", w: "#FFFFFF" } },
  fastmail: { fill: "132A40", lit: "1C3B5A", border: "22507A", text: "#CDE6FFFF", mark: shadowed(["nnnn", "wnnw", "wwww", "nnnn"]), colors: { n: "#0067B9", w: "#FFFFFF" } },
  other: { fill: "24272D", lit: "33373F", border: "4A4F59", text: "#E2E4E8FF", mark: shadowed(["gggg", "wwww", "wkkw", "wwww"]), colors: { g: "#8A8F98", w: "#E8EAED", k: "#5F6368" } },
};
const look = (v: Vendor | undefined) => LOOKS[v || "other"];

/** The border of the plate under the picker: halfway from its own border to near white. */
function litBorder(border: string): string {
  const near = [0xdd, 0xe2, 0xea];
  let out = "#";
  for (let i = 0; i < 3; i += 1) out += Math.round((parseInt(border.slice(i * 2, i * 2 + 2), 16) + near[i]) / 2).toString(16).padStart(2, "0");
  return `${out}FF`;
}

/** Screen-blends a grey over a colour "RRGGBB". */
function screenOver(rgb: number[], fill: string): string {
  let out = "#";
  for (let i = 0; i < 3; i += 1) out += Math.round(255 - ((255 - rgb[i]) * (255 - parseInt(fill.slice(i * 2, i * 2 + 2), 16))) / 255).toString(16).padStart(2, "0");
  return `${out}FF`;
}

// ---- glyphs ---------------------------------------------------------------------------------------------------------

/** Widths of the firmware's `small` glyphs, measured on the bar (1.4.1); a glyph is followed by 1 px. */
const SMALL: Record<string, number> = { "0": 3, "1": 2, "2": 3, "3": 3, "4": 3, "5": 3, "6": 3, "7": 3, "8": 3, "9": 3, A: 4, B: 4, C: 4, D: 4, E: 4, F: 4, G: 4, H: 4, I: 1, J: 3, K: 4, L: 3, M: 5, N: 4, O: 4, P: 4, Q: 4, R: 4, S: 4, T: 3, U: 4, V: 3, W: 5, X: 3, Y: 3, Z: 3, "-": 2, "[": 2, "]": 2, ":": 1, ",": 1, ".": 1, "'": 1, "&": 4, "/": 2, "(": 2, ")": 2, "!": 1, "?": 3, "+": 3 };
export function textWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charAt(i);
    w += c === " " ? 3 : (SMALL[c] ?? 4) + 1;
  }
  return Math.max(0, w - 1);
}

/** The firmware's `tiny` digits, colon and dash, read off the bar's screen (1.4.1): rows 1..4 of a text's box. */
const TINY: Record<string, string[]> = {
  "0": [".#.", "#.#", "#.#", ".#."], "1": [".#.", "##.", ".#.", "###"], "2": ["##.", "..#", "#..", "###"],
  "3": ["##.", ".##", "..#", "##."], "4": ["..#", "#.#", "###", "..#"], "5": ["###", "#..", "..#", "##."],
  "6": [".##", "#..", "###", "###"], "7": ["###", "..#", ".#.", "#.."], "8": [".#.", "###", "#.#", ".#."],
  "9": [".##", "#.#", "###", "..#"], ":": [".", "#", ".", "#"], "-": ["...", "...", "###", "..."],
};
/** A tiny string as 4 rows, glyphs 1 px apart; `paint(x)` names the colour key of a lit pixel at column x. */
function tinyRows(value: string, paint: (x: number) => string): string[] {
  const rows = ["", "", "", ""];
  for (let k = 0; k < value.length; k += 1) {
    const g = TINY[value.charAt(k)] || TINY["-"];
    if (k > 0) for (let r = 0; r < 4; r += 1) rows[r] += " ";
    for (let r = 0; r < 4; r += 1) {
      let line = "";
      for (let c = 0; c < g[r].length; c += 1) line += g[r].charAt(c) === "#" ? paint(rows[r].length + c) : " ";
      rows[r] += line;
    }
  }
  return rows;
}
const tinyWidth = (value: string) => tinyRows(value, () => "x")[0].length;
function xpmOf(rows: string[], colors: Record<string, string>): string {
  const keys = Object.keys(colors);
  const lines = ["! XPM2", `${rows[0].length} ${rows.length} ${keys.length + 1} 1`, "  c none"];
  for (let i = 0; i < keys.length; i += 1) lines.push(`${keys[i]} c ${colors[keys[i]].slice(0, 7)}`);
  return lines.concat(rows).join("\n");
}
let dotsRow = "";
for (let i = 0; i < 71; i += 1) dotsRow += i % 2 === 0 ? "d" : " ";
const DOTS_XPM = ["! XPM2", "71 1 2 1", "  c none", "d c #D8E0FF", dotsRow].join("\n");
const PICKER_XPM = ["! XPM2", "2 3 2 1", "  c none", "w c #FFFFFF", "w ", "ww", "w "].join("\n");

// Both image caches are bounded: a label differs for every 5 minutes of the week and every shade of an all-day band,
// the red time for every minute, and the heap is 128 KiB (a day of scrolling grew the label cache by about 37 KiB).
const LABEL_CACHE_MAX = 48;
let labelCache: Record<string, string> = {};
let labelCount = 0;
/** An "HH:MM" label from x 54: columns up to x 62 in `over` (a plate's border) when given, the rest in `ground`. */
function labelXpm(value: string, ground: string, over: string | null): string {
  const key = `${value}${ground}${over}`;
  let data = labelCache[key];
  if (data === undefined) {
    const rows = tinyRows(value, (x) => (over !== null && LABEL_X + x <= 62 ? "b" : "g"));
    data = xpmOf(rows, over !== null ? { g: ground, b: over } : { g: ground });
    if (labelCount >= LABEL_CACHE_MAX) {
      labelCache = {};
      labelCount = 0;
    }
    labelCache[key] = data;
    labelCount += 1;
  }
  return data;
}
/** The red time of the current minute only, with the colon lit and dimmed. */
let nowLabel = "";
const nowData: string[] = ["", ""];
/** The red time as one image, the colon (column 8) in its own colour so it can dim. */
export function nowXpm(label: string, colon: boolean): string {
  if (label !== nowLabel) {
    nowLabel = label;
    nowData[0] = "";
    nowData[1] = "";
  }
  const k = colon ? 0 : 1;
  if (nowData[k] === "") nowData[k] = xpmOf(tinyRows(label, (x) => (x === 8 ? "c" : "r")), { r: RED, c: colon ? RED : RED_DIM });
  return nowData[k];
}

// ---- elements ------------------------------------------------------------------------------------------------------

// Fields at their default are left out (display "front", align "top_left"): a shorter body, less to parse.
const text = (id: string, value: string, font: string, x: number, y: number, color: string, z: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: "text", text: value, font, x, y, color, z_index: z, ...extra });
const rect = (id: string, x: number, y: number, w: number, h: number, color: string, z: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: "rectangle", x, y, width: w, height: h, fill: "solid", fill_colors: [color], border_width: 0, z_index: z, ...extra });
const xpm = (id: string, data: string, x: number, y: number, z: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: "xpmbitmap", data, x, y, z_index: z, ...extra });
const img = (id: string, name: string, x: number, y: number, z: number): Element => ({ id, type: "image", path: `images/${name}.png`, x, y, z_index: z });

/** Over everything but now and the picker. */
const Z_DOTS = 27;
const Z_NOW = 28;
const Z_PICKER = 40;
const MARQUEE = { scroll_rate: 1200, scroll_start_delay: 1000, scroll_repeat_delay: 1500 };

/**
 * An element of this frame. `key` changes whenever the element does. Elements that only move carry their place
 * (`y`) and look (`v`), so the sender can shift the element it sent last time instead of building it again.
 */
export interface Want { id: string; key: string; make: () => Element; y?: number; v?: string }

// ---- layout --------------------------------------------------------------------------------------------------------

export interface TimelineInput {
  agenda: readonly Instance[];
  /** Today's local midnight, as an instant. */
  dayStart: number;
  /** The bar's offset from UTC, minutes. */
  offset: number;
  days: number;
  vendors: readonly Vendor[];
  marks: boolean;
  allDay: boolean;
}

interface Plate {
  instance: Instance;
  y: number;
  h: number;
  x: number;
  w: number;
  /** How much of it the next column leaves visible. */
  vis: number;
  /** Later columns lie over earlier ones. */
  zo: number;
  look: Look;
  head: string;
  lines: string[] | null;
  title: string;
  shadow: boolean;
  /** The plates of its cluster under the picker share rows; -1 when alone. */
  cluster: number;
}
interface Row { instance: Instance; y: number; look: Look; title: string }

let input: TimelineInput;
let band: number[] = [];
let plates: Plate[] = [];
let rows: Row[] = [];
let clusterCount = 0;
let tallest = 1;

const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const localHM = (t: number, offset: number) => {
  const d = new Date(t + offset * MIN);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function dayName(d: number): string {
  if (d === 0) return "TODAY";
  if (d === 1) return "TMRW";
  const date = new Date(input.dayStart + d * DAY + input.offset * MIN);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** The line of day d's midnight. */
function dayLine(d: number): number {
  let y = TOP + d * 24 * HOUR_PX;
  for (let k = 0; k < d && k < band.length; k += 1) y += band[k];
  return y;
}
const dayOf = (t: number) => Math.floor((t - input.dayStart) / DAY);
/** A time's place on the page: the day's line, its all-day band, then HOUR_PX an hour. */
function pageY(t: number): number {
  const d = Math.max(0, Math.min(input.days - 1, dayOf(t)));
  return dayLine(d) + band[d] + Math.round(((t - input.dayStart - d * DAY) / HOUR) * HOUR_PX);
}
/** The hour line h hours after today's midnight. */
function hourLine(h: number): number {
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? dayLine(d) : dayLine(d) + band[d] + (h % 24) * HOUR_PX;
}
const pageEnd = () => dayLine(input.days) + 4;

/** Titles are drawn in capitals in `small`; what it cannot draw is simplified or replaced. */
function plainTitle(raw: string): string {
  let t = cleanText(raw === "" ? "(no title)" : raw).toUpperCase();
  if (!fitsSmall(t)) {
    try {
      t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    } catch {
      // No normalize on this engine: the characters are replaced below.
    }
    let out = "";
    for (let i = 0; i < t.length; i += 1) out += fitsSmall(t.charAt(i)) ? t.charAt(i) : "?";
    t = out;
  }
  return t;
}

/** The title's lines when the plate is tall enough for all of them, or null for a marquee. */
function wrap(title: string, width: number, room: number): string[] | null {
  const lines: string[] = [];
  let line = "";
  const words = title.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = line === "" ? word : `${line} ${word}`;
    if (textWidth(next) <= width) {
      line = next;
      continue;
    }
    if (line !== "") lines.push(line);
    line = word;
    // A word wider than the line is broken with a hyphen.
    while (textWidth(line) > width && line.length > 2) {
      let cut = line.length - 1;
      while (cut > 1 && textWidth(`${line.slice(0, cut)}-`) > width) cut -= 1;
      lines.push(`${line.slice(0, cut)}-`);
      line = line.slice(cut);
    }
    if (lines.length > room) return null;
  }
  if (line !== "") lines.push(line);
  return lines.length <= room ? lines : null;
}

/** Works out the page for an agenda: call when the agenda, the day or the settings change. */
export function buildTimeline(next: TimelineInput): void {
  input = next;
  const first = input.dayStart;
  const last = input.dayStart + input.days * DAY;
  const timed: Instance[] = [];
  const allDays: Instance[][] = [];
  for (let d = 0; d < input.days; d += 1) allDays.push([]);
  for (let i = 0; i < input.agenda.length; i += 1) {
    const x = input.agenda[i];
    if (x.end <= first || x.start >= last) continue;
    if (x.allDay) {
      if (!input.allDay) continue;
      // An all-day event shows on each of its days in the window.
      for (let d = Math.max(0, dayOf(x.start)); d < input.days && first + d * DAY < x.end; d += 1) allDays[d].push(x);
    } else timed.push(x);
  }
  band = allDays.map((list) => (list.length === 0 ? 0 : ALLDAY_TOP + list.length * ALLDAY_ROW));
  rows = [];
  for (let d = 0; d < input.days; d += 1) {
    for (let k = 0; k < allDays[d].length; k += 1) {
      const x = allDays[d][k];
      rows.push({ instance: x, y: dayLine(d) + ALLDAY_TOP + k * ALLDAY_ROW, look: look(input.vendors[x.source]), title: plainTitle(x.title) });
    }
  }

  // Overlapping meetings: clusters of meetings whose times overlap, side by side.
  timed.sort((a, b) => a.start - b.start || b.end - a.end);
  const clusters: Instance[][] = [];
  let clusterEnd = -Infinity;
  for (let i = 0; i < timed.length; i += 1) {
    const x = timed[i];
    if (clusters.length > 0 && x.start < clusterEnd) {
      clusters[clusters.length - 1].push(x);
      clusterEnd = Math.max(clusterEnd, x.end);
    } else {
      clusters.push([x]);
      clusterEnd = x.end;
    }
  }
  plates = [];
  clusterCount = 0;
  for (let c = 0; c < clusters.length; c += 1) {
    const members = clusters[c];
    const n = members.length;
    const cluster = n > 1 ? clusterCount++ : -1;
    for (let k = 0; k < n; k += 1) {
      const x = members[k];
      const lk = look(input.vendors[x.source]);
      const y = pageY(Math.max(x.start, first));
      const h = Math.max(14, pageY(Math.min(x.end, last)) - y);
      let px = 1;
      let pw = 62;
      let vis = 62;
      let zo = 0;
      if (n > 1) {
        const over = n === 2 ? 4 : 2;
        const full = Math.floor((62 + (n - 1) * over) / n);
        px = 1 + k * (full - over);
        vis = k < n - 1 ? full - over : 62 - (px - 1);
        pw = k < n - 1 ? full : vis;
        zo = 10 * k;
      }
      // The mark goes when the start time would not fit beside it ("HH:MM" in tiny is 17 px).
      const mark = input.marks && vis >= 2 + 6 + 17 + 1;
      const room = vis - (mark ? 9 : 3);
      let time = vis >= 50 ? `${localHM(x.start, input.offset)}-${localHM(x.end, input.offset)}` : localHM(x.start, input.offset);
      while (time.length > 1 && tinyWidth(time) > room) time = time.slice(0, -1);
      const timeRows = tinyRows(time, () => "t");
      const head: string[] = [];
      for (let r = 0; r < 5; r += 1) head.push((mark ? `${lk.mark[r]} ` : "") + (r < 4 ? timeRows[r] : " ".repeat(timeRows[0].length)));
      const colors: Record<string, string> = { t: lk.text };
      if (mark) {
        colors.s = "#000000";
        for (const key in lk.colors) colors[key] = lk.colors[key];
      }
      const title = plainTitle(x.title);
      // A title line takes 7 px; the first needs the plate 14 px tall.
      const lines = wrap(title, vis - 4, h >= 14 ? Math.floor((h - 14) / 7) + 1 : 0);
      plates.push({ instance: x, y, h, x: px, w: pw, vis, zo, look: lk, head: xpmOf(head, colors), lines, title, shadow: n > 1 && k > 0, cluster });
    }
  }
  plates.sort((a, b) => a.y - b.y);
  tallest = 1;
  for (let i = 0; i < plates.length; i += 1) tallest = Math.max(tallest, plates[i].h);
}

/** Where the window stands with the red line at the picker. */
export function homeScroll(now: number): number {
  return clampScroll(pageY(now) - PICK_Y);
}
export function clampScroll(scroll: number): number {
  return Math.max(0, Math.min(pageEnd() - 16, scroll));
}

// ---- a frame -------------------------------------------------------------------------------------------------------

const shadeColors: Record<number, string> = {};
/** The grey of the ground at a page row: black, or an all-day band's gradient blended with the dim grey. */
function groundAt(row: number): string {
  for (let d = 0; d < input.days; d += 1) {
    if (band[d] === 0) continue;
    const top = dayLine(d) + 1;
    const h = band[d] - 1;
    if (row < top || row >= top + h) continue;
    const shade = 1 + Math.round((1 - (row - top) / Math.max(1, h - 1)) * 254);
    let c = shadeColors[shade];
    if (c === undefined) {
      const k = (shade - 1) / 254;
      let grey = "";
      const base = [0x30, 0x33, 0x3d];
      for (let i = 0; i < 3; i += 1) grey += Math.round(base[i] * k).toString(16).padStart(2, "0");
      c = screenOver([0x4a, 0x4d, 0x5a], grey);
      shadeColors[shade] = c;
    }
    return c;
  }
  return DIM;
}

/** What the window shows at `scroll`, and what the picker is on. */
export function timelineFrame(scroll: number, now: number, colon: boolean): { want: Want[]; picked: Instance | null; nowY: number } {
  const want: Want[] = [];
  const top = scroll;
  const bottom = scroll + 16;

  // The first plate that can reach the window, by its place.
  let lo = 0;
  let hi = plates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plates[mid].y < top - tallest) lo = mid + 1;
    else hi = mid;
  }
  const visible: number[] = [];
  for (let i = lo; i < plates.length && plates[i].y < bottom; i += 1) if (plates[i].y + plates[i].h > top) visible.push(i);

  // What the picker is on: a plate (side-by-side ones share their rows) or an all-day row.
  const pickRow = top + PICK_Y;
  let picked = -1;
  let pickedRow = -1;
  const covering: number[] = [];
  let from = -Infinity;
  let to = Infinity;
  for (let k = 0; k < visible.length; k += 1) {
    const p = plates[visible[k]];
    if (p.y + 2 <= pickRow && pickRow < p.y + p.h) {
      covering.push(visible[k]);
      from = Math.max(from, p.y + 2);
      to = Math.min(to, p.y + p.h);
    }
  }
  if (covering.length === 1) picked = covering[0];
  else if (covering.length > 1) {
    // Plates under the picker share the rows where exactly they are under it, left to right going down.
    covering.sort((a, b) => plates[a].x - plates[b].x);
    for (let k = 0; k < visible.length; k += 1) {
      const p = plates[visible[k]];
      if (covering.indexOf(visible[k]) >= 0) continue;
      if (p.y + p.h <= pickRow) from = Math.max(from, p.y + p.h);
      else if (p.y + 2 > pickRow) to = Math.min(to, p.y + 2);
    }
    const zone = Math.floor(((pickRow - from) * covering.length) / Math.max(1, to - from));
    picked = covering[Math.min(covering.length - 1, zone)];
  }
  for (let r = 0; r < rows.length; r += 1) if (rows[r].y + 2 <= pickRow && pickRow < rows[r].y + ALLDAY_ROW) pickedRow = r;

  // Plates.
  for (let k = 0; k < visible.length; k += 1) {
    const i = visible[k];
    const p = plates[i];
    const y = p.y - top;
    const lit = i === picked;
    const v = lit ? "*" : "";
    const fill = lit ? p.look.lit : p.look.fill;
    const z = p.zo;
    const id = `p${i}`;
    want.push({ id, key: `${y}${v}`, y, v, make: () => rect(id, p.x, y, p.w, p.h, `#${fill}FF`, 2 + z, { radius: 2, border_width: 1, border_color: lit ? litBorder(p.look.border) : `#${p.look.border}FF` }) });
    if (p.shadow) {
      want.push({ id: `${id}s`, key: `${y}`, y, v: "", make: () => rect(`${id}s`, p.x - 1, y + 1, 1, p.h - 2, "#00000070", 1 + z) });
      want.push({ id: `${id}S`, key: `${y}`, y, v: "", make: () => rect(`${id}S`, p.x - 2, y + 1, 1, p.h - 2, "#00000038", 1 + z) });
    }
    if (y + 6 > 0 && y + 1 < 16) want.push({ id: `${id}t`, key: `${y}`, y, v: "", make: () => xpm(`${id}t`, p.head, p.x + 2, y + 1, 4 + z) });
    const color = p.instance.free ? FREE_TEXT : WHITE;
    if (p.lines !== null) {
      for (let l = 0; l < p.lines.length; l += 1) {
        const ly = y + 5 + 7 * l;
        if (ly + 8 <= 0 || ly >= 16) continue;
        const line = p.lines[l];
        want.push({ id: `${id}l${l}`, key: `${ly}`, y: ly, v: "", make: () => text(`${id}l${l}`, line, "small", p.x + 2, ly, color, 4 + z) });
      }
    } else if (p.h >= 14 && y + 13 > 0 && y + 5 < 16) {
      want.push({ id: `${id}l0`, key: `${y}`, y, v: "", make: () => text(`${id}l0`, p.title, "small", p.x + 2, y + 5, color, 4 + z, { width: p.vis - 4, ...MARQUEE }) });
      // The marquee fades out at the plate's edge: an image of the fill rising to full opacity.
      want.push({ id: `${id}f`, key: `${y}${v}`, y, v, make: () => img(`${id}f`, `fade_${fill}`, p.x + p.vis - 6, y + 6, 5 + z) });
    }
  }

  // All-day bands and rows.
  for (let d = 0; d < input.days; d += 1) {
    if (band[d] === 0) continue;
    const y = dayLine(d) + 1 - top;
    const h = band[d] - 1;
    if (y + h <= 0 || y >= 16) continue;
    want.push({ id: `b${d}`, key: `${y}`, y, v: "", make: () => rect(`b${d}`, 0, y, W, h, "#30333DFF", 0, { fill: "gradient_v", fill_colors: ["#30333DFF", "#000000FF"] }) });
  }
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const y = row.y - top;
    if (y + ALLDAY_ROW <= 0 || y >= 16) continue;
    const lit = r === pickedRow;
    const v = lit ? "*" : "";
    const x = input.marks ? 8 : 2;
    if (lit) want.push({ id: `a${r}`, key: `${y}`, y, v: "", make: () => rect(`a${r}`, 0, y, W, ALLDAY_ROW, "#454956FF", 1) });
    if (input.marks) want.push({ id: `a${r}m`, key: `${y}`, y, v: "", make: () => xpm(`a${r}m`, xpmOf(row.look.mark, { s: "#000000", ...row.look.colors }), 2, y + 1, 4) });
    want.push({ id: `a${r}t`, key: `${y}${v}`, y, v, make: () => text(`a${r}t`, row.title, "small", x, y - 1, lit ? WHITE : FREE_TEXT, 4, { width: W - x - 1, ...MARQUEE }) });
  }

  // Hour lines: dots over everything.
  const firstHour = Math.max(0, Math.floor((top - TOP) / HOUR_PX) - 1);
  for (let h = firstHour; h <= input.days * 24; h += 1) {
    const y = hourLine(h) - top;
    if (y >= 16) break;
    if (y < 0) continue;
    want.push({ id: `d${h}`, key: `${y}`, y, v: "", make: () => xpm(`d${h}`, DOTS_XPM, 1, y, Z_DOTS, { opacity: 25 }) });
  }

  // Hour numbers: the time at the window's top in the corner, pushed up by the next hour; the part over a plate in its
  // border colour. One image each.
  const plateAt = (row: number) => {
    for (let k = visible.length - 1; k >= 0; k -= 1) {
      const p = plates[visible[k]];
      if (row >= p.y && row < p.y + p.h && p.x + p.w > LABEL_X) return visible[k];
    }
    return -1;
  };
  const hourText = (id: string, label: string, y: number) => {
    const row = top + y + 2;
    const ground = groundAt(row);
    const i = plateAt(row);
    const over = i < 0 ? null : i === picked ? litBorder(plates[i].look.border) : `#${plates[i].look.border}FF`;
    const z = i < 0 ? 1 : 3 + plates[i].zo;
    want.push({ id, key: `${y}${label}${ground}${over}`, make: () => xpm(id, labelXpm(label, ground, over), LABEL_X, y + 1, z) });
  };
  let lastAbove = 0;
  for (let h = firstHour; h <= input.days * 24 && hourLine(h) <= top; h += 1) lastAbove = h;
  const day = Math.min(input.days - 1, Math.floor(lastAbove / 24));
  const into = top - dayLine(day) - band[day];
  const minutes = Math.max(0, Math.min(24 * 60 - 5, Math.floor((into / HOUR_PX) * 12) * 5));
  const corner = `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
  const cornerY = Math.min(-1, hourLine(lastAbove + 1) - top + 1 - 5);
  if (cornerY + 6 > 0) hourText("hc", corner, cornerY);
  for (let h = lastAbove + 1; h <= input.days * 24; h += 1) {
    const y = hourLine(h) - top + 1;
    if (y >= 16) break;
    hourText(`h${h}`, `${two(h % 24)}:00`, y);
  }

  // Day names: in the page at midnight, sticking at the top left until the next one pushes them out. Under the plates.
  let current = 0;
  for (let d = 0; d < input.days; d += 1) if (dayLine(d) + 1 - top <= -1) current = d;
  for (let d = 0; d < input.days; d += 1) {
    let y = dayLine(d) + 1 - top;
    let color = LIGHT;
    if (d === current) {
      y = d + 1 < input.days ? Math.min(-1, dayLine(d + 1) + 1 - top - 5) : -1;
      if (d === 0) color = DIM;
    } else if (y <= -1 || y >= 16) continue;
    if (y + 6 <= 0) continue;
    const name = dayName(d);
    want.push({ id: `n${d}`, key: `${y}${color}`, make: () => text(`n${d}`, name, "tiny", 1, y, color, 1) });
  }

  // Now.
  const ny = pageY(now) - top;
  if (ny >= 0 && ny < 16) want.push({ id: "nl", key: `${ny}`, make: () => rect("nl", 0, ny, W, 1, RED, Z_NOW) });
  if (ny + 7 > 0 && ny + 1 < 16) {
    const label = localHM(now, input.offset);
    want.push({ id: "nt", key: `${ny}${label}${colon}`, make: () => xpm("nt", nowXpm(label, colon), 54, ny + 2, Z_NOW) });
  }
  want.push({ id: "pk", key: "0", make: () => xpm("pk", PICKER_XPM, 0, PICK_Y - 1, Z_PICKER) });

  const pickedInstance = picked >= 0 ? plates[picked].instance : pickedRow >= 0 ? rows[pickedRow].instance : null;
  return { want, picked: pickedInstance, nowY: ny };
}

/** The page of an event the picker opened: its service, time (or "ALL DAY"), how far away, the title. */
export function eventPage(x: Instance, now: number, vendors: readonly Vendor[], offset: number, dayStart: number, marks: boolean): Element[] {
  const lk = look(vendors[x.source]);
  const rel = x.allDay ? "ALL DAY" : now < x.start ? `IN ${Math.ceil((x.start - now) / MIN)}M` : now < x.end ? "NOW" : "ENDED";
  const d = Math.floor((x.start - dayStart) / DAY);
  const tx = marks ? 8 : 2;
  // The start and end, or only the start when both would run into the right-hand label (tiny letters are about 4 px).
  const relWidth = rel.length * 4;
  const both = `${localHM(x.start, offset)}-${localHM(x.end, offset)}`;
  const when = x.allDay ? (d <= 0 ? "TODAY" : d === 1 ? "TMRW" : localHM(x.start, offset)) : tx + tinyWidth(both) + 3 + relWidth <= 71 ? both : localHM(x.start, offset);
  const els: Element[] = [rect("qb", 0, 0, W, 16, `#${x.allDay ? "30333D" : lk.fill}FF`, 50)];
  if (marks) els.push(xpm("qi", xpmOf(lk.mark, { s: "#000000", ...lk.colors }), 2, 1, 51));
  els.push(
    text("qt", when, "tiny", tx, 0, x.allDay ? "#C9CCD4FF" : lk.text, 51),
    text("qr", rel, "tiny", 71, 0, !x.allDay && now >= x.start && now < x.end ? RED : LIGHT, 51, { align: "top_right" }),
    text("ql", plainTitle(x.title), "small", 2, 5, WHITE, 51, { width: 68, ...MARQUEE }),
  );
  return els;
}
