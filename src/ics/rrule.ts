/**
 * Expands a repeating event (RRULE) into its instances inside a window.
 *
 * Works on wall times, in the event's own zone, so a meeting at 10:00 stays at
 * 10:00 across a daylight-saving change; the caller turns each one into an
 * instant. Supported: FREQ DAILY, WEEKLY, MONTHLY, YEARLY; INTERVAL, COUNT,
 * UNTIL; BYDAY (with numbers, "2TU", "-1FR"), BYMONTHDAY (negative too),
 * BYMONTH, BYSETPOS, WKST. That covers what Google, Microsoft, Apple, Fastmail
 * and Nextcloud write (probe of 18.11). BYYEARDAY, BYWEEKNO and HOURLY or finer
 * are left out: such a rule yields its first instance only.
 *
 * Series can be years old, so without COUNT the expansion jumps straight to the
 * window instead of walking from DTSTART.
 */

import { WEEKDAYS, nthWeekday } from "./tz.ts";

const DAY = 86400000;
/** Periods walked at most for one series, whatever the rule says. */
const MAX_PERIODS = 4000;

interface ByDay {
  n: number;
  wd: number;
}

export interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number;
  /** UNTIL as an instant (when written in UTC) or a wall time; Infinity when there is none. */
  until: number;
  untilIsUtc: boolean;
  byday: ByDay[] | null;
  bymonthday: number[] | null;
  bymonth: number[] | null;
  bysetpos: number[] | null;
  wkst: number;
}

function numbers(value: string): number[] | null {
  if (value === "") return null;
  const out: number[] = [];
  const parts = value.split(",");
  for (let i = 0; i < parts.length; i += 1) {
    const n = +parts[i];
    if (n === n && n !== 0) out.push(n);
  }
  return out.length > 0 ? out : null;
}

/** Null for a rule the app cannot expand. */
export function parseRule(text: string): Rule | null {
  const map: Record<string, string> = {};
  const parts = text.split(";");
  for (let i = 0; i < parts.length; i += 1) {
    const eq = parts[i].indexOf("=");
    if (eq > 0) map[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  const freq = map.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  if (map.BYYEARDAY !== undefined || map.BYWEEKNO !== undefined || map.BYHOUR !== undefined) return null;
  let until = Infinity;
  let untilIsUtc = false;
  const u = map.UNTIL;
  if (u !== undefined && u.length >= 8) {
    const y = +u.slice(0, 4);
    const mo = +u.slice(4, 6) - 1;
    const d = +u.slice(6, 8);
    if (u.length >= 15) {
      until = Date.UTC(y, mo, d, +u.slice(9, 11), +u.slice(11, 13), +u.slice(13, 15));
      untilIsUtc = u.charCodeAt(15) === 90;
    } else {
      // A date: the whole day counts.
      until = Date.UTC(y, mo, d) + DAY - 1;
    }
  }
  let byday: ByDay[] | null = null;
  if (map.BYDAY !== undefined) {
    byday = [];
    const days = map.BYDAY.split(",");
    for (let i = 0; i < days.length; i += 1) {
      const m = /^([+-]?\d*)([A-Z]{2})$/.exec(days[i].trim());
      if (m !== null && WEEKDAYS[m[2]] !== undefined) byday.push({ n: m[1] === "" || m[1] === "+" ? 0 : +m[1], wd: WEEKDAYS[m[2]] });
    }
    if (byday.length === 0) byday = null;
  }
  const interval = +(map.INTERVAL || 1);
  return {
    freq,
    interval: interval >= 1 ? interval : 1,
    count: map.COUNT !== undefined ? +map.COUNT : Infinity,
    until,
    untilIsUtc,
    byday,
    bymonthday: numbers(map.BYMONTHDAY || ""),
    bymonth: numbers(map.BYMONTH || ""),
    bysetpos: numbers(map.BYSETPOS || ""),
    wkst: WEEKDAYS[map.WKST || "MO"] !== undefined ? WEEKDAYS[map.WKST || "MO"] : 1,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Days (midnight wall times) of one month the rule picks, before BYSETPOS. */
function monthDays(rule: Rule, year: number, month: number, startDay: number): number[] {
  const count = daysInMonth(year, month);
  const out: number[] = [];
  const add = (day: number) => {
    if (day >= 1 && day <= count) out.push(Date.UTC(year, month, day));
  };
  if (rule.bymonthday !== null) {
    for (let i = 0; i < rule.bymonthday.length; i += 1) {
      const d = rule.bymonthday[i];
      add(d > 0 ? d : count + d + 1);
    }
    if (rule.byday !== null) return out.filter((t) => matchesWeekday(rule.byday as ByDay[], t));
    return out;
  }
  if (rule.byday !== null) {
    for (let i = 0; i < rule.byday.length; i += 1) {
      const b = rule.byday[i];
      if (b.n !== 0) add(nthWeekday(year, month, b.wd, b.n));
      else {
        const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
        for (let d = 1 + ((b.wd - first + 7) % 7); d <= count; d += 7) add(d);
      }
    }
    return out;
  }
  add(startDay);
  return out;
}

function matchesWeekday(byday: readonly ByDay[], t: number): boolean {
  const wd = new Date(t).getUTCDay();
  for (let i = 0; i < byday.length; i += 1) if (byday[i].wd === wd) return true;
  return false;
}

function inMonths(rule: Rule, t: number): boolean {
  if (rule.bymonth === null) return true;
  return rule.bymonth.indexOf(new Date(t).getUTCMonth() + 1) >= 0;
}

/** Candidate days (midnight wall times) of period `p`, sorted, after BYSETPOS. */
function periodDays(rule: Rule, startDayWall: number, p: number): number[] {
  const s = new Date(startDayWall);
  let days: number[] = [];
  switch (rule.freq) {
    case "DAILY": {
      const t = startDayWall + p * rule.interval * DAY;
      if (inMonths(rule, t) && (rule.byday === null || matchesWeekday(rule.byday, t)) &&
        (rule.bymonthday === null || monthDays(rule, new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 0).indexOf(t) >= 0)) {
        days.push(t);
      }
      break;
    }
    case "WEEKLY": {
      const offset = (s.getUTCDay() - rule.wkst + 7) % 7;
      const weekStart = startDayWall - offset * DAY + p * rule.interval * 7 * DAY;
      if (rule.byday === null) days.push(weekStart + offset * DAY);
      else for (let i = 0; i < rule.byday.length; i += 1) days.push(weekStart + ((rule.byday[i].wd - rule.wkst + 7) % 7) * DAY);
      days = days.filter((t) => inMonths(rule, t));
      break;
    }
    case "MONTHLY": {
      const index = s.getUTCFullYear() * 12 + s.getUTCMonth() + p * rule.interval;
      const year = Math.floor(index / 12);
      const month = index % 12;
      if (rule.bymonth === null || rule.bymonth.indexOf(month + 1) >= 0) days = monthDays(rule, year, month, s.getUTCDate());
      break;
    }
    case "YEARLY": {
      const year = s.getUTCFullYear() + p * rule.interval;
      const months = rule.bymonth !== null ? rule.bymonth : [s.getUTCMonth() + 1];
      for (let i = 0; i < months.length; i += 1) {
        const list = monthDays(rule, year, months[i] - 1, s.getUTCDate());
        for (let k = 0; k < list.length; k += 1) days.push(list[k]);
      }
      break;
    }
  }
  days.sort((a, b) => a - b);
  // Duplicates (BYMONTHDAY=1,-31 in a 31-day month) count once.
  days = days.filter((t, i) => i === 0 || t !== days[i - 1]);
  if (rule.bysetpos !== null) {
    const picked: number[] = [];
    for (let i = 0; i < rule.bysetpos.length; i += 1) {
      const pos = rule.bysetpos[i];
      const t = pos > 0 ? days[pos - 1] : days[days.length + pos];
      if (t !== undefined) picked.push(t);
    }
    picked.sort((a, b) => a - b);
    return picked;
  }
  return days;
}

/** How many whole periods lie between the series start and `wall`, rounded down. */
function periodsBefore(rule: Rule, startDayWall: number, wall: number): number {
  if (wall <= startDayWall) return 0;
  const s = new Date(startDayWall);
  const w = new Date(wall);
  switch (rule.freq) {
    case "DAILY":
      return Math.floor((wall - startDayWall) / (rule.interval * DAY));
    case "WEEKLY":
      return Math.floor((wall - startDayWall) / (rule.interval * 7 * DAY));
    case "MONTHLY":
      return Math.floor(((w.getUTCFullYear() - s.getUTCFullYear()) * 12 + w.getUTCMonth() - s.getUTCMonth()) / rule.interval);
    default:
      return Math.floor((w.getUTCFullYear() - s.getUTCFullYear()) / rule.interval);
  }
}

/**
 * Wall times of the instances that start between `from` and `to` (wall times,
 * already widened by the caller for zones and the event's length).
 * `toInstant` turns a wall time of this event into an instant, for a UTC UNTIL.
 */
export function expand(rule: Rule, startWall: number, from: number, to: number, toInstant: (wall: number) => number): number[] {
  const timeOfDay = ((startWall % DAY) + DAY) % DAY;
  const startDay = startWall - timeOfDay;
  const out: number[] = [];
  // With COUNT every instance from the start counts, so the walk must begin there.
  let p = rule.count === Infinity ? Math.max(0, periodsBefore(rule, startDay, from) - 1) : 0;
  let seen = 0;
  for (let walked = 0; walked < MAX_PERIODS; walked += 1, p += 1) {
    const days = periodDays(rule, startDay, p);
    for (let i = 0; i < days.length; i += 1) {
      const wall = days[i] + timeOfDay;
      if (wall < startWall) continue;
      if (rule.until !== Infinity && (rule.untilIsUtc ? toInstant(wall) : wall) > rule.until) return out;
      seen += 1;
      if (seen > rule.count) return out;
      if (wall > to) return out;
      if (wall >= from) out.push(wall);
    }
    // A period that picked nothing can still be followed by ones that do; only the window's end stops the walk.
    if (days.length === 0 && periodStart(rule, startDay, p) > to) return out;
  }
  return out;
}

function periodStart(rule: Rule, startDay: number, p: number): number {
  const s = new Date(startDay);
  switch (rule.freq) {
    case "DAILY":
      return startDay + p * rule.interval * DAY;
    case "WEEKLY":
      return startDay + p * rule.interval * 7 * DAY - 7 * DAY;
    case "MONTHLY": {
      const index = s.getUTCFullYear() * 12 + s.getUTCMonth() + p * rule.interval;
      return Date.UTC(Math.floor(index / 12), index % 12, 1);
    }
    default:
      return Date.UTC(s.getUTCFullYear() + p * rule.interval, 0, 1);
  }
}
