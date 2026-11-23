import assert from "node:assert/strict";
import { test } from "node:test";

import type { Instance } from "../src/agenda.ts";
import { demoAgenda } from "../src/demo.ts";
import { buildTimeline, clampScroll, eventPage, homeScroll, HOUR_PX, PICK_Y, textWidth, timelineFrame } from "../src/timeline.ts";

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Tuesday 24 November 2026, the bar at UTC.
const D0 = Date.UTC(2026, 10, 24);
const at = (h: number, m = 0, day = 0) => D0 + day * DAY + h * HOUR + m * MIN;
const ev = (start: number, minutes: number, title: string, source = 0, extra: Partial<Instance> = {}): Instance => ({
  start, end: start + minutes * MIN, allDay: false, title, location: "", source, uid: title, free: false, ...extra,
});

function build(agenda: Instance[], marks = true) {
  buildTimeline({ agenda, dayStart: D0, offset: 0, days: 7, vendors: ["microsoft", "google", "apple"], marks, allDay: true });
}
const ids = (scroll: number, now: number) => timelineFrame(scroll, now, true).want.map((w) => w.id);

test("timeline: now sits at the picker; the corner reads the time at the window's top in 5 minute steps", () => {
  build([]);
  const now = at(10, 12);
  const home = homeScroll(now);
  const f = timelineFrame(home, now, true);
  assert.equal(f.nowY, PICK_Y);
  // 10:12 is 8 px below the top: the top is at about 09:57, which reads 09:55.
  const corner = f.want.find((w) => w.id === "hc");
  assert.ok(corner && corner.key.includes("09:55"), corner?.key);
  // With an hour line at the window's top the corner reads the hour.
  const atTen = homeScroll(at(10)) + PICK_Y;
  const g = timelineFrame(atTen, now, true).want.find((w) => w.id === "hc");
  assert.ok(g && g.key.includes("10:00"), g?.key);
});

test("timeline: a meeting under the picker is picked; its page says how far away it is", () => {
  const m = ev(at(10), 60, "Design review", 0);
  build([m]);
  const now = at(10, 20);
  const f = timelineFrame(homeScroll(now), now, true);
  assert.equal(f.picked, m);
  const page = eventPage(m, now, ["microsoft"], 0, D0, true);
  assert.ok(page.some((e) => e.text === "NOW"));
  assert.ok(page.some((e) => e.text === "DESIGN REVIEW"));
});

test("timeline: overlapping meetings stand side by side and share the picker's rows left to right", () => {
  const a = ev(at(13), 60, "Long", 0);
  const b = ev(at(13, 15), 30, "Short", 1);
  build([a, b]);
  const pickedAt = (row: number) => timelineFrame(clampScroll(row - PICK_Y), at(8), true).picked;
  // Rows where only the long one is under the picker pick it; where both are, the upper half is the long one's.
  const top = homeScroll(at(13)) + PICK_Y;
  assert.equal(pickedAt(top + 4), a);
  const both = homeScroll(at(13, 15)) + PICK_Y + 3;
  assert.equal(pickedAt(both), a);
  assert.equal(pickedAt(both + 10), b);
  assert.equal(pickedAt(homeScroll(at(13, 50)) + PICK_Y), a);
});

test("timeline: all-day events open their day in a band; one calendar draws no marks", () => {
  const off = ev(at(0, 0, 1), 24 * 60, "Company offsite", 0, { allDay: true });
  const late = ev(at(10, 0, 1), 60, "Sprint planning", 1);
  build([off, late], false);
  // The band pushes tomorrow's hours down by its height (7 px for the day's name and 8 px a row).
  const tomorrow = homeScroll(at(10, 0, 1)) - homeScroll(at(10, 0, 0));
  assert.equal(tomorrow, 24 * HOUR_PX + 15);
  const list = ids(homeScroll(at(0, 5, 1)) - 4, at(8));
  assert.ok(list.some((id) => id.startsWith("b")), list.join(","));
  assert.ok(!list.some((id) => id.endsWith("m")), "no mark with one calendar");
});

test("timeline: text widths follow the firmware's small font", () => {
  assert.equal(textWidth("I"), 1);
  assert.equal(textWidth("AA"), 9);
  assert.equal(textWidth("A A"), 12);
});

test("demo: reads a few minutes apart give the same meetings, so a warning comes once", () => {
  const first = demoAgenda(null, 0, at(10, 2), 0);
  const later = demoAgenda(null, 0, at(10, 12), 0);
  assert.deepEqual(later.map((x) => x.start), first.map((x) => x.start));
  // Half a day on, the week is laid out again around the new time.
  const next = demoAgenda(null, 0, at(23, 0), 0);
  assert.notDeepEqual(next.map((x) => x.start), first.map((x) => x.start));
});
