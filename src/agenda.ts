/**
 * One calendar's parsed events become instances in the window; several
 * calendars become one agenda.
 */

import type { DateValue, IcsEvent, ParseResult } from "./ics/parse.ts";
import { expand, parseRule } from "./ics/rrule.ts";
import { ZoneResolver } from "./ics/tz.ts";

const DAY = 86400000;
const MARGIN = 14 * 3600 * 1000;

export interface Instance {
  /** Instants, ms. `end` is exclusive. */
  start: number;
  end: number;
  allDay: boolean;
  title: string;
  location: string;
  /** Index of the calendar in the settings. */
  source: number;
  uid: string;
  free: boolean;
}

export interface Window {
  from: number;
  to: number;
  /** The bar's offset from UTC now, in minutes. */
  barOffset: number;
}

/** Length of an event, from DTEND or DURATION, in ms of wall time. */
function lengthOf(e: IcsEvent): number {
  if (e.end !== null) return Math.max(0, e.end.wall - e.start.wall);
  if (e.durationMs >= 0) return e.durationMs;
  return e.start.allDay ? DAY : 0;
}

function make(e: IcsEvent, start: number, end: number, source: number): Instance {
  return { start, end, allDay: e.start.allDay, title: e.title, location: e.location, source, uid: e.uid, free: e.free };
}

/** Instances of one calendar that overlap the window, in no particular order. */
export function instancesOf(parsed: ParseResult, source: number, w: Window): Instance[] {
  const zones = new ZoneResolver(parsed.zones, parsed.calendarTz, w.barOffset);
  const out: Instance[] = [];
  const at = (d: DateValue) => zones.instant(d);

  // Moved or cancelled instances of series, by series and by the instant they replace.
  const overrides: Record<string, IcsEvent[]> = {};
  const masters: IcsEvent[] = [];
  for (let i = 0; i < parsed.events.length; i += 1) {
    const e = parsed.events[i];
    if (e.recurrenceId !== null) (overrides[e.uid] || (overrides[e.uid] = [])).push(e);
    else if (e.rrule !== null) masters.push(e);
    else if (!e.cancelled) {
      const start = at(e.start);
      const end = e.start.allDay ? start + lengthOf(e) : e.end !== null ? at(e.end) : start + lengthOf(e);
      out.push(make(e, start, Math.max(start, end), source));
    }
  }

  const used: IcsEvent[] = [];
  for (let i = 0; i < masters.length; i += 1) {
    const m = masters[i];
    const rule = parseRule(m.rrule as string);
    const length = lengthOf(m);
    const toInstant = (wall: number) => at({ wall, tz: m.start.tz, allDay: m.start.allDay });
    const walls = rule === null
      ? [m.start.wall]
      : expand(rule, m.start.wall, w.from - MARGIN - length, w.to + MARGIN, toInstant);
    const excluded: number[] = [];
    if (m.exdates !== null) for (let k = 0; k < m.exdates.length; k += 1) excluded.push(at(m.exdates[k]));
    const moved = overrides[m.uid] || [];
    for (let k = 0; k < walls.length; k += 1) {
      const start = toInstant(walls[k]);
      if (excluded.indexOf(start) >= 0) continue;
      let replacement: IcsEvent | null = null;
      for (let j = 0; j < moved.length; j += 1) {
        if (at(moved[j].recurrenceId as DateValue) === start) replacement = moved[j];
      }
      if (replacement !== null) {
        used.push(replacement);
        if (replacement.cancelled) continue;
        const s = at(replacement.start);
        const e = replacement.end !== null ? at(replacement.end) : s + lengthOf(replacement);
        out.push(make(replacement, s, Math.max(s, e), source));
        continue;
      }
      const end = m.start.allDay ? start + length : toInstant(walls[k] + length);
      out.push(make(m, start, end, source));
    }
  }

  // Overrides whose instance the series did not produce (its master is missing, or it was moved into the window).
  for (const uid in overrides) {
    const list = overrides[uid];
    for (let j = 0; j < list.length; j += 1) {
      const o = list[j];
      if (used.indexOf(o) >= 0 || o.cancelled) continue;
      const s = at(o.start);
      const e = o.end !== null ? at(o.end) : s + lengthOf(o);
      out.push(make(o, s, Math.max(s, e), source));
    }
  }

  return out.filter((x) => x.end > w.from && x.start < w.to && (x.end > x.start || x.start >= w.from));
}

/**
 * All calendars together, by start; the same meeting in two calendars once
 * (the same UID and start, or the same start, end and title).
 */
export function mergeAgenda(lists: readonly Instance[][]): Instance[] {
  const all: Instance[] = [];
  for (let i = 0; i < lists.length; i += 1) for (let k = 0; k < lists[i].length; k += 1) all.push(lists[i][k]);
  all.sort((a, b) => a.start - b.start || a.end - b.end || a.source - b.source);
  const out: Instance[] = [];
  for (let i = 0; i < all.length; i += 1) {
    const x = all[i];
    let duplicate = false;
    for (let k = out.length - 1; k >= 0 && out[k].start === x.start; k -= 1) {
      const y = out[k];
      if ((x.uid !== "" && x.uid === y.uid) || (x.end === y.end && x.title === y.title)) duplicate = true;
    }
    if (!duplicate) out.push(x);
  }
  return out;
}
