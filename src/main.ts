/**
 * iCal Calendar for the BUSY Bar: meetings from up to three iCal links, the days ahead
 * as a timeline on the front (src/timeline.ts), the agenda on the back, and a
 * warning before each meeting.
 *
 * One loop drives everything. Every tick it works out what the screens should
 * show and sends only what changed; between ticks it reads one calendar at a
 * time, never in the minutes before a warning and never while someone is
 * turning the wheel: an HTTPS request freezes the app for a second or two, and
 * a big calendar takes several seconds more to read.
 */

import { device } from "@shared/device";
import { loadValues } from "@shared/settings";

import { instancesOf, mergeAgenda, type Instance } from "./agenda.ts";
import { currentAlert, nextAlertAt, type Alert, type AlertSettings } from "./alerts.ts";
import { configFrom, type Config } from "./config.ts";
import { demoAgenda, demoOf } from "./demo.ts";
import { loadFeed } from "./feed.ts";
import { ZoneResolver } from "./ics/tz.ts";
import { backFrame, dayLabel, frontFrame, hm, type Element } from "./screens.ts";
import { buildTimeline, clampScroll, eventPage, homeScroll, nowXpm, timelineFrame, type Want } from "./timeline.ts";
import type { Vendor } from "./sources.ts";
import { load, save, type Stored } from "./store.ts";
import manifest from "./appmeta/manifest.json";

const APP = manifest.id;
const MIN = 60000;
const DAY = 86400000;
const TICK_MS = 2000;
const HORIZON = 7 * DAY;
/** No network this close to a warning, so the warning is on time. */
const QUIET_BEFORE_ALERT = 3 * MIN;
const QUIET_FIRST_READ = 30000;
/** No network this soon after a key press: someone is using the bar. */
const QUIET_AFTER_INPUT = 10000;
const BROWSE_TIMEOUT = 30000;
const RETRY_MIN = [1, 5, 15];
const TIME_CHECK = 10 * MIN;

let config: Config;
let stored: Stored;
let agenda: Instance[] = [];
/** The bar's offset from UTC in minutes, and its zone's name. */
let offset = 0;
let zoneName = "";
let timeCheckedAt = 0;
let nextRead: number[] = [];
let failures: number[] = [];
let reading = false;
let lastInput = 0;
/** The timeline's window: where it stands, whether someone moved it off now, what the picker is on and what is open. */
let scroll = 0;
let navigated = false;
let picked: Instance | null = null;
let opened: Instance | null = null;
let colon = true;
let lastTurn = 0;
/** What the timeline was built from: rebuilt when the agenda, the day or the settings change. */
let builtFor = "";
let agendaVersion = 0;
let toast = "";
let toastUntil = 0;
let soundFor = "";
/** Where the red line was drawn, for the colon's blink. */
let nowY = -999;
let stopped = false;

const report = (e: unknown) => console.error(`${APP}: ${e instanceof Error ? e.message : String(e)}`);

function alertSettings(): AlertSettings {
  const sources = [false, false, false];
  for (let i = 0; i < config.sources.length; i += 1) sources[config.sources[i].index] = config.sources[i].alerts;
  return { lead: config.lead, atStart: config.atStart, sources };
}

/** The service of each calendar, by its place in the settings. */
function vendors(): Vendor[] {
  const out: Vendor[] = ["other", "other", "other"];
  for (let i = 0; i < config.sources.length; i += 1) out[config.sources[i].index] = config.sources[i].vendor;
  return out;
}

function rebuild(): void {
  agenda = mergeAgenda(stored.sources.map((s) => s.instances));
  agendaVersion += 1;
}

/** Today's local midnight, as an instant. */
const todayStart = (now: number) => Math.floor((now + offset * MIN) / DAY) * DAY - offset * MIN;

function ensureTimeline(now: number): void {
  const dayStart = todayStart(now);
  const key = `${agendaVersion}|${dayStart}|${offset}|${config.allDay}`;
  if (key === builtFor) return;
  builtFor = key;
  buildTimeline({ agenda, dayStart, offset, days: 7, vendors: vendors(), marks: config.sources.length > 1, allDay: config.allDay });
}

function notice(now: number): string {
  if (zoneName === "Universal" && offset === 0) return "Set the bar's time zone in its settings";
  for (let i = 0; i < config.sources.length; i += 1) {
    const s = stored.sources[i];
    const name = config.sources[i].name;
    if (s.error !== "" && s.updated === 0) return `${name}: ${s.error}`;
    if (s.knownUntil > 0) return `${name}: known until ${dayLabel(s.knownUntil, now, offset)} ${hm(s.knownUntil, offset)}`;
    if (s.error !== "") return `${name}: ${s.error}, last read ${Math.round((now - s.updated) / MIN)} min ago`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Drawing: only what changed, one request at a time.

// The front: elements by key (see timeline.ts). An element that only moved is the one sent last time, shifted;
// elements no longer wanted are parked far above the screen rather than deleted, and forgotten here: a week of the
// timeline has hundreds of elements, too many to keep in a 128 KiB heap. A parked one comes back built anew.
// The firmware holds at most 100 elements of an app, both screens together, so the parked ones are deleted in one
// request once there are PARK_MAX of them.
let frontKey: Record<string, string> = {};
let frontEl: Record<string, Element> = {};
let frontY: Record<string, number> = {};
let frontV: Record<string, string> = {};
let parked: Record<string, boolean> = {};
let parkedCount = 0;
const PARK = -400;
const PARK_MAX = 30;

async function sendFront(want: Want[], led: string | null): Promise<void> {
  const seen: Record<string, boolean> = {};
  const changed: Element[] = [];
  for (let k = 0; k < want.length; k += 1) {
    const w = want[k];
    seen[w.id] = true;
    if (parked[w.id]) {
      delete parked[w.id];
      parkedCount -= 1;
    }
    const before = frontKey[w.id];
    if (before === w.key && led === null) continue;
    let el: Element;
    if (w.y !== undefined && before !== undefined && frontV[w.id] === w.v) {
      el = frontEl[w.id];
      (el as unknown as { y: number }).y += w.y - frontY[w.id];
    } else el = w.make() as unknown as Element;
    if (w.y !== undefined) {
      frontY[w.id] = w.y;
      frontV[w.id] = w.v ?? "";
    }
    changed.push(el);
    frontKey[w.id] = w.key;
    frontEl[w.id] = el;
  }
  const gone: string[] = [];
  for (const id in frontKey) if (!seen[id]) gone.push(id);
  for (let i = 0; i < gone.length; i += 1) {
    const id = gone[i];
    changed.push({ ...frontEl[id], y: PARK } as unknown as Element);
    delete frontKey[id];
    delete frontEl[id];
    delete frontY[id];
    delete frontV[id];
    parked[id] = true;
    parkedCount += 1;
  }
  if (changed.length === 0) return;
  const params: { application_name: string; priority: number; elements: Element[]; led_notification_color?: string } = { application_name: APP, priority: 50, elements: changed };
  if (led !== null) params.led_notification_color = led;
  await device.DisplayDraw(params);
  if (parkedCount >= PARK_MAX) {
    const ids = Object.keys(parked);
    parked = {};
    parkedCount = 0;
    await device.DisplayClear({ application_name: APP, element_ids: ids });
  }
}

/** After a refused request the screens are unknown: take all of the app's elements away and draw everything again. */
async function forgetScreens(): Promise<void> {
  frontKey = {};
  frontEl = {};
  frontY = {};
  frontV = {};
  parked = {};
  parkedCount = 0;
  drawnBack = {};
  await device.DisplayClear({ application_name: APP });
}

/** Card elements (warnings, toasts, the setup and loading screens, an event's page) as wants keyed by their content. */
const asWants = (elements: readonly unknown[]): Want[] =>
  elements.map((e) => {
    const el = e as { id: string; y: number };
    return { id: el.id, key: JSON.stringify(el), make: () => el };
  });
let drawnBack: Record<string, string> = {};
let drawing = false;
let drawAgain = false;

/**
 * Sends the elements that differ from what is drawn and removes the ones no longer there. With `led`, every element
 * goes again, so the LED blinks with a full frame; what was drawn is still taken away by the same rule.
 */
async function sendFrame(elements: Element[], drawn: Record<string, string>, led: string | null): Promise<Record<string, string>> {
  const now: Record<string, string> = {};
  const changed: Element[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const e = elements[i];
    const json = JSON.stringify(e);
    now[e.id] = json;
    if (led !== null || drawn[e.id] !== json) changed.push(e);
  }
  const gone: string[] = [];
  for (const id in drawn) if (!(id in now)) gone.push(id);
  // An element whose type changes must go first: the firmware keeps the type of an id.
  for (let i = 0; i < changed.length; i += 1) {
    const before = drawn[changed[i].id];
    if (before !== undefined && JSON.parse(before).type !== changed[i].type) gone.push(changed[i].id);
  }
  if (gone.length > 0) await device.DisplayClear({ application_name: APP, element_ids: gone });
  if (changed.length > 0) {
    const params: { application_name: string; priority: number; elements: Element[]; led_notification_color?: string } = { application_name: APP, priority: 50, elements: changed };
    if (led !== null) params.led_notification_color = led;
    await device.DisplayDraw(params);
  }
  return now;
}

async function render(): Promise<void> {
  if (drawing) {
    drawAgain = true;
    return;
  }
  drawing = true;
  try {
    do {
      drawAgain = false;
      const now = Date.now();
      const settings = alertSettings();
      const alert: Alert | null = config.sources.length > 0 ? currentAlert(agenda, now, settings, stored.dismissed) : null;
      ensureTimeline(now);
      // The window follows now until someone turns the wheel, and goes back to it after a while without a key.
      if (navigated && now - lastInput > BROWSE_TIMEOUT && opened === null) navigated = false;
      if (!navigated) scroll = homeScroll(now);
      let led: string | null = null;
      // A warning shows unless someone is looking around the timeline or at an event's page.
      const shown = alert !== null && !navigated && opened === null ? alert : null;
      if (shown !== null && shown.key !== soundFor) {
        // A new warning: one sound and one blink of the LED, with the frame that shows it.
        soundFor = shown.key;
        if (config.sound) {
          device.PlayAudio({ application_name: APP, stock_path: "shared/sounds/calendar_event_starts.snd" }).catch(report);
        }
        led = "";
      }
      const loaded = stored.sources.some((s) => s.updated > 0 || s.error !== "");
      const toastNow = now < toastUntil ? toast : "";
      if (toastNow !== "" || config.sources.length === 0 || !loaded || shown !== null) {
        const front = frontFrame({
          now, offset, configured: config.sources.length > 0, loaded, alert: shown,
          current: null, next: null, browsed: null, toast: toastNow, agenda, vendors: vendors(),
        });
        await sendFront(asWants(front.elements), led === "" ? front.led : null);
      } else if (opened !== null) {
        await sendFront(asWants(eventPage(opened, now, vendors(), offset, todayStart(now), config.sources.length > 1)), null);
      } else {
        const f = timelineFrame(scroll, now, colon);
        picked = f.picked;
        nowY = f.nowY;
        await sendFront(f.want, null);
      }
      let updated = 0;
      for (let i = 0; i < stored.sources.length; i += 1) updated = Math.max(updated, stored.sources[i].updated);
      const back = backFrame({ now, offset, agenda, showAllDay: config.allDay, notice: notice(now), updated, browsed: navigated ? picked : null, vendors: vendors() });
      drawnBack = await sendFrame(back, drawnBack, null);
    } while (drawAgain && !stopped);
  } catch (e) {
    report(e);
    await forgetScreens().catch(report);
  } finally {
    drawing = false;
  }
}

// ---------------------------------------------------------------------------
// Time and calendars.

async function readTime(): Promise<void> {
  try {
    const t = await device.get<{ timestamp: string }>("time");
    const m = /([+-])(\d\d):?(\d\d)$/.exec(t.timestamp);
    offset = m === null ? 0 : (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]);
    const z = await device.get<{ name: string }>("time/timezone");
    zoneName = z.name;
  } catch (e) {
    report(e);
  }
  timeCheckedAt = Date.now();
}

async function readCalendar(i: number): Promise<void> {
  const source = config.sources[i];
  const state = stored.sources[i];
  const now = Date.now();
  const window = { from: now - DAY, to: now + HORIZON };
  const demo = demoOf(source.url);
  if (demo !== null) {
    // The demo calendar: made-up events around now, no network.
    state.instances = demoAgenda(demo.vendor, source.index, now, offset);
    state.updated = now;
    state.error = "";
    state.knownUntil = 0;
    failures[i] = 0;
    nextRead[i] = now + config.refreshMinutes * MIN;
    save(stored, now);
    rebuild();
    return;
  }
  const feed = await loadFeed(source.url, window);
  const result = feed.result;
  // Microsoft's events come in date order, so a cut-off body is still right up to its last whole event.
  const usable = result !== null && (feed.complete || (source.vendor === "microsoft" && result.lastStart !== null));
  if (usable && result !== null) {
    let list = instancesOf(result, source.index, { from: window.from, to: window.to, barOffset: offset });
    let knownUntil = 0;
    if (!feed.complete && result.lastStart !== null) {
      const boundary = new ZoneResolver(result.zones, result.calendarTz, offset).instant(result.lastStart);
      list = list.filter((x) => x.start <= boundary);
      if (boundary < window.to) knownUntil = boundary;
    }
    state.instances = list;
    state.updated = Date.now();
    state.error = "";
    state.knownUntil = knownUntil;
    failures[i] = 0;
    nextRead[i] = Date.now() + config.refreshMinutes * MIN;
    console.log(`${APP}: ${source.name}: ${feed.bytes} B in ${feed.ms} ms, ${result.seen} events, ${list.length} in the window${feed.complete ? "" : ", cut off"}`);
  } else {
    state.error = feed.error !== "" ? feed.error : "could not read";
    failures[i] = (failures[i] || 0) + 1;
    nextRead[i] = Date.now() + RETRY_MIN[Math.min(failures[i] - 1, RETRY_MIN.length - 1)] * MIN;
    console.error(`${APP}: ${source.name}: ${state.error}`);
  }
  // Instances that ended long ago are not worth keeping.
  for (let k = 0; k < stored.sources.length; k += 1) {
    stored.sources[k].instances = stored.sources[k].instances.filter((x) => x.end > Date.now() - DAY);
  }
  save(stored, Date.now());
  rebuild();
}

/** Reads the calendar most overdue, if this is a good moment for the network. */
async function maybeRead(): Promise<void> {
  if (reading || stopped || config.sources.length === 0) return;
  const now = Date.now();
  if (now - lastInput < QUIET_AFTER_INPUT) return;
  let pick = -1;
  for (let i = 0; i < nextRead.length; i += 1) if (nextRead[i] <= now && (pick < 0 || nextRead[i] < nextRead[pick])) pick = i;
  if (pick < 0) return;
  // A calendar never read is worth a short pause even next to a warning; a refresh waits until the warnings are over.
  const first = stored.sources[pick].updated === 0 && stored.sources[pick].error === "";
  const settings = alertSettings();
  if (!first && currentAlert(agenda, now, settings, stored.dismissed) !== null) return;
  if (nextAlertAt(agenda, now, settings) - now < (first ? QUIET_FIRST_READ : QUIET_BEFORE_ALERT)) return;
  reading = true;
  try {
    await readCalendar(pick);
  } catch (e) {
    report(e);
    nextRead[pick] = Date.now() + RETRY_MIN[0] * MIN;
  } finally {
    reading = false;
  }
  void render();
}

// ---------------------------------------------------------------------------
// Keys.

function showToast(text: string, ms = 2500): void {
  toast = text;
  toastUntil = Date.now() + ms;
  void render();
}

function onInput(event: BusyInputEvent, quit: () => void): void {
  const now = Date.now();
  lastInput = now;
  const alert = currentAlert(agenda, now, alertSettings(), stored.dismissed);
  if (event.key === "encoder") {
    if (opened !== null) return;
    // Slow turns move a pixel or two; quick ones speed up.
    const dt = now - lastTurn;
    lastTurn = now;
    const px = dt > 250 ? 1 : dt > 120 ? 2 : dt > 60 ? 4 : 8;
    if (!navigated) scroll = homeScroll(now);
    navigated = true;
    scroll = clampScroll(scroll + event.delta * px);
    void render();
    return;
  }
  if (event.action === "long" && event.key === "ok") {
    for (let i = 0; i < nextRead.length; i += 1) nextRead[i] = now;
    lastInput = 0;
    showToast("Checking calendars");
    return;
  }
  if (event.action !== "short") return;
  if (event.key === "back") {
    // An event's page closes; a timeline moved off now comes back to it; only then does the app leave.
    if (opened !== null) opened = null;
    else if (navigated) navigated = false;
    else return quit();
    void render();
  } else if (event.key === "ok" || event.key === "start") {
    // Start dismisses too: the big button is the easiest to hit when the bar has just pulled you out of focus.
    // It never starts BUSY: the firmware closes every app when a BUSY session starts.
    if (alert !== null && !navigated && opened === null) {
      stored.dismissed.push(alert.key);
      save(stored, now);
    } else if (opened === null && picked !== null) opened = picked;
    void render();
  }
}

async function main(): Promise<void> {
  config = configFrom(await loadValues());
  await readTime();
  stored = load(config.sources.map((s) => s.url), config.sources.map((s) => s.index));
  rebuild();
  const now = Date.now();
  // The first reads go one after another, right away; a calendar read recently by the last launch waits its turn.
  nextRead = stored.sources.map((s, i) => (s.updated > now - config.refreshMinutes * MIN ? s.updated + config.refreshMinutes * MIN : now + i));
  failures = stored.sources.map(() => 0);
  console.log(`${APP}: ${config.sources.length} calendars, bar offset ${offset} min (${zoneName})`);
  void render();

  // The red time's colon blinks: only that image goes, unless something else is being drawn.
  const blink = setInterval(() => {
    colon = !colon;
    if (drawing || opened !== null || frontKey.nt === undefined) return;
    const label = hm(Date.now(), offset);
    const el = { id: "nt", type: "xpmbitmap", data: nowXpm(label, colon), x: 54, y: nowY + 2, z_index: 28 };
    frontKey.nt = `${nowY}${label}${colon}`;
    frontEl.nt = el as unknown as Element;
    device.DisplayDraw({ application_name: APP, priority: 50, elements: [el as unknown as Element] }).catch(report);
  }, 500);

  const timer = setInterval(() => {
    const t = Date.now();
    if (t - timeCheckedAt > TIME_CHECK) readTime().catch(report);
    void render();
    maybeRead().catch(report);
  }, TICK_MS);

  const unbind = listen("input", (event) => {
    if (stopped) return;
    onInput(event, () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(blink);
      // Not from inside the handler: with nothing left the unbind stops the app on the spot.
      setTimeout(unbind, 0);
    });
  });
}

main().catch(report);
