/**
 * Which meeting the app warns about, and which it only shows.
 *
 * A warning is for a meeting with a time (not a whole day), not marked free,
 * from a calendar whose warnings are on. It comes `lead` minutes before the
 * start ("soon") and stays until dismissed. Its point is to pull a person out of
 * focus, where notifications on the screen go unseen, so it is loud once and not
 * twice: at the start a second warning ("now") comes only if the first one is
 * still up (nobody saw it), or if there was no early warning. A dismissed
 * warning is remembered by meeting and moment, so it does not come back after a
 * restart.
 */

import type { Instance } from "./agenda.ts";

const MIN = 60000;
/** How long the "now" warning can stay up at most, if not dismissed. */
const NOW_WINDOW = 5 * MIN;

export type AlertKind = "soon" | "now";

export interface Alert {
  kind: AlertKind;
  instance: Instance;
  key: string;
}

export interface AlertSettings {
  /** Minutes before the start; 0 turns the early warning off. */
  lead: number;
  atStart: boolean;
  /** Whether each calendar warns, by its index. */
  sources: readonly boolean[];
}

export function alertKey(kind: AlertKind, x: Instance): string {
  return `${kind}|${x.uid}|${x.start}`;
}

export function alertable(x: Instance, s: AlertSettings): boolean {
  return !x.allDay && !x.free && s.sources[x.source] === true;
}

/** The warning to show at `now`, or null: the one for the earliest meeting, "now" before "soon". */
export function currentAlert(agenda: readonly Instance[], now: number, s: AlertSettings, dismissed: readonly string[]): Alert | null {
  for (let i = 0; i < agenda.length; i += 1) {
    const x = agenda[i];
    if (x.start - now > s.lead * MIN) break;
    if (!alertable(x, s)) continue;
    if (s.atStart && now >= x.start && now < Math.min(x.start + NOW_WINDOW, Math.max(x.end, x.start + MIN))) {
      const key = alertKey("now", x);
      const seen = s.lead > 0 && dismissed.indexOf(alertKey("soon", x)) >= 0;
      if (!seen && dismissed.indexOf(key) < 0) return { kind: "now", instance: x, key };
    }
    if (s.lead > 0 && now >= x.start - s.lead * MIN && now < x.start) {
      const key = alertKey("soon", x);
      if (dismissed.indexOf(key) < 0) return { kind: "soon", instance: x, key };
    }
  }
  return null;
}

/** When the next warning starts after `now`, or Infinity. The scheduler keeps the network quiet before it. */
export function nextAlertAt(agenda: readonly Instance[], now: number, s: AlertSettings): number {
  let best = Infinity;
  for (let i = 0; i < agenda.length; i += 1) {
    const x = agenda[i];
    if (!alertable(x, s)) continue;
    const soon = x.start - s.lead * MIN;
    if (s.lead > 0 && soon > now && soon < best) best = soon;
    if (s.atStart && x.start > now && x.start < best) best = x.start;
  }
  return best;
}
