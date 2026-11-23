/**
 * Turns the pieces of a streamed iCal body into logical lines.
 *
 * The bar's `fetch` hands over `Uint8Array` pieces and the firmware has no
 * `TextDecoder`, so UTF-8 is decoded here; a character split between two pieces
 * waits for the next one. Each piece is cut into lines with one `split`, which
 * on the bar costs far less than a `slice` per line (probe of 18.11).
 *
 * A line that starts with a space or a tab continues the previous one (RFC 5545
 * folding). Most of a calendar is text the app never shows (descriptions,
 * attendees, HTML), so `wanted` is asked once per logical line, by its first
 * physical line: an unwanted line's continuations are dropped without being
 * joined, and the line never reaches `onLine`.
 */

export type LineHandler = (line: string) => void;
export type LineFilter = (firstPart: string) => boolean;

/** A piece of ASCII becomes a string in one call; null if any byte is not ASCII. */
function asciiText(bytes: Uint8Array): string | null {
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] > 127) return null;
  // apply() takes the typed array as the argument list; a piece is at most a few KiB.
  return String.fromCharCode.apply(null, bytes as unknown as number[]);
}

/**
 * Decodes UTF-8. `carry` holds the bytes of a character cut off at the end of
 * the previous piece; the same kind of tail of this piece is returned as `carry`.
 */
export function decodeUtf8(bytes: Uint8Array, carry: Uint8Array | null): { text: string; carry: Uint8Array | null } {
  if (carry === null) {
    const fast = asciiText(bytes);
    if (fast !== null) return { text: fast, carry: null };
  }
  let all = bytes;
  if (carry !== null && carry.length > 0) {
    all = new Uint8Array(carry.length + bytes.length);
    all.set(carry, 0);
    all.set(bytes, carry.length);
  }
  // Leave out a multi-byte character that is not complete yet.
  let end = all.length;
  let i = end - 1;
  let back = 0;
  while (i >= 0 && back < 4 && (all[i] & 0xc0) === 0x80) {
    i -= 1;
    back += 1;
  }
  if (i >= 0 && all[i] >= 0xc0) {
    const need = all[i] >= 0xf0 ? 4 : all[i] >= 0xe0 ? 3 : 2;
    if (end - i < need) end = i;
  }
  let text = "";
  for (let k = 0; k < end; ) {
    const b = all[k];
    if (b < 0x80) {
      text += String.fromCharCode(b);
      k += 1;
    } else if (b < 0xe0) {
      text += String.fromCharCode(((b & 0x1f) << 6) | (all[k + 1] & 0x3f));
      k += 2;
    } else if (b < 0xf0) {
      text += String.fromCharCode(((b & 0x0f) << 12) | ((all[k + 1] & 0x3f) << 6) | (all[k + 2] & 0x3f));
      k += 3;
    } else {
      const cp = (((b & 0x07) << 18) | ((all[k + 1] & 0x3f) << 12) | ((all[k + 2] & 0x3f) << 6) | (all[k + 3] & 0x3f)) - 0x10000;
      text += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      k += 4;
    }
  }
  return { text, carry: end < all.length ? all.slice(end) : null };
}

export class LineReader {
  private pending = "";
  private carry: Uint8Array | null = null;
  /** The logical line being collected, or null. */
  private current: string | null = null;
  /** Whether the line before was unwanted: its continuations are skipped. */
  private skipping = false;
  /** Longest unfinished line held, for the probe's memory numbers. */
  maxPending = 0;

  private readonly onLine: LineHandler;
  private readonly wanted: LineFilter;

  constructor(onLine: LineHandler, wanted: LineFilter) {
    this.onLine = onLine;
    this.wanted = wanted;
  }

  push(piece: Uint8Array | string): void {
    if (typeof piece === "string") {
      this.feed(piece);
      return;
    }
    const decoded = decodeUtf8(piece, this.carry);
    this.carry = decoded.carry;
    this.feed(decoded.text);
  }

  /** The body has ended: hand over what is left. */
  end(): void {
    this.feed("\n");
    this.flush();
  }

  private feed(text: string): void {
    const parts = (this.pending + text).split("\n");
    this.pending = parts.pop() as string;
    if (this.pending.length > this.maxPending) this.maxPending = this.pending.length;
    for (let i = 0; i < parts.length; i += 1) {
      let part = parts[i];
      if (part.charCodeAt(part.length - 1) === 13) part = part.slice(0, -1);
      const c = part.charCodeAt(0);
      if (c === 32 || c === 9) {
        // A continuation of the line before.
        if (!this.skipping && this.current !== null) this.current += part.slice(1);
        continue;
      }
      this.flush();
      if (part.length === 0) continue;
      if (this.wanted(part)) {
        this.current = part;
        this.skipping = false;
      } else {
        this.skipping = true;
      }
    }
  }

  private flush(): void {
    if (this.current !== null) {
      const line = this.current;
      this.current = null;
      this.onLine(line);
    }
  }
}
