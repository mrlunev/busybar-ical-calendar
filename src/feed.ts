/**
 * Reads one calendar over the network, straight into the parser.
 *
 * The bar's fetch does not follow redirects, so they are followed here. The
 * body is read piece by piece and never held whole. At the end the body is
 * checked for being complete: firmware 1.4.1 drops the tail of some answers
 * (Microsoft 365, TLS records of 16 KiB) without any error.
 */

import { IcsParser, type ParseResult } from "./ics/parse.ts";
import { LineReader } from "./ics/text.ts";

export interface FeedResult {
  /** Null when nothing usable came; `error` says why. */
  result: ParseResult | null;
  error: string;
  /** The whole calendar arrived. */
  complete: boolean;
  bytes: number;
  ms: number;
}

const MAX_REDIRECTS = 5;

function message(e: unknown): string {
  const text = String(e !== null && typeof e === "object" && "message" in e ? (e as Error).message : e);
  return text.length > 40 ? text.slice(0, 40) : text;
}

function resolve(location: string, base: string): string {
  if (/^https?:\/\//i.test(location)) return location;
  const origin = (/^https?:\/\/[^/]+/i.exec(base) || [""])[0];
  return location.charAt(0) === "/" ? origin + location : base.slice(0, base.lastIndexOf("/") + 1) + location;
}

export async function loadFeed(url: string, window: { from: number; to: number }): Promise<FeedResult> {
  const t0 = Date.now();
  const failed = (error: string): FeedResult => ({ result: null, error, complete: false, bytes: 0, ms: Date.now() - t0 });
  let address = url;
  let response: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(address);
      const status = response.status;
      if (status < 300 || status >= 400) break;
      const location = response.headers.get("location");
      await response.text().catch(() => "");
      if (location === null || location === "") return failed(`HTTP ${status} without an address`);
      address = resolve(location, address);
      response = null;
    }
  } catch (e) {
    return failed(message(e));
  }
  if (response === null) return failed("too many redirects");
  if (!response.ok) {
    await response.text().catch(() => "");
    return failed(response.status === 404 || response.status === 410 ? "link no longer works" : `HTTP ${response.status}`);
  }
  if (response.body === null) return failed("empty answer");

  const declared = response.headers.get("content-length");
  const parser = new IcsParser(window);
  const lines = new LineReader(parser.line, parser.wanted);
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const value = part.value as Uint8Array | string;
      bytes += typeof value === "string" ? value.length : value.byteLength;
      lines.push(value);
    }
    lines.end();
  } catch (e) {
    // Whatever was read before the error is still worth its check below.
    lines.end();
    if (!parser.result.calendar) return failed(message(e));
  }
  const result = parser.result;
  if (!result.calendar) return failed("not a calendar link");
  const complete = result.complete && (declared === null || +declared === bytes);
  return { result, error: complete ? "" : "came in part", complete, bytes, ms: Date.now() - t0 };
}
