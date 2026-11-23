/**
 * The app's settings as the app uses them. They are read once, at start (the
 * firmware gives an app its settings only then); reading is in main.ts, so this
 * file stays free of the device and runs in the tests.
 */

export type SettingsValues = Record<string, unknown>;

import { defaultName, normalizeUrl, vendorOf, type Source } from "./sources.ts";

export const SLOTS = 3;

export interface Config {
  sources: Source[];
  /** Warn this many minutes before; 0: no early warning. */
  lead: number;
  atStart: boolean;
  sound: boolean;
  allDay: boolean;
  refreshMinutes: number;
}

function group(values: SettingsValues | null, key: string): SettingsValues {
  const g = values !== null ? values[key] : null;
  return g !== null && typeof g === "object" ? (g as SettingsValues) : {};
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function configFrom(values: SettingsValues | null): Config {
  const sources: Source[] = [];
  for (let i = 0; i < SLOTS; i += 1) {
    const g = group(values, `calendar_${i + 1}`);
    const url = normalizeUrl(str(g.url, ""));
    if (url === "") continue;
    const vendor = vendorOf(url);
    const name = str(g.name, "").trim();
    sources.push({ index: i, url, name: name !== "" ? name : defaultName(vendor), alerts: bool(g.alerts, true), vendor });
  }
  // The settings for all calendars sit in their own group, under a heading of their own in the web page.
  const general = group(values, "general");
  const lead = +str(general.alert_minutes, "5");
  const refresh = +str(general.refresh_minutes, "10");
  return {
    sources,
    lead: lead >= 0 ? lead : 5,
    atStart: bool(general.alert_at_start, true),
    sound: bool(general.sound, true),
    allDay: bool(general.all_day, true),
    refreshMinutes: refresh >= 1 ? refresh : 10,
  };
}
