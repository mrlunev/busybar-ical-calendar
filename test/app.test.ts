import assert from "node:assert/strict";
import { test } from "node:test";

import type { Instance } from "../src/agenda.ts";
import { currentAlert, nextAlertAt, type AlertSettings } from "../src/alerts.ts";
import { configFrom } from "../src/config.ts";
import { backFrame, dayLabel, daySpan, frontFrame, hm, span, timelineXpm } from "../src/screens.ts";
import { logoXpm } from "../src/logos.ts";
import { normalizeUrl, vendorOf } from "../src/sources.ts";

const MIN = 60000;
const NOW = Date.UTC(2026, 10, 18, 9, 0);
const meeting = (start: number, minutes: number, extra: Partial<Instance> = {}): Instance => ({
  start, end: start + minutes * MIN, allDay: false, title: "Sync", location: "", source: 0, uid: "u" + start, free: false, ...extra,
});
const settings: AlertSettings = { lead: 5, atStart: true, sources: [true, false, false] };

test("alerts: soon within the lead, now at the start, never for free, all-day or quiet calendars", () => {
  const m = meeting(NOW + 4 * MIN, 30);
  assert.equal(currentAlert([m], NOW, settings, [])?.kind, "soon");
  assert.equal(currentAlert([m], NOW + 4 * MIN, settings, [])?.kind, "now");
  assert.equal(currentAlert([m], NOW + 10 * MIN, settings, []), null);
  assert.equal(currentAlert([m], NOW - 2 * MIN, settings, []), null);
  assert.equal(currentAlert([meeting(NOW + MIN, 30, { free: true })], NOW, settings, []), null);
  assert.equal(currentAlert([meeting(NOW + MIN, 30, { allDay: true })], NOW, settings, []), null);
  assert.equal(currentAlert([meeting(NOW + MIN, 30, { source: 1 })], NOW, settings, []), null);
  const a = currentAlert([m], NOW, settings, [])!;
  assert.equal(currentAlert([m], NOW, settings, [a.key]), null);
  // Loud once: after the early warning was dismissed, the start brings no second one.
  assert.equal(currentAlert([m], NOW + 4 * MIN, settings, [a.key]), null);
  // With no early warning, the start is the warning.
  assert.equal(currentAlert([m], NOW + 4 * MIN, { ...settings, lead: 0 }, [])?.kind, "now");
  assert.equal(nextAlertAt([m], NOW - 10 * MIN, settings), NOW - MIN);
});

test("config: groups become sources, empty places are skipped, names default to the service", () => {
  const c = configFrom({
    calendar_1: { url: " webcal://p48-caldav.icloud.com/published/2/x ", name: "", alerts: true },
    calendar_2: { url: "", name: "x", alerts: true },
    calendar_3: { url: "https://outlook.office365.com/owa/calendar/a@b.com/c/calendar.ics", name: "Work", alerts: false },
    calendar_4: { url: "https://calendar.google.com/x.ics", name: "", alerts: true },
    general: { alert_minutes: "10", refresh_minutes: "15", sound: false },
  });
  assert.deepEqual(c.sources.map((s) => [s.index, s.name, s.vendor, s.alerts]), [[0, "iCloud", "apple", true], [2, "Work", "microsoft", false]]);
  assert.equal(c.sources[0].url, "https://p48-caldav.icloud.com/published/2/x");
  assert.equal(c.lead, 10);
  assert.equal(c.refreshMinutes, 15);
  assert.equal(c.sound, false);
  // Three places: a fourth calendar is not read.
  assert.equal(c.sources.length, 2);
  assert.equal(normalizeUrl("calendar.google.com/x.ics"), "https://calendar.google.com/x.ics");
  assert.equal(vendorOf("https://calendar.proton.me/api/calendar/v1/url/x/calendar.ics?a=1"), "proton");
});

test("screens: times in the bar's zone, day labels, the frame for each state", () => {
  assert.equal(hm(NOW, 240), "13:00");
  assert.equal(dayLabel(NOW + 86400000, NOW, 0), "Tomorrow");
  const vendors = ["microsoft", "google", "other"] as const;
  const base = { now: NOW, offset: 0, configured: true, loaded: true, alert: null, current: null, next: null, browsed: null, toast: "", agenda: [], vendors };
  assert.equal(frontFrame({ ...base, configured: false }).elements[0].type, "text");
  const soon = frontFrame({ ...base, alert: { kind: "soon", instance: meeting(NOW + 3 * MIN, 30), key: "k" } });
  assert.equal(soon.led, "#F5A623FF");
  assert.ok(soon.elements.some((e) => e.type === "text" && (e as { text: string }).text === "in 3 min"));
  // Seconds tick only in the last minute.
  const last = frontFrame({ ...base, alert: { kind: "soon", instance: meeting(NOW + 40000, 30), key: "k" } });
  assert.ok(last.elements.some((e) => e.type === "countdown"));
  const texts = (f: { elements: { type: string }[] }) => f.elements.filter((e) => e.type === "text").map((e) => (e as unknown as { text: string }).text);
  // The overview, not a card: a line of state over the day's timeline, no title, no mark.
  const busy = meeting(NOW - 10 * MIN, 30);
  const current = frontFrame({ ...base, current: busy, agenda: [busy] });
  assert.deepEqual(texts(current), ["In meeting", "20 min"]);
  assert.ok(current.elements.some((e) => e.id === "tl"));
  assert.ok(current.elements.every((e) => e.id !== "logo"));
  const soonToday = meeting(NOW + 2 * 3600000, 30);
  assert.deepEqual(texts(frontFrame({ ...base, next: soonToday, agenda: [soonToday] })), ["Today", "next 11:00"]);
  const later = meeting(NOW + 3 * 86400000, 30);
  assert.deepEqual(texts(frontFrame({ ...base, next: later, agenda: [later] })), ["Free", "Sat 09:00"]);
  assert.deepEqual(texts(frontFrame(base)), ["Free all week"]);
  // A card comes up when the wheel picks a meeting: its mark, title and time, and its place in the day.
  const picked = frontFrame({ ...base, browsed: soonToday, agenda: [soonToday] });
  assert.ok(picked.elements.some((e) => e.id === "logo" && (e as { data: string }).data === logoXpm("microsoft")));
  assert.deepEqual(texts(picked), ["Sync", "Today 11:00-11:30"]);
  const back = backFrame({ now: NOW, offset: 0, agenda: [meeting(NOW - 10 * MIN, 30), meeting(NOW + 86400000, 30, { title: "Zürich" })], showAllDay: true, notice: "", updated: NOW, browsed: null, vendors });
  assert.ok(back.some((e) => e.type === "text" && (e as { text: string }).text === "Tomorrow"));
  // One font for the back: a title with diacritics loses them and stays in `normal`.
  assert.ok(back.some((e) => e.type === "text" && (e as { text: string }).text === "Zurich"));
  assert.ok(back.every((e) => e.type !== "text" || (e as { font: string }).font === "normal"));
});

test("time spans read the way people say them", () => {
  assert.equal(span(25 * MIN), "25 min");
  assert.equal(span(24 * MIN + 1000), "25 min");
  assert.equal(span(60 * MIN), "1h");
  assert.equal(span(80 * MIN), "1h 20m");
  assert.equal(span(5000), "1 min");
});

test("the day's timeline: 08:00 to 20:00 widened by meetings, blocks by state, the moment now, hour ticks", () => {
  // NOW is 09:00 UTC on a Wednesday; the bar is on UTC.
  const early = meeting(Date.UTC(2026, 10, 18, 7, 30), 30);
  assert.deepEqual(daySpan([early], NOW, 0), { from: Date.UTC(2026, 10, 18, 7), to: Date.UTC(2026, 10, 18, 20) });
  const past = meeting(Date.UTC(2026, 10, 18, 8, 0), 30);
  const busy = meeting(Date.UTC(2026, 10, 18, 8, 50), 30);
  const next = meeting(Date.UTC(2026, 10, 18, 14, 0), 60);
  const rows = timelineXpm([past, busy, next], NOW, 0, 7).split("\n").slice(-7);
  // 12 hours over 72 pixels: 10 minutes a pixel.
  assert.equal(rows[2][1], "p");
  assert.equal(rows[2][5], "b");
  assert.equal(rows[0][6], "w");
  assert.equal(rows[2][36], "n");
  assert.equal(rows[6][0], "t");
  assert.equal(rows[6][6], "w");
  assert.equal(rows[6][12], "t");
  const picked = timelineXpm([past, busy, next], NOW, 0, 1, next).split("\n").pop()!;
  assert.equal(picked[36], "a");
  assert.equal(picked[1], "p");
});
