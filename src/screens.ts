/**
 * The frames the app draws.
 *
 * Front (72x16): by default an overview of the day, a line of state over the
 * day's timeline; a meeting's card (the service's mark, its title and time)
 * only as a warning or when the wheel picks it. Colours follow BUSY: a meeting
 * under way is busy red, one about to start is amber, free time is green.
 *
 * Back (160x80 in grey, the right 12 px are the firmware's status bar): the
 * agenda from the meeting under way on, with the service's mark and day
 * headers, and one line of notice at the bottom.
 */

import type { DisplayDrawParams } from "@busy-app/busy-lib";

import type { Instance } from "./agenda.ts";
import type { Alert } from "./alerts.ts";
import { smallText } from "./glyphs.ts";
import { logoXpm } from "./logos.ts";
import type { Vendor } from "./sources.ts";

export type Element = DisplayDrawParams["elements"][number];

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FRONT_W = 72;
const BACK_W = 148;
/** Where the text starts, after the mark. */
const TEXT_X = 10;

const WHITE = "#FFFFFFFF";
const GREY = "#9AA0A6FF";
/** A meeting under way: busy, as BUSY itself shows it. */
export const BUSY_RED = "#F2453DFF";
/** A meeting about to start. */
export const SOON_AMBER = "#F5A623FF";
/** Warning backgrounds: dark shades of their colour, so the text over them is the brightest thing. */
const SOON_BG = "#4A3000FF";
const NOW_BG = "#5A100CFF";

const BACK_WHITE = "#FFFFFFFF";
const BACK_LIGHT = "#C0C0C0FF";
const BACK_GREY = "#808080FF";
const BACK_DARK = "#505050FF";


const SCROLL = { scroll_rate: 1500, scroll_start_delay: 1200, scroll_repeat_delay: 2000 };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The bar's wall clock for an instant, as a Date read with getUTC*(). */
function local(t: number, offset: number): Date {
  return new Date(t + offset * MIN);
}

export function hm(t: number, offset: number): string {
  const d = local(t, offset);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function dayIndex(t: number, offset: number): number {
  return Math.floor((t + offset * MIN) / DAY);
}

/** "Today", "Tomorrow", "Thu", or "Nov 26" further on. */
export function dayLabel(t: number, now: number, offset: number): string {
  const diff = dayIndex(t, offset) - dayIndex(now, offset);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const d = local(t, offset);
  if (diff > 1 && diff < 7) return DAYS[d.getUTCDay()];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function longDate(t: number, offset: number): string {
  const d = local(t, offset);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * A span of time the way a person says it: "25 min", "1h 20m". Rounded up, so
 * "in 1 min" never shows for a meeting already under way. Under a minute the
 * screens show the firmware's countdown with seconds instead.
 */
export function span(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MIN));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

function text(id: string, value: string, x: number, y: number, color: string, options: Partial<Record<string, unknown>> = {}): Element {
  return {
    id,
    type: "text",
    display: "front",
    align: "top_left",
    x,
    y,
    text: value === "" ? " " : smallText(value),
    font: "small",
    color,
    z_index: 2,
    ...options,
  } as Element;
}

function rect(id: string, x: number, y: number, width: number, height: number, color: string): Element {
  // border_width 0: the firmware's default is a 1 px white border.
  return { id, type: "rectangle", display: "front", x, y, width, height, fill: "solid", fill_colors: [color], border_width: 0, z_index: 0 } as Element;
}

function picture(id: string, data: string, x: number, y: number, display: "front" | "back", z = 1): Element {
  return { id, type: "xpmbitmap", display, align: "top_left", x, y, data, z_index: z } as Element;
}

function countdown(id: string, to: number, x: number, y: number, color: string): Element {
  return {
    id, type: "countdown", display: "front", align: "top_left", x, y,
    timestamp: String(Math.round(to / 1000)), direction: "time_left", show_hours: "when_non_zero", color, z_index: 2,
  } as Element;
}

/** A title on the first line, scrolling when long. */
function title(value: string, color: string): Element {
  return text("l1", value === "" ? "(no title)" : value, TEXT_X, 0, color, { width: FRONT_W - TEXT_X, ...SCROLL });
}

/** "in 25 min", or the firmware's ticking seconds in the last minute. */
function until(prefix: string, to: number, now: number, color: string, suffix = ""): Element[] {
  if (to - now <= MIN && to > now) return [text("l2", prefix, TEXT_X, 7, color), countdown("cd", to, TEXT_X + 4 * prefix.length + 2, 7, color)];
  return [text("l2", `${prefix} ${span(to - now)}${suffix}`.trim(), TEXT_X, 7, color)];
}

/** The hours a day's timeline shows at least, in the bar's local time; meetings outside widen it. */
const DAY_FROM_HOUR = 8;
const DAY_TO_HOUR = 20;
const TIMELINE_COLORS = { past: "#5F6368", busy: "#F2453D", next: "#C8CCD2", free: "#3C4043", now: "#FFFFFF", tick: "#5F6368", picked: "#F5A623" };

/** The span a timeline of the day holding `day` shows, as instants: 08:00 to 20:00, widened to whole hours around that day's meetings. */
export function daySpan(agenda: readonly Instance[], day: number, offset: number): { from: number; to: number } {
  const midnight = Math.floor((day + offset * MIN) / DAY) * DAY - offset * MIN;
  let from = midnight + DAY_FROM_HOUR * HOUR;
  let to = midnight + DAY_TO_HOUR * HOUR;
  for (let i = 0; i < agenda.length; i += 1) {
    const m = agenda[i];
    if (m.allDay || m.end <= midnight || m.start >= midnight + DAY) continue;
    from = Math.min(from, Math.max(midnight, m.start));
    to = Math.max(to, Math.min(midnight + DAY, m.end));
  }
  from = midnight + Math.floor((from - midnight) / HOUR) * HOUR;
  to = midnight + Math.ceil((to - midnight) / HOUR) * HOUR;
  return { from, to };
}

/**
 * The day as a picture `height` pixels high and as wide as the front screen:
 * meetings as blocks (past dim, under way red, later light, free dark), the
 * moment now as a white line, the hours as ticks on the bottom row. With
 * `picked`, that meeting is amber: the card on screen shows where it sits in its day.
 */
export function timelineXpm(agenda: readonly Instance[], now: number, offset: number, height: number, picked: Instance | null = null): string {
  const day = picked !== null ? picked.start : now;
  const { from, to } = daySpan(agenda, day, offset);
  const px = (to - from) / FRONT_W;
  const blockTop = height > 2 ? 1 : 0;
  const blockBottom = height > 2 ? height - 3 : height - 1;
  const rows: string[][] = [];
  for (let y = 0; y < height; y += 1) rows.push(new Array(FRONT_W).fill(" "));
  for (let x = 0; x < FRONT_W; x += 1) {
    const t0 = from + x * px;
    const t1 = t0 + px;
    let c = " ";
    for (let i = 0; i < agenda.length; i += 1) {
      const m = agenda[i];
      if (m.start >= t1) break;
      if (m.allDay || m.end <= t0) continue;
      const kind = picked !== null && m === picked ? "a" : m.free ? "f" : m.end <= now ? "p" : m.start <= now ? "b" : "n";
      // The picked meeting wins, then the one under way, then any meeting over free time.
      const rank = (k: string) => (k === "a" ? 5 : k === "b" ? 4 : k === "n" ? 3 : k === "p" ? 2 : k === "f" ? 1 : 0);
      if (rank(kind) > rank(c)) c = kind;
    }
    if (c !== " ") for (let y = blockTop; y <= blockBottom; y += 1) rows[y][x] = c;
  }
  if (height > 2) {
    // An hour tick on the bottom row.
    for (let t = from; t <= to; t += HOUR) {
      const x = Math.min(FRONT_W - 1, Math.round((t - from) / px));
      rows[height - 1][x] = "t";
    }
    if (now >= from && now < to && picked === null) {
      const x = Math.min(FRONT_W - 1, Math.floor((now - from) / px));
      for (let y = 0; y < height; y += 1) rows[y][x] = "w";
    }
  }
  const c = TIMELINE_COLORS;
  return ["! XPM2", `${FRONT_W} ${height} 8 1`, "  c none", `p c ${c.past}`, `b c ${c.busy}`, `n c ${c.next}`, `f c ${c.free}`, `w c ${c.now}`, `t c ${c.tick}`, `a c ${c.picked}`, ...rows.map((r) => r.join(""))].join("\n");
}

export interface FrontState {
  now: number;
  offset: number;
  configured: boolean;
  loaded: boolean;
  /** Every calendar failed its first read: the links themselves are wrong. */
  broken?: boolean;
  alert: Alert | null;
  /** The meeting under way, if any. */
  current: Instance | null;
  next: Instance | null;
  /** Set while the wheel browses the agenda. */
  browsed: Instance | null;
  /** A short message over everything else, for a moment. */
  toast: string;
  agenda: readonly Instance[];
  /** The service of each calendar, by its place in the settings. */
  vendors: readonly Vendor[];
}

/** The calm colour of free time: available, the way a status light says it. */
const FREE_GREEN = "#3FC069FF";

/**
 * The front screen. By default it is an overview of the day (a status line and
 * the day's timeline), not any one meeting: a meeting's card comes up only as a
 * warning, or when the wheel picks it, so a card on screen always means
 * something and does not turn into wallpaper.
 */
export function frontFrame(s: FrontState): { elements: Element[]; led: string | null } {
  if (s.toast !== "") return { elements: [text("l1", s.toast, 2, 0, WHITE, { width: 70, ...SCROLL })], led: null };
  if (s.broken) {
    return { elements: [text("l1", "CHECK THE LINK", FRONT_W / 2, 0, WHITE, { align: "top_mid" }), text("l2", "SEE BACK SCREEN", FRONT_W / 2, 7, GREY, { align: "top_mid" })], led: null };
  }
  if (!s.configured) {
    // As Host Load and Net Traffic do: a short signal here, what to do on the back.
    return { elements: [text("l1", "ADD A CALENDAR", FRONT_W / 2, 0, WHITE, { align: "top_mid" }), text("l2", "SEE BACK SCREEN", FRONT_W / 2, 7, GREY, { align: "top_mid" })], led: null };
  }
  const logo = (x: Instance) => picture("logo", logoXpm(s.vendors[x.source] || "other"), 0, 4, "front");
  if (s.alert !== null) {
    const x = s.alert.instance;
    if (s.alert.kind === "soon") {
      return {
        elements: [rect("bg", 0, 0, FRONT_W, 16, SOON_BG), logo(x), title(x.title, WHITE), ...until("in", x.start, s.now, SOON_AMBER), text("l3", hm(x.start, s.offset), 71, 7, SOON_AMBER, { align: "top_right" })],
        led: SOON_AMBER,
      };
    }
    return {
      elements: [rect("bg", 0, 0, FRONT_W, 16, NOW_BG), logo(x), title(x.title, WHITE), text("l2", "Now", TEXT_X, 7, BUSY_RED), text("l3", `${span(x.end - s.now)} left`, 71, 7, BUSY_RED, { align: "top_right" })],
      led: BUSY_RED,
    };
  }
  if (s.browsed !== null) {
    // A card picked with the wheel: what, when, and on the bottom row where it sits in its day.
    const x = s.browsed;
    const when = x.allDay ? `${dayLabel(x.start, s.now, s.offset)}, all day` : `${dayLabel(x.start, s.now, s.offset)} ${hm(x.start, s.offset)}-${hm(x.end, s.offset)}`;
    const elements = [logo(x), title(x.title, WHITE), text("l2", when, TEXT_X, 6, GREY, { width: FRONT_W - TEXT_X, ...SCROLL })];
    if (!x.allDay) elements.push(picture("tl", timelineXpm(s.agenda, s.now, s.offset, 1, x), 0, 15, "front", 0));
    return { elements, led: null };
  }
  if (!s.loaded) return { elements: [text("l1", "iCal Calendar", 2, 0, WHITE), text("l2", "Loading...", 2, 7, GREY)], led: null };

  // The overview: one line of state, the day below it.
  const elements: Element[] = [];
  const today = dayIndex(s.now, s.offset);
  const laterToday = s.next !== null && dayIndex(s.next.start, s.offset) === today;
  if (s.current !== null && !s.current.free) {
    // "In meeting" and the time left fill the 72 px: "left" is understood.
    elements.push(text("l1", "In meeting", 0, -1, BUSY_RED), text("l3", span(s.current.end - s.now), 71, -1, WHITE, { align: "top_right" }));
  } else if (laterToday && s.next !== null) {
    elements.push(text("l1", "Today", 0, -1, WHITE), text("l3", `next ${hm(s.next.start, s.offset)}`, 71, -1, GREY, { align: "top_right" }));
  } else if (s.next !== null) {
    elements.push(text("l1", "Free", 0, -1, FREE_GREEN), text("l3", `${dayLabel(s.next.start, s.now, s.offset)} ${hm(s.next.start, s.offset)}`, 71, -1, GREY, { align: "top_right" }));
  } else {
    elements.push(text("l1", "Free all week", 0, -1, FREE_GREEN));
  }
  elements.push(picture("tl", timelineXpm(s.agenda, s.now, s.offset, 7), 0, 9, "front", 0));
  return { elements, led: null };
}

function backText(id: string, value: string, x: number, y: number, color: string, width?: number): Element {
  return {
    id,
    type: "text",
    display: "back",
    align: "top_left",
    x,
    y,
    text: value === "" ? " " : smallText(value),
    // `normal` on the back: 7 px capitals on a 12 px line, against `small`'s 5 on 9.
    font: "normal",
    color,
    z_index: 2,
    ...(width !== undefined ? { width, scroll_rate: 0 } : {}),
  } as Element;
}

function backRect(id: string, x: number, y: number, width: number, height: number, color: string): Element {
  return { id, type: "rectangle", display: "back", x, y, width, height, fill: "solid", fill_colors: [color], border_width: 0, z_index: 1 } as Element;
}

export interface BackState {
  now: number;
  offset: number;
  agenda: readonly Instance[];
  showAllDay: boolean;
  notice: string;
  updated: number;
  /** The instance the wheel is on, to mark it. */
  browsed: Instance | null;
  vendors: readonly Vendor[];
}

// The back's rows in `normal` (measured on the bar 23.11: "10:00" 25 px, "all day" 32, capitals on rows 2..8 of the line).
const ROW_H = 12;
const FIRST_ROW = 12;
const NOTICE_Y = 68;
const TIME_X = 13;
const TITLE_X = 50;

/** Rows of the agenda from the meeting under way on, with a header line for each new day. */
export function backFrame(s: BackState): Element[] {
  const elements: Element[] = [backText("b_date", longDate(s.now, s.offset), 0, 0, BACK_WHITE)];
  if (s.updated > 0) {
    const ago = Math.max(0, Math.round((s.now - s.updated) / MIN));
    elements.push({ ...backText("b_upd", ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`, BACK_W - 2, 0, BACK_GREY), align: "top_right" } as Element);
  }
  const list = s.agenda.filter((x) => x.end > s.now && (s.showAllDay || !x.allDay));
  const ROWS = s.notice !== "" ? 4 : 5;
  let row = 0;
  let day = dayIndex(s.now, s.offset);
  for (let i = 0; i < list.length && row < ROWS; i += 1) {
    const x = list[i];
    const d = Math.max(day, dayIndex(x.start, s.offset));
    if (d !== day) {
      day = d;
      if (row >= ROWS - 1) break;
      elements.push(backText(`b_h${row}`, dayLabel(x.start, s.now, s.offset), 0, FIRST_ROW + row * ROW_H, BACK_GREY));
      row += 1;
    }
    const y = FIRST_ROW + row * ROW_H;
    const on = x.start <= s.now && !x.allDay;
    const marked = s.browsed !== null && s.browsed.start === x.start && s.browsed.uid === x.uid;
    if (on || marked) elements.push(backRect(`b_m${row}`, 0, y + 2, 2, 7, BACK_WHITE));
    elements.push(picture(`b_g${row}`, logoXpm(s.vendors[x.source] || "other"), 3, y + 1, "back"));
    elements.push(backText(`b_t${row}`, x.allDay ? "all day" : hm(x.start, s.offset), TIME_X, y, on ? BACK_WHITE : BACK_GREY));
    elements.push(backText(`b_n${row}`, x.title === "" ? "(no title)" : x.title, TITLE_X, y, x.free ? BACK_DARK : on ? BACK_WHITE : BACK_LIGHT, BACK_W - TITLE_X));
    row += 1;
  }
  if (list.length === 0) elements.push(backText("b_none", "Nothing more this week", 0, FIRST_ROW, BACK_GREY));
  // A long notice runs along its line rather than being cut.
  if (s.notice !== "") elements.push({ ...backText("b_note", s.notice, 0, NOTICE_Y, BACK_GREY, BACK_W), ...SCROLL } as Element);
  return elements;
}
