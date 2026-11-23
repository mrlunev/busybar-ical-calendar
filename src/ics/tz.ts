/**
 * Turns written times into instants without a time zone database.
 *
 * A calendar defines the zones it uses in VTIMEZONE blocks: each STANDARD or
 * DAYLIGHT part gives the offsets and a yearly rule of when it starts. That is
 * enough to know the offset at any moment. Where a calendar names a zone without
 * defining it (some Microsoft and Google feeds, "Customized Time Zone"), a small
 * table of the common IANA and Windows names stands in; a zone found nowhere is
 * taken to be the bar's own.
 */

import type { DateValue, Observance, Zones } from "./parse.ts";

const DAY = 86400000;
const MIN = 60000;

/** Weekday numbers as RRULE writes them, Sunday first, as Date.getUTCDay() counts. */
export const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Day of the month of the `n`-th (from 1, or from the end when negative) weekday `wd` of a month. */
export function nthWeekday(year: number, month: number, wd: number, n: number): number {
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return day <= days ? day : -1;
  }
  const last = new Date(Date.UTC(year, month, days)).getUTCDay();
  const day = days - ((last - wd + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? day : -1;
}

function ruleValue(rule: string, key: string): string {
  const i = rule.indexOf(key + "=");
  if (i < 0 || (i > 0 && rule.charCodeAt(i - 1) !== 59)) return "";
  const end = rule.indexOf(";", i);
  return rule.slice(i + key.length + 1, end < 0 ? rule.length : end);
}

/** The wall time an observance's yearly rule starts it in `year`, or NaN. */
function onsetIn(o: Observance, year: number): number {
  const rule = o.rule as string;
  const month = +ruleValue(rule, "BYMONTH") - 1;
  if (!(month >= 0)) return NaN;
  const timeOfDay = ((o.start % DAY) + DAY) % DAY;
  const byday = ruleValue(rule, "BYDAY");
  let day: number;
  if (byday !== "") {
    const m = /^([+-]?\d*)([A-Z]{2})$/.exec(byday);
    if (m === null) return NaN;
    day = nthWeekday(year, month, WEEKDAYS[m[2]], m[1] === "" || m[1] === "+" ? 1 : +m[1]);
  } else {
    day = +ruleValue(rule, "BYMONTHDAY") || new Date(o.start).getUTCDate();
  }
  if (!(day > 0)) return NaN;
  const onset = Date.UTC(year, month, day) + timeOfDay;
  const until = ruleValue(rule, "UNTIL");
  if (until !== "") {
    const u = Date.UTC(+until.slice(0, 4), +until.slice(4, 6) - 1, +until.slice(6, 8), +until.slice(9, 11) || 0, +until.slice(11, 13) || 0);
    if (onset - o.from * MIN > u) return NaN;
  }
  return onset >= o.start ? onset : NaN;
}

/** Offset in minutes east of UTC that a zone has at instant `utc`. */
export function offsetAt(observances: readonly Observance[], utc: number): number {
  const year = new Date(utc).getUTCFullYear();
  let best = -Infinity;
  let offset = NaN;
  let earliest = Infinity;
  let earliestFrom = 0;
  const consider = (wall: number, o: Observance) => {
    if (!(wall === wall)) return;
    const instant = wall - o.from * MIN;
    if (instant <= utc && instant > best) {
      best = instant;
      offset = o.to;
    }
    if (instant < earliest) {
      earliest = instant;
      earliestFrom = o.from;
    }
  };
  for (let i = 0; i < observances.length; i += 1) {
    const o = observances[i];
    consider(o.start, o);
    if (o.rule !== null) {
      consider(onsetIn(o, year), o);
      consider(onsetIn(o, year - 1), o);
    }
    if (o.rdates !== null) for (let k = 0; k < o.rdates.length; k += 1) consider(o.rdates[k], o);
  }
  // Before every onset the zone had the offset the first one starts from.
  return offset === offset ? offset : earliestFrom;
}

// ---------------------------------------------------------------------------
// Zones named but not defined in the calendar.

type Rules = "none" | "eu" | "us" | "au" | "nz";

function made(std: number, rules: Rules): Observance[] {
  const standard = (start: number, rule: string | null, from: number): Observance => ({ start, from, to: std, rule, rdates: null });
  const daylight = (start: number, rule: string): Observance => ({ start, from: std, to: std + 60, rule, rdates: null });
  const at = (month: number, day: number, hour: number) => Date.UTC(1970, month, day, hour);
  switch (rules) {
    case "eu":
      // At 01:00 UTC on the last Sundays of March and October.
      return [
        daylight(at(2, 29, 1) + std * MIN, "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"),
        standard(at(9, 25, 1) + (std + 60) * MIN, "FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", std + 60),
      ];
    case "us":
      return [daylight(at(2, 8, 2), "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"), standard(at(10, 1, 2), "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", std + 60)];
    case "au":
      return [daylight(at(9, 4, 2), "FREQ=YEARLY;BYMONTH=10;BYDAY=1SU"), standard(at(3, 5, 3), "FREQ=YEARLY;BYMONTH=4;BYDAY=1SU", std + 60)];
    case "nz":
      return [daylight(at(8, 27, 2), "FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU"), standard(at(3, 5, 3), "FREQ=YEARLY;BYMONTH=4;BYDAY=1SU", std + 60)];
    default:
      return [standard(0, null, std)];
  }
}

/** Standard offset in minutes and daylight rules, by IANA and Windows names. */
const KNOWN: Record<string, [number, Rules]> = {};
function known(std: number, rules: Rules, names: string): void {
  const list = names.split("|");
  for (let i = 0; i < list.length; i += 1) KNOWN[list[i].toLowerCase()] = [std, rules];
}
known(0, "none", "UTC|Etc/UTC|GMT|Etc/GMT|Z|Coordinated Universal Time|Greenwich Standard Time|Atlantic/Reykjavik|Africa/Abidjan");
known(0, "eu", "Europe/London|Europe/Dublin|Europe/Lisbon|GMT Standard Time");
known(60, "eu", "Europe/Berlin|Europe/Paris|Europe/Amsterdam|Europe/Madrid|Europe/Rome|Europe/Zurich|Europe/Vienna|Europe/Stockholm|Europe/Oslo|Europe/Copenhagen|Europe/Brussels|Europe/Prague|Europe/Warsaw|Europe/Budapest|Europe/Belgrade|Europe/Luxembourg|W. Europe Standard Time|Central Europe Standard Time|Romance Standard Time|Central European Standard Time");
known(120, "eu", "Europe/Helsinki|Europe/Kyiv|Europe/Kiev|Europe/Riga|Europe/Tallinn|Europe/Vilnius|Europe/Athens|Europe/Bucharest|Europe/Sofia|Asia/Nicosia|FLE Standard Time|GTB Standard Time|E. Europe Standard Time");
known(60, "none", "Africa/Lagos|W. Central Africa Standard Time");
known(120, "none", "Africa/Johannesburg|South Africa Standard Time|Africa/Cairo|Egypt Standard Time|Asia/Jerusalem|Israel Standard Time");
known(180, "none", "Europe/Moscow|Russian Standard Time|Europe/Istanbul|Turkey Standard Time|Asia/Riyadh|Arab Standard Time|Europe/Minsk|Belarus Standard Time");
known(210, "none", "Asia/Tehran|Iran Standard Time");
known(240, "none", "Asia/Dubai|Arabian Standard Time|Asia/Tbilisi|Asia/Yerevan|Asia/Baku|Europe/Samara");
known(300, "none", "Asia/Karachi|Pakistan Standard Time|Asia/Tashkent|Asia/Yekaterinburg|Ekaterinburg Standard Time|Asia/Almaty");
known(330, "none", "Asia/Kolkata|Asia/Calcutta|India Standard Time");
known(345, "none", "Asia/Kathmandu|Nepal Standard Time");
known(360, "none", "Asia/Dhaka|Bangladesh Standard Time|Asia/Novosibirsk");
known(420, "none", "Asia/Bangkok|Asia/Jakarta|Asia/Ho_Chi_Minh|SE Asia Standard Time");
known(480, "none", "Asia/Shanghai|Asia/Hong_Kong|Asia/Singapore|Asia/Taipei|Asia/Manila|Australia/Perth|China Standard Time|Singapore Standard Time|Taipei Standard Time|W. Australia Standard Time");
known(540, "none", "Asia/Tokyo|Asia/Seoul|Tokyo Standard Time|Korea Standard Time");
known(600, "au", "Australia/Sydney|Australia/Melbourne|Australia/Canberra|Australia/Hobart|AUS Eastern Standard Time|Tasmania Standard Time");
known(600, "none", "Australia/Brisbane|E. Australia Standard Time");
known(570, "au", "Australia/Adelaide|Cen. Australia Standard Time");
known(720, "nz", "Pacific/Auckland|New Zealand Standard Time");
known(-180, "none", "America/Sao_Paulo|E. South America Standard Time|America/Argentina/Buenos_Aires|America/Buenos_Aires|Argentina Standard Time");
known(-240, "us", "America/Halifax|Atlantic Standard Time");
known(-300, "us", "America/New_York|America/Toronto|America/Detroit|America/Indiana/Indianapolis|US/Eastern|Eastern Standard Time");
known(-300, "none", "America/Bogota|America/Lima|SA Pacific Standard Time");
known(-360, "us", "America/Chicago|America/Winnipeg|US/Central|Central Standard Time");
known(-360, "none", "America/Mexico_City|Central Standard Time (Mexico)|America/Regina|Canada Central Standard Time");
known(-420, "us", "America/Denver|America/Edmonton|America/Boise|US/Mountain|Mountain Standard Time");
known(-420, "none", "America/Phoenix|US Mountain Standard Time");
known(-480, "us", "America/Los_Angeles|America/Vancouver|US/Pacific|Pacific Standard Time");
known(-540, "us", "America/Anchorage|Alaskan Standard Time");
known(-600, "none", "Pacific/Honolulu|Hawaiian Standard Time");

/** A zone from the table, or from a "(UTC+01:00) Amsterdam, ..." label as a fixed offset. Null if unknown. */
export function knownZone(name: string): Observance[] | null {
  const entry = KNOWN[name.toLowerCase()];
  if (entry !== undefined) return made(entry[0], entry[1]);
  const m = /^\(?(?:UTC|GMT)\s*([+-])(\d\d?):?(\d\d)?\)?/i.exec(name);
  if (m !== null) {
    const minutes = +m[2] * 60 + +(m[3] || 0);
    return made(m[1] === "-" ? -minutes : minutes, "none");
  }
  return null;
}

export class ZoneResolver {
  private readonly cache: Record<string, Observance[] | null> = {};

  private readonly zones: Zones;
  /** The calendar's own zone (X-WR-TIMEZONE), for floating times. */
  private readonly calendarTz: string;
  /** The bar's offset now, in minutes: for floating times and zones found nowhere. */
  private readonly barOffset: number;

  constructor(zones: Zones, calendarTz: string, barOffset: number) {
    this.zones = zones;
    this.calendarTz = calendarTz;
    this.barOffset = barOffset;
  }

  private zone(name: string): Observance[] | null {
    if (name in this.cache) return this.cache[name];
    const z = this.zones[name] && this.zones[name].length > 0 ? this.zones[name] : knownZone(name);
    this.cache[name] = z;
    return z;
  }

  /** The instant of a wall time in zone `tz` ("Z", "" floating, or a TZID). */
  wallToUtc(wall: number, tz: string): number {
    if (tz === "Z") return wall;
    const z = tz === "" ? (this.calendarTz !== "" ? this.zone(this.calendarTz) : null) : this.zone(tz);
    if (z === null) return wall - this.barOffset * MIN;
    // The offset depends on the instant, which depends on the offset: two rounds settle it except
    // inside the hour a clock skips or repeats, where either answer is as good.
    let offset = offsetAt(z, wall);
    offset = offsetAt(z, wall - offset * MIN);
    return wall - offset * MIN;
  }

  /** The instant a written date or date-time stands for. A whole day starts at the bar's midnight. */
  instant(d: DateValue): number {
    if (d.allDay) return d.wall - this.barOffset * MIN;
    return this.wallToUtc(d.wall, d.tz);
  }
}
