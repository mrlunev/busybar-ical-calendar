/**
 * What the app keeps between launches, in localStorage: each calendar's
 * instances for the coming days and how its last read went, and the warnings
 * already dismissed. The calendar links themselves are not copied: they live in
 * the bar's settings only. A calendar is recognised by a hash of its link, so a
 * changed link starts empty.
 */

import type { Instance } from "./agenda.ts";
import { hash } from "./ics/parse.ts";

const KEY = "calendar.v1";
/** Dismissed warnings older than this are forgotten. */
const KEEP_DISMISSED = 2 * 86400000;

export interface SourceState {
  /** Hash of the link. */
  key: string;
  /** When the last read that gave events finished; 0: never. */
  updated: number;
  /** Why the last read failed, or "". */
  error: string;
  /** For a cut-off body: instances are known only up to here; 0: all known. */
  knownUntil: number;
  instances: Instance[];
}

export interface Stored {
  sources: SourceState[];
  dismissed: string[];
}

type Packed = [number, number, number, number, string, string, string];

function pack(x: Instance): Packed {
  return [x.start, x.end, x.allDay ? 1 : 0, x.free ? 1 : 0, x.title, x.location, x.uid];
}

function unpack(p: Packed, source: number): Instance {
  return { start: p[0], end: p[1], allDay: p[2] === 1, free: p[3] === 1, title: p[4], location: p[5], uid: p[6], source };
}

export function keyOf(url: string): string {
  return hash(url);
}

/** The stored state for these links (by index), empty for the ones not seen before. */
export function load(urls: readonly string[], indexes: readonly number[]): Stored {
  let raw: { s?: { k: string; u: number; e: string; n: number; i: Packed[] }[]; d?: string[] } = {};
  try {
    const text = localStorage.getItem(KEY);
    if (text !== null) raw = JSON.parse(text);
  } catch {
    raw = {};
  }
  const saved = raw.s || [];
  const sources: SourceState[] = urls.map((url, i) => {
    const key = keyOf(url);
    for (let k = 0; k < saved.length; k += 1) {
      const s = saved[k];
      if (s.k === key) return { key, updated: s.u, error: s.e, knownUntil: s.n, instances: s.i.map((p) => unpack(p, indexes[i])) };
    }
    return { key, updated: 0, error: "", knownUntil: 0, instances: [] };
  });
  return { sources, dismissed: raw.d || [] };
}

export function save(stored: Stored, now: number): void {
  const dismissed = stored.dismissed.filter((k) => {
    const start = +k.slice(k.lastIndexOf("|") + 1);
    return start > now - KEEP_DISMISSED;
  });
  stored.dismissed = dismissed;
  const raw = {
    s: stored.sources.map((s) => ({ k: s.key, u: s.updated, e: s.error, n: s.knownUntil, i: s.instances.map(pack) })),
    d: dismissed,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch (e) {
    console.error(`calendar: could not save: ${String(e)}`);
  }
}
