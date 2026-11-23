// Every screen state of the iCal Calendar app, drawn by the BUSY Bar's own firmware and captured pixel for pixel.
// The frames come from the app's own frontFrame/backFrame (src/screens.ts) fed with made-up data; the bar draws them
// as a host draw at priority 60 over the running app, and /api/screen reads them back.
//   node tools/render-states.mjs . <out folder>   (the bar on USB at 10.0.4.20, firmware 1.4.1, the iCal Calendar app running)
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [repo, out] = process.argv.slice(2);
const BAR = "http://10.0.4.20";
const NAME = "figma.calendar_states";
const { frontFrame, backFrame } = await import(pathToFileURL(path.join(repo, "src/screens.ts")).href);
mkdirSync(out, { recursive: true });

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Tuesday 24 November 2026, the bar's clock at UTC (offset 0) for the made-up days.
const D0 = Date.UTC(2026, 10, 24);
const at = (day, h, m = 0) => D0 + day * DAY + h * HOUR + m * MIN;
let uid = 0;
const ev = (source, title, start, end, extra = {}) => ({ start, end, allDay: false, title, location: "", source, uid: `u${uid++}`, free: false, ...extra });
const allDay = (source, title, day) => ev(source, title, at(day, 0), at(day + 1, 0), { allDay: true });

const VENDORS = ["google", "microsoft", "apple"];
const A = {
  standup: ev(0, "Standup", at(0, 9), at(0, 9, 30)),
  review: ev(1, "Design review", at(0, 10), at(0, 11)),
  anna: ev(0, "1:1 with Anna", at(0, 11, 30), at(0, 12)),
  lunch: ev(2, "Lunch", at(0, 13), at(0, 14), { free: true }),
  planning: ev(0, "Hackathon planning with the catalog team", at(0, 15), at(0, 16, 30)),
  offsite: allDay(1, "Company offsite", 1),
  sprint: ev(1, "Sprint planning", at(1, 10), at(1, 11)),
  dentist: ev(2, "Dentist", at(2, 14), at(2, 15)),
  demo: ev(0, "Demo day", at(3, 16), at(3, 17)),
};
const agenda = Object.values(A).sort((a, b) => a.start - b.start);
const after = (t) => agenda.filter((x) => x.end > t);
const nextAfter = (t) => agenda.find((x) => x.start > t && !x.allDay) ?? null;
const currentAt = (t) => agenda.find((x) => !x.allDay && x.start <= t && x.end > t && !x.free) ?? agenda.find((x) => !x.allDay && x.start <= t && x.end > t) ?? null;

const front = (now, o = {}) => ({
  now, offset: 0, configured: true, loaded: true, alert: null, current: currentAt(now), next: nextAfter(now),
  browsed: null, toast: "", agenda, vendors: VENDORS, ...o,
});
const back = (now, o = {}) => ({ now, offset: 0, agenda, showAllDay: true, notice: "", updated: now - 3 * MIN, browsed: null, vendors: VENDORS, ...o });

async function api(method, p, body) {
  const res = await fetch(BAR + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  return res;
}
const barTime = Date.parse((await (await api("GET", "/api/time")).json()).timestamp);

// Section, name, when it shows, and the elements.
const states = [];
const F = (section, name, when, f) => states.push({ display: "front", section, name, when, elements: frontFrame(f).elements, led: frontFrame(f).led });
const B = (section, name, when, b) => states.push({ display: "back", section, name, when, elements: backFrame(b) });

const t = (d, h, m) => at(d, h, m);
F("Start", "Add a calendar", "No iCal link in the settings yet", front(t(0, 10, 12), { configured: false }));
F("Start", "Loading", "Links set, nothing read yet (the first read takes 5 to 20 s)", front(t(0, 10, 12), { loaded: false }));
F("Start", "Checking calendars", "Long press of OK: reads every calendar now (toast, 2.5 s)", front(t(0, 10, 12), { toast: "Checking calendars" }));

F("Overview", "In meeting", "A busy meeting is under way: time left on the right", front(t(0, 10, 12)));
F("Overview", "Today, next", "Free now, more meetings later today", front(t(0, 11, 5), { current: null }));
F("Overview", "Today, free block", "In a free event (Lunch): it counts as free, the day goes on", front(t(0, 13, 20)));
F("Overview", "Free, tomorrow", "Nothing more today, the next meeting is tomorrow", front(t(0, 17, 0), { current: null }));
F("Overview", "Free, later this week", "The next meeting is two or more days away", front(t(0, 17, 0), { current: null, next: A.demo }));
F("Overview", "Free all week", "No meeting in the next seven days", front(t(0, 17, 0), { current: null, next: null }));

F("Alerts", "Soon", "N minutes before a meeting (5 by default): amber, LED amber, calendar sound", front(t(0, 11, 25), { current: null, alert: { kind: "soon", instance: A.anna, key: "s" } }));
F("Alerts", "Soon, last minute", "Under a minute to go: the firmware counts the seconds", front(barTime, { current: null, alert: { kind: "soon", instance: { ...A.anna, start: barTime + 45000, end: barTime + 1845000 }, key: "s1" } }));
F("Alerts", "Now", "At the start, unless dismissed: red, LED red, sound", front(t(0, 11, 30), { alert: { kind: "now", instance: A.anna, key: "n" } }));
F("Alerts", "Now, long title", "A title wider than the screen scrolls (frame at the start)", front(t(0, 15, 0), { alert: { kind: "now", instance: A.planning, key: "n2" } }));
F("Alerts", "Soon, Latin diacritics", "A title the small font cannot draw goes in the global font: its top is cut off (a bug to fix)", front(t(0, 11, 25), { alert: { kind: "soon", instance: { ...A.anna, title: "Café with Zoë" }, key: "s2" } }));
F("Alerts", "Soon, Cyrillic", "Cyrillic fits the small font", front(t(0, 11, 25), { alert: { kind: "soon", instance: { ...A.anna, title: "Планёрка" }, key: "s3" } }));

F("Wheel", "Card, under way", "The wheel picks a meeting: title, day and time, amber where it sits in its day", front(t(0, 10, 12), { browsed: A.review }));
F("Wheel", "Card, later today", "Bottom row: the day's timeline with the picked meeting", front(t(0, 10, 12), { browsed: A.planning }));
F("Wheel", "Card, tomorrow", "Another day: its own timeline", front(t(0, 10, 12), { browsed: A.sprint }));
F("Wheel", "Card, all day", "An all-day event: no timeline", front(t(0, 10, 12), { browsed: A.offsite }));
F("Wheel", "Card, no title", "An event without a title", front(t(0, 10, 12), { browsed: { ...A.dentist, title: "" } }));
for (const v of ["microsoft", "google", "apple", "proton", "fastmail", "other"]) {
  F("Service marks", v, `A ${v} calendar's mark on a card`, front(t(0, 10, 12), { browsed: A.sprint, vendors: [v, v, v] }));
}

B("Back", "Agenda", "From the meeting under way on (marked), day headers, all-day rows, free events dim", back(t(0, 10, 12)));
B("Back", "Agenda, wheel", "The meeting the wheel is on is marked", back(t(0, 10, 12), { browsed: A.offsite }));
B("Back", "Agenda, no all-day", "All-day events off in the settings", back(t(0, 10, 12), { showAllDay: false }));
B("Back", "Updated an hour ago", "The corner says how long ago the calendars were read", back(t(0, 10, 12), { updated: t(0, 9, 5) }));
B("Back", "Nothing more", "No meeting left this week", back(t(4, 18, 0), { updated: t(4, 17, 58) }));
B("Back", "Before the first read", "Nothing read yet", back(t(0, 10, 12), { agenda: [], updated: 0 }));
B("Notices", "Time zone", "The bar's zone is UTC: probably never set", back(t(0, 10, 12), { notice: "Set the bar's time zone in its settings" }));
B("Notices", "Link broken", "A calendar could not be read the first time", back(t(0, 10, 12), { notice: "Work: link no longer works" }));
B("Notices", "Not a calendar", "The link answers, but not with a calendar", back(t(0, 10, 12), { notice: "Work: not a calendar link" }));
B("Notices", "Known until", "Microsoft 365 came cut off: shown up to the last whole event", back(t(0, 10, 12), { notice: "Work: known until Thu 14:00" }));
B("Notices", "Stale", "A refresh failed: the last good read stays", back(t(0, 10, 12), { notice: "Work: HTTP 503, last read 25 min ago" }));

// ---- PNG -------------------------------------------------------------------------------------------------------
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(w, h, rgbAt, scale) {
  const stride = w * scale * 3 + 1;
  const raw = Buffer.alloc(stride * h * scale);
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) raw.set(rgbAt(Math.floor(x / scale), Math.floor(y / scale)), y * stride + 1 + x * 3);
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const b = Buffer.alloc(body.length + 8); b.writeUInt32BE(data.length, 0); body.copy(b, 4); b.writeUInt32BE(crc32(body), body.length + 4); return b; };
  const hdr = Buffer.alloc(13); hdr.writeUInt32BE(w * scale, 0); hdr.writeUInt32BE(h * scale, 4); hdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", hdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
async function grab(display) {
  const back = display === "back";
  const frame = Buffer.from(await (await api("GET", `/api/screen?display=${back ? 1 : 0}`)).text(), "base64");
  const w = back ? 160 : 72, h = back ? 80 : 16;
  const at = (x, y) => { const i = y * w + x; if (!back) return [frame[i * 3 + 2], frame[i * 3 + 1], frame[i * 3]]; const v = ((frame[i >> 1] >> ((i & 1) * 4)) & 15) * 17; return [v, v, v]; };
  return { w, h, at };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clear = () => api("DELETE", `/api/display/draw?application_name=${NAME}`).catch(() => {});
const index = [];
let n = 0;
for (const s of states) {
  n += 1;
  await clear();
  await api("POST", "/api/display/draw", { application_name: NAME, priority: 60, elements: s.elements });
  await sleep(600);
  const g = await grab(s.display);
  const file = `${String(n).padStart(2, "0")}-${s.display}-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;
  writeFileSync(path.join(out, `${file}.png`), png(g.w, g.h, g.at, 1));
  writeFileSync(path.join(out, `${file}@8x.png`), png(g.w, g.h, g.at, 8));
  index.push({ file, display: s.display, section: s.section, name: s.name, when: s.when, led: s.led ?? null });
  console.log(file);
}
await clear();
writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2));
console.log(`${index.length} states`);
