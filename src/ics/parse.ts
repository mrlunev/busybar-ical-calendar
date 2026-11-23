/**
 * Streaming iCal parser: lines in, the few events the app can show out.
 *
 * Only VEVENT and VTIMEZONE are looked at. An event is kept when it can reach
 * the window the app shows (a day back, a week ahead): a single event by its
 * dates, a repeating one ("master", with RRULE) while its UNTIL is not past, a
 * moved or cancelled instance (RECURRENCE-ID) when either of its dates is near.
 * Everything else is dropped as soon as its END:VEVENT is read, so a calendar of
 * any size passes through a small, fixed amount of memory.
 *
 * Times are kept as they are written ("wall" time plus the zone they are in):
 * the zones may be defined anywhere in the file, so turning them into instants
 * waits until the end (tz.ts). Until then a window test allows 14 hours either
 * way, the widest offset from UTC.
 */

import { cleanText } from "../glyphs.ts";

/** A date or date-time as written: its wall clock as if it were UTC, and the zone it is in. */
export interface DateValue {
  /** Date.UTC() of the written fields. */
  readonly wall: number;
  /** "Z" for UTC, "" for floating (the viewer's own time), otherwise the TZID. */
  readonly tz: string;
  readonly allDay: boolean;
}

export interface IcsEvent {
  uid: string;
  start: DateValue;
  end: DateValue | null;
  /** From DURATION, in ms; -1 when there is none. */
  durationMs: number;
  rrule: string | null;
  exdates: DateValue[] | null;
  recurrenceId: DateValue | null;
  cancelled: boolean;
  /** TRANSP:TRANSPARENT or Microsoft's BUSYSTATUS FREE: shown, never alerted. */
  free: boolean;
  title: string;
  location: string;
}

/** One STANDARD or DAYLIGHT block of a VTIMEZONE. */
export interface Observance {
  /** Wall time of the first onset (DTSTART), in the offset before it. */
  start: number;
  /** Offsets in minutes east of UTC. */
  from: number;
  to: number;
  /** The yearly rule (RRULE value), if any. */
  rule: string | null;
  /** Explicit onsets (RDATE), wall times. */
  rdates: number[] | null;
}

export type Zones = Record<string, Observance[]>;

export interface ParseResult {
  events: IcsEvent[];
  zones: Zones;
  /** X-WR-TIMEZONE: the calendar's own zone, for floating times. */
  calendarTz: string;
  /** BEGIN:VCALENDAR was read: the body is a calendar at all (not an HTML page). */
  calendar: boolean;
  /** END:VCALENDAR was read: the body is complete. */
  complete: boolean;
  /** DTSTART of the last event read in full, in file order: where a cut-off body stops being trustworthy. */
  lastStart: DateValue | null;
  /** Events read in full, kept, and dropped for the limits. */
  seen: number;
  overflow: boolean;
}

/** The widest offset from UTC, as a margin before zones are known. */
const MARGIN = 14 * 3600 * 1000;
/** Per calendar: enough for a busy week, small enough for the heap. */
export const MAX_SINGLES = 300;
export const MAX_MASTERS = 200;
const TITLE_MAX = 40;

const WANTED_IN_EVENT = [
  "UID", "DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE", "RECURRENCE-ID",
  "STATUS", "TRANSP", "SUMMARY", "LOCATION", "X-MICROSOFT-CDO-BUSYSTATUS", "BEGIN", "END",
];
const WANTED_IN_ZONE = ["TZID", "DTSTART", "TZOFFSETFROM", "TZOFFSETTO", "RRULE", "RDATE", "BEGIN", "END"];

function startsWithAny(line: string, names: readonly string[]): boolean {
  for (let i = 0; i < names.length; i += 1) {
    const n = names[i];
    if (line.startsWith(n)) {
      const c = line.charCodeAt(n.length);
      // The name must end there: "DTSTART;" or "DTSTART:", not "DTSTARTX".
      if (c === 58 || c === 59) return true;
    }
  }
  return false;
}

/** Splits "NAME;P=1;Q=\"a:b\":value" at the first colon outside quotes. */
function splitProperty(line: string): { name: string; params: string; value: string } | null {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (c === 34) quoted = !quoted;
    else if (c === 58 && !quoted) {
      const head = line.slice(0, i);
      const semi = head.indexOf(";");
      return {
        name: semi < 0 ? head : head.slice(0, semi),
        params: semi < 0 ? "" : head.slice(semi + 1),
        value: line.slice(i + 1),
      };
    }
  }
  return null;
}

function param(params: string, key: string): string {
  if (params === "") return "";
  let quoted = false;
  let startOfPart = 0;
  for (let i = 0; i <= params.length; i += 1) {
    const c = i < params.length ? params.charCodeAt(i) : 59;
    if (c === 34) quoted = !quoted;
    else if (c === 59 && !quoted) {
      const part = params.slice(startOfPart, i);
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(0, eq).toUpperCase() === key) {
        return cleanTzid(part.slice(eq + 1));
      }
      startOfPart = i + 1;
    }
  }
  return "";
}

/** Quotes, spaces and the NUL padding some Exchange servers leave are not part of a zone name. */
export function cleanTzid(value: string): string {
  let v = value;
  const nul = v.indexOf("\u0000");
  if (nul >= 0) v = v.slice(0, nul);
  v = v.trim();
  if (v.length >= 2 && v.charCodeAt(0) === 34 && v.charCodeAt(v.length - 1) === 34) v = v.slice(1, -1);
  return v.trim();
}

/** "20261118T093000Z", "20261118T093000" or "20261118". Null if it is not a date. */
export function parseDate(value: string, params: string): DateValue | null {
  const v = value.trim();
  if (v.length < 8) return null;
  const y = +v.slice(0, 4);
  const mo = +v.slice(4, 6) - 1;
  const d = +v.slice(6, 8);
  if (!(y > 1600) || !(mo >= 0 && mo < 12) || !(d >= 1 && d <= 31)) return null;
  if (v.length < 15 || v.charCodeAt(8) !== 84) {
    return { wall: Date.UTC(y, mo, d), tz: "", allDay: true };
  }
  const wall = Date.UTC(y, mo, d, +v.slice(9, 11), +v.slice(11, 13), +v.slice(13, 15));
  if (!(wall === wall)) return null;
  if (v.charCodeAt(15) === 90) return { wall, tz: "Z", allDay: false };
  return { wall, tz: param(params, "TZID"), allDay: false };
}

/** "PT1H30M", "P1D", "-PT15M", "P1W" in ms; NaN if not a duration. */
export function parseDuration(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (m === null) return NaN;
  const ms = ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 86400 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/** 32-bit FNV-1a of a string, in base 36. */
export function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** "+0100" or "-0430" in minutes. */
function parseOffset(value: string): number {
  const m = /^([+-])(\d\d)(\d\d)/.exec(value.trim());
  if (m === null) return 0;
  const minutes = +m[2] * 60 + +m[3];
  return m[1] === "-" ? -minutes : minutes;
}

/** TEXT values: \n, \, and \; back to what they stand for, without emoji; cut to what the screens can show. */
function text(value: string): string {
  let out = value.length > TITLE_MAX * 3 ? value.slice(0, TITLE_MAX * 3) : value;
  if (out.indexOf("\\") >= 0) {
    out = out.replace(/\\[nN]/g, " ").replace(/\\([,;\\])/g, "$1");
  }
  out = cleanText(out);
  return out.length > TITLE_MAX ? out.slice(0, TITLE_MAX) : out;
}

/** UNTIL of a rule, as a wall time (UTC ones are already instants). Infinity when there is none. */
function untilOf(rule: string): number {
  const i = rule.indexOf("UNTIL=");
  if (i < 0) return Infinity;
  const end = rule.indexOf(";", i);
  const d = parseDate(rule.slice(i + 6, end < 0 ? rule.length : end), "");
  return d === null ? Infinity : d.allDay ? d.wall + 86400000 : d.wall;
}

export interface ParserOptions {
  /** The window the app shows, as instants. */
  from: number;
  to: number;
}

export class IcsParser {
  readonly result: ParseResult = {
    events: [],
    zones: {},
    calendarTz: "",
    calendar: false,
    complete: false,
    lastStart: null,
    seen: 0,
    overflow: false,
  };

  private singles = 0;
  private masters = 0;
  private event: IcsEvent | null = null;
  /** Depth inside the event: VALARM blocks nested in it are skipped. */
  private nested = 0;
  private zoneId: string | null = null;
  private observance: Observance | null = null;
  private inCalendar = false;

  private readonly options: ParserOptions;

  constructor(options: ParserOptions) {
    this.options = options;
  }

  /** Whether a line is worth joining and handing to `line`: cheap, by its name. */
  wanted = (first: string): boolean => {
    if (this.event !== null) return startsWithAny(first, WANTED_IN_EVENT);
    if (this.zoneId !== null) return startsWithAny(first, WANTED_IN_ZONE);
    return first.charCodeAt(0) === 66 /* B */ || first.charCodeAt(0) === 69 /* E */ || first.startsWith("X-WR-TIMEZONE");
  };

  line = (line: string): void => {
    const p = splitProperty(line);
    if (p === null) return;
    const name = p.name.toUpperCase();
    if (name === "BEGIN") this.begin(p.value.trim().toUpperCase());
    else if (name === "END") this.end(p.value.trim().toUpperCase());
    else if (this.event !== null) {
      if (this.nested === 0) this.eventProperty(this.event, name, p.params, p.value);
    } else if (this.observance !== null) this.observanceProperty(this.observance, name, p.params, p.value);
    else if (this.zoneId !== null && name === "TZID") this.zoneId = cleanTzid(p.value);
    else if (name === "X-WR-TIMEZONE") this.result.calendarTz = cleanTzid(p.value);
  };

  private begin(what: string): void {
    if (this.event !== null) {
      this.nested += 1;
      return;
    }
    if (what === "VCALENDAR") {
      this.inCalendar = true;
      this.result.calendar = true;
    }
    else if (what === "VEVENT") {
      this.event = {
        uid: "", start: { wall: NaN, tz: "", allDay: false }, end: null, durationMs: -1, rrule: null,
        exdates: null, recurrenceId: null, cancelled: false, free: false, title: "", location: "",
      };
      this.nested = 0;
    } else if (what === "VTIMEZONE") this.zoneId = "";
    else if ((what === "STANDARD" || what === "DAYLIGHT") && this.zoneId !== null) {
      this.observance = { start: 0, from: 0, to: 0, rule: null, rdates: null };
    }
  }

  private end(what: string): void {
    if (this.event !== null) {
      if (this.nested > 0) {
        this.nested -= 1;
        return;
      }
      if (what === "VEVENT") {
        const event = this.event;
        this.event = null;
        this.finishEvent(event);
      }
      return;
    }
    if ((what === "STANDARD" || what === "DAYLIGHT") && this.observance !== null && this.zoneId !== null) {
      const list = this.result.zones[this.zoneId] || (this.result.zones[this.zoneId] = []);
      list.push(this.observance);
      this.observance = null;
    } else if (what === "VTIMEZONE") {
      this.zoneId = null;
      this.observance = null;
    } else if (what === "VCALENDAR" && this.inCalendar) this.result.complete = true;
  }

  private eventProperty(e: IcsEvent, name: string, params: string, value: string): void {
    switch (name) {
      case "UID":
        // Kept as a short hash: Microsoft's UIDs run past a hundred characters, and only equality matters.
        e.uid = hash(value.trim());
        break;
      case "DTSTART": {
        const d = parseDate(value, params);
        if (d !== null) e.start = d;
        break;
      }
      case "DTEND":
        e.end = parseDate(value, params);
        break;
      case "DURATION": {
        const ms = parseDuration(value);
        if (ms === ms) e.durationMs = ms;
        break;
      }
      case "RRULE":
        e.rrule = value.trim().toUpperCase();
        break;
      case "EXDATE": {
        const list = e.exdates || (e.exdates = []);
        const parts = value.split(",");
        for (let i = 0; i < parts.length; i += 1) {
          const d = parseDate(parts[i], params);
          if (d !== null) list.push(d);
        }
        break;
      }
      case "RECURRENCE-ID":
        e.recurrenceId = parseDate(value, params);
        break;
      case "STATUS":
        e.cancelled = value.trim().toUpperCase() === "CANCELLED";
        break;
      case "TRANSP":
        if (value.trim().toUpperCase() === "TRANSPARENT") e.free = true;
        break;
      case "X-MICROSOFT-CDO-BUSYSTATUS":
        if (value.trim().toUpperCase() === "FREE") e.free = true;
        break;
      case "SUMMARY":
        e.title = text(value);
        break;
      case "LOCATION":
        e.location = text(value);
        break;
    }
  }

  private observanceProperty(o: Observance, name: string, params: string, value: string): void {
    if (name === "DTSTART") {
      const d = parseDate(value, params);
      if (d !== null) o.start = d.wall;
    } else if (name === "TZOFFSETFROM") o.from = parseOffset(value);
    else if (name === "TZOFFSETTO") o.to = parseOffset(value);
    else if (name === "RRULE") o.rule = value.trim().toUpperCase();
    else if (name === "RDATE") {
      const list = o.rdates || (o.rdates = []);
      const parts = value.split(",");
      for (let i = 0; i < parts.length; i += 1) {
        const d = parseDate(parts[i], params);
        if (d !== null) list.push(d.wall);
      }
    }
  }

  private finishEvent(e: IcsEvent): void {
    if (!(e.start.wall === e.start.wall)) return;
    this.result.seen += 1;
    this.result.lastStart = e.start;
    const from = this.options.from - MARGIN;
    const to = this.options.to + MARGIN;
    let keep: boolean;
    if (e.rrule !== null && e.recurrenceId === null) {
      // A series: kept while it has not ended and has started by the end of the window.
      keep = e.start.wall <= to && untilOf(e.rrule) >= from;
      if (keep) {
        if (this.masters >= MAX_MASTERS) {
          this.result.overflow = true;
          return;
        }
        this.masters += 1;
      }
    } else {
      const end = e.end !== null ? e.end.wall : e.start.wall + (e.durationMs > 0 ? e.durationMs : e.start.allDay ? 86400000 : 0);
      const near = end >= from && e.start.wall <= to;
      // A moved instance also matters where it was moved from: it takes the series' instance out of the window.
      keep = near || (e.recurrenceId !== null && e.recurrenceId.wall >= from && e.recurrenceId.wall <= to);
      if (keep) {
        if (this.singles >= MAX_SINGLES) {
          this.result.overflow = true;
          return;
        }
        this.singles += 1;
      }
    }
    if (keep) this.result.events.push(e);
  }
}
