/**
 * A demo calendar, for a bar without a calendar link (a catalog review, the emulator, a photo shoot): the link
 * "demo" gives a made-up week around now, "demo/<service>" the part of it that service would bring and its look
 * (demo/microsoft, demo/google, demo/apple, demo/proton, demo/fastmail). Nothing goes over the network.
 */

import type { Instance } from "./agenda.ts";
import type { Vendor } from "./sources.ts";

const MIN = 60000;
const DAY = 24 * 60 * MIN;
const SERVICES: Vendor[] = ["microsoft", "google", "apple", "proton", "fastmail"];

/** Whether a (normalized) link is the demo calendar, and which service's part of it. */
export function demoOf(url: string): { vendor: Vendor | null } | null {
  const m = /^https?:\/\/demo(?:\/([a-z]+))?\/?$/i.exec(url);
  if (m === null) return null;
  const v = (m[1] || "").toLowerCase() as Vendor;
  return { vendor: SERVICES.indexOf(v) >= 0 ? v : null };
}

interface Item { from: number; minutes: number; title: string; vendor: Vendor; allDay?: boolean; day?: number; at?: number }

/** Minutes from now (`from`), or a fixed time of a later day (`day`, `at` minutes after its midnight). */
const ITEMS: Item[] = [
  { from: -110, minutes: 30, title: "Standup", vendor: "microsoft" },
  { from: -20, minutes: 30, title: "Call with Freddie", vendor: "microsoft" },
  { from: 30, minutes: 60, title: "Product sync", vendor: "microsoft" },
  { from: 45, minutes: 30, title: "[BUSY] Interview with the new COO", vendor: "google" },
  { from: 150, minutes: 60, title: "Design review: calendar timeline", vendor: "microsoft" },
  { from: 150, minutes: 30, title: "1:1 with Anna", vendor: "google" },
  { from: 165, minutes: 45, title: "Call with the printer vendor", vendor: "google" },
  { from: 300, minutes: 90, title: "Focus time", vendor: "apple" },
  { from: 0, minutes: 0, title: "Hackathon week", vendor: "google", allDay: true, day: 0 },
  { from: 0, minutes: 0, title: "Company offsite", vendor: "microsoft", allDay: true, day: 1 },
  { from: 0, minutes: 60, title: "Sprint planning", vendor: "microsoft", day: 1, at: 10 * 60 },
  { from: 0, minutes: 45, title: "Lunch with the team", vendor: "google", day: 1, at: 13 * 60 },
  { from: 0, minutes: 30, title: "Dentist", vendor: "apple", day: 2, at: 14 * 60 },
  { from: 0, minutes: 60, title: "Release review", vendor: "proton", day: 3, at: 11 * 60 },
  { from: 0, minutes: 45, title: "Newsletter draft", vendor: "fastmail", day: 4, at: 16 * 60 },
];

/**
 * The moment the demo week is laid out from. Set at the first read and kept, so the reads every few minutes give the
 * same meetings at the same times: a warning comes once, and a dismissed one stays dismissed. After half a day the
 * week is laid out again, so a bar left on keeps meetings ahead.
 */
let anchor = 0;
const RELAY_MS = 12 * 60 * MIN;

/** The demo's events for a calendar slot: all of them for "demo", one service's for "demo/<service>". */
export function demoAgenda(vendor: Vendor | null, source: number, now: number, offset: number): Instance[] {
  if (anchor === 0 || now - anchor > RELAY_MS || now < anchor) anchor = now;
  const base = anchor;
  const round = (t: number) => Math.round(t / (5 * MIN)) * 5 * MIN;
  const midnight = Math.floor((base + offset * MIN) / DAY) * DAY - offset * MIN;
  const out: Instance[] = [];
  for (let i = 0; i < ITEMS.length; i += 1) {
    const it = ITEMS[i];
    if (vendor !== null && it.vendor !== vendor) continue;
    let start: number;
    let end: number;
    if (it.allDay) {
      start = midnight + (it.day || 0) * DAY;
      end = start + DAY;
    } else if (it.day !== undefined) {
      start = midnight + it.day * DAY + (it.at || 0) * MIN;
      end = start + it.minutes * MIN;
    } else {
      start = round(base + it.from * MIN);
      end = start + it.minutes * MIN;
    }
    out.push({ start, end, allDay: it.allDay === true, title: it.title, location: "", source, uid: `demo-${i}`, free: false });
  }
  return out;
}
