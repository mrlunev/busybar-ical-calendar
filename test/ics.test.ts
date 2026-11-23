import assert from "node:assert/strict";
import { test } from "node:test";

import { instancesOf, mergeAgenda, type Instance } from "../src/agenda.ts";
import { IcsParser, parseDate, parseDuration } from "../src/ics/parse.ts";
import { expand, parseRule } from "../src/ics/rrule.ts";
import { LineReader, decodeUtf8 } from "../src/ics/text.ts";
import { ZoneResolver, knownZone, offsetAt } from "../src/ics/tz.ts";
import { cleanText, fitsSmall, smallText } from "../src/glyphs.ts";

const H = 3600000;
const DAY = 24 * H;
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);

/** Runs a calendar written as lines through the reader and the parser, in pieces of `piece` bytes. */
function parse(lines: string[], now: number, piece = 37) {
  const parser = new IcsParser({ from: now - DAY, to: now + 7 * DAY });
  const reader = new LineReader(parser.line, parser.wanted);
  const bytes = new TextEncoder().encode(lines.join("\r\n") + "\r\n");
  for (let i = 0; i < bytes.length; i += piece) reader.push(bytes.subarray(i, i + piece));
  reader.end();
  return parser.result;
}

function agenda(lines: string[], now: number, barOffset = 0): Instance[] {
  return mergeAgenda([instancesOf(parse(lines, now), 0, { from: now - DAY, to: now + 7 * DAY, barOffset })]);
}

// Wednesday 18 November 2026, 09:00 UTC.
const NOW = Date.UTC(2026, 10, 18, 9);

test("text: folded lines are joined, unwanted ones skipped with their continuations", () => {
  const got: string[] = [];
  const reader = new LineReader((l) => got.push(l), (first) => !first.startsWith("DESCRIPTION"));
  reader.push("SUMMARY:Long ti\r\n tle\r\nDESCRIPTION:aaa\r\n bbb\r\n ccc\r\nLOCATION:Room");
  reader.push(" 1\r\n");
  reader.end();
  assert.deepEqual(got, ["SUMMARY:Long title", "LOCATION:Room 1"]);
});

test("text: UTF-8 split between pieces is decoded whole", () => {
  const bytes = new TextEncoder().encode("Планёрка ü");
  let carry: Uint8Array | null = null;
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const r = decodeUtf8(bytes.subarray(i, i + 3), carry);
    text += r.text;
    carry = r.carry;
  }
  assert.equal(text, "Планёрка ü");
});

test("glyphs: emoji dropped, Cyrillic fits small, diacritics folded for small", () => {
  assert.equal(cleanText("🚀 Запуск  релиза ✅"), "Запуск релиза ✅".replace("✅", "✅"));
  assert.equal(cleanText("🎉🎉"), "?");
  assert.equal(fitsSmall("Планёрка — «итоги»"), true);
  assert.equal(fitsSmall("Zürich"), false);
  assert.equal(smallText("Café with Zoë"), "Cafe with Zoe");
  assert.equal(smallText("Łódź, Kraków, Straße, Œuvre, Ærø, ȘȚ"), "Lodz, Krakow, Strasse, OEuvre, AEro, ST");
  assert.equal(smallText("Планёрка"), "Планёрка");
  assert.equal(smallText("中文"), "??");
  assert.equal(fitsSmall(smallText("Ångström ĳ ŉ ſ")), true);
});

test("dates and durations", () => {
  assert.deepEqual(parseDate("20261118T093000Z", ""), { wall: Date.UTC(2026, 10, 18, 9, 30), tz: "Z", allDay: false });
  assert.deepEqual(parseDate("20261118", "VALUE=DATE"), { wall: Date.UTC(2026, 10, 18), tz: "", allDay: true });
  assert.equal(parseDate("20261118T093000", 'TZID="W. Europe Standard Time"')?.tz, "W. Europe Standard Time");
  assert.equal(parseDate("20261118T093000", "TZID=Europe/Berlin\u0000\u0000")?.tz, "Europe/Berlin");
  assert.equal(parseDuration("PT1H30M"), 90 * 60000);
  assert.equal(parseDuration("-PT15M"), -15 * 60000);
  assert.equal(parseDuration("P1D"), DAY);
});

test("time zones: table rules switch on the right days", () => {
  const berlin = knownZone("Europe/Berlin")!;
  assert.equal(offsetAt(berlin, Date.UTC(2026, 0, 10)), 60);
  assert.equal(offsetAt(berlin, Date.UTC(2026, 6, 10)), 120);
  // 2026: last Sunday of March is the 29th, of October the 25th, at 01:00 UTC.
  assert.equal(offsetAt(berlin, Date.UTC(2026, 2, 29, 0, 59)), 60);
  assert.equal(offsetAt(berlin, Date.UTC(2026, 2, 29, 1, 0)), 120);
  assert.equal(offsetAt(berlin, Date.UTC(2026, 9, 25, 0, 59)), 120);
  assert.equal(offsetAt(berlin, Date.UTC(2026, 9, 25, 1, 0)), 60);
  const ny = knownZone("Eastern Standard Time")!;
  // 2026: second Sunday of March is the 8th, first Sunday of November the 1st, at 02:00 local.
  assert.equal(offsetAt(ny, Date.UTC(2026, 2, 8, 6, 59)), -300);
  assert.equal(offsetAt(ny, Date.UTC(2026, 2, 8, 7, 0)), -240);
  assert.equal(offsetAt(ny, Date.UTC(2026, 10, 1, 5, 59)), -240);
  assert.equal(offsetAt(ny, Date.UTC(2026, 10, 1, 6, 0)), -300);
  assert.equal(offsetAt(knownZone("(UTC+05:30) Chennai, Kolkata")!, NOW), 330);
  const r = new ZoneResolver({}, "", 240);
  assert.equal(r.wallToUtc(Date.UTC(2026, 10, 18, 10), "Unknown/Zone"), Date.UTC(2026, 10, 18, 6));
  assert.equal(r.wallToUtc(Date.UTC(2026, 6, 1, 10), "Europe/Berlin"), Date.UTC(2026, 6, 1, 8));
});

/** Compares our expansion with the rrule library over a window, both in UTC wall time. */
async function sameAsReference(rule: string, start: number, from: number, to: number) {
  const { RRule } = (await import("rrule")).default ?? (await import("rrule"));
  const ref = new RRule({ ...RRule.parseString(rule), dtstart: new Date(start) })
    .between(new Date(from), new Date(to), true)
    .map((d: Date) => d.getTime());
  const ours = expand(parseRule(rule)!, start, from, to, (w) => w);
  assert.deepEqual(ours.map(iso), ref.map(iso), rule);
}

test("repeats match the reference library", async () => {
  const start = Date.UTC(2016, 1, 1, 9, 30); // a Monday, years before the window
  const from = Date.UTC(2026, 10, 15);
  const to = Date.UTC(2027, 1, 20);
  for (const rule of [
    "FREQ=DAILY",
    "FREQ=DAILY;INTERVAL=3",
    "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=SU",
    "FREQ=WEEKLY;INTERVAL=3",
    "FREQ=MONTHLY;BYDAY=2TU",
    "FREQ=MONTHLY;BYDAY=-1FR",
    "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
    "FREQ=MONTHLY;BYMONTHDAY=1,15,-1",
    "FREQ=MONTHLY;INTERVAL=2",
    "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
    "FREQ=YEARLY",
    "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261201T000000Z",
    "FREQ=DAILY;COUNT=4000",
    "FREQ=WEEKLY;BYDAY=WE;COUNT=560",
  ]) {
    await sameAsReference(rule, start, from, to);
  }
  // A series that starts on the 31st skips the short months.
  await sameAsReference("FREQ=MONTHLY", Date.UTC(2026, 0, 31, 8), Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
});

const MS_TZ = [
  "BEGIN:VTIMEZONE",
  "TZID:W. Europe Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

test("Microsoft: Windows zone from VTIMEZONE, weekly series with an exception and a moved instance", () => {
  const cal = [
    "BEGIN:VCALENDAR",
    "PRODID:Microsoft Exchange Server 2010",
    ...MS_TZ,
    "BEGIN:VEVENT",
    "UID:040000008200E00074C5B7101A82E008000000001",
    "RRULE:FREQ=WEEKLY;UNTIL=20270101T080000Z;INTERVAL=1;BYDAY=MO,WE,FR;WKST=MO",
    "EXDATE;TZID=W. Europe Standard Time:20261120T090000",
    "SUMMARY:Standup",
    "DTSTART;TZID=W. Europe Standard Time:20250106T090000",
    "DTEND;TZID=W. Europe Standard Time:20250106T091500",
    "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    "BEGIN:VALARM",
    "DESCRIPTION:REMINDER",
    "TRIGGER;RELATED=START:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:040000008200E00074C5B7101A82E008000000001",
    "RECURRENCE-ID;TZID=W. Europe Standard Time:20261123T090000",
    "SUMMARY:Standup (moved)",
    "DTSTART;TZID=W. Europe Standard Time:20261123T113000",
    "DTEND;TZID=W. Europe Standard Time:20261123T114500",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:free-1",
    "SUMMARY:Lunch",
    "DTSTART;TZID=W. Europe Standard Time:20261118T120000",
    "DTEND;TZID=W. Europe Standard Time:20261118T130000",
    "X-MICROSOFT-CDO-BUSYSTATUS:FREE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const list = agenda(cal, NOW);
  assert.deepEqual(
    list.map((x) => [iso(x.start), x.title, x.free]),
    [
      // 17 November is a Tuesday: the series runs on Mondays, Wednesdays and Fridays; Friday the 20th is excluded.
      ["2026-11-18T08:00", "Standup", false],
      ["2026-11-18T11:00", "Lunch", true],
      ["2026-11-23T10:30", "Standup (moved)", false],
      ["2026-11-25T08:00", "Standup", false],
    ],
  );
  assert.equal(list[0].end - list[0].start, 15 * 60000);
});

test("Google: UTC times, a cancelled instance, an all-day event at the bar's midnight", () => {
  const cal = [
    "BEGIN:VCALENDAR",
    "X-WR-TIMEZONE:Europe/Berlin",
    "BEGIN:VEVENT",
    "DTSTART:20261118T130000Z",
    "DTEND:20261118T140000Z",
    "UID:a@google.com",
    "SUMMARY:Ревью дизайна",
    "DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\nLong text",
    " that goes on",
    "ATTENDEE;CN=Someone:mailto:someone@example.com",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261119",
    "DTEND;VALUE=DATE:20261120",
    "UID:b@google.com",
    "SUMMARY:Day off",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261120T100000Z",
    "DTEND:20261120T110000Z",
    "UID:c@google.com",
    "STATUS:CANCELLED",
    "SUMMARY:Gone",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const list = agenda(cal, NOW, 240);
  assert.deepEqual(list.map((x) => [iso(x.start), x.title, x.allDay]), [
    ["2026-11-18T13:00", "Ревью дизайна", false],
    ["2026-11-18T20:00", "Day off", true],
  ]);
  assert.equal(list[1].end - list[1].start, DAY);
});

test("iCloud and Nextcloud: IANA zone across a daylight change, monthly with BYSETPOS", () => {
  const cal = [
    "BEGIN:VCALENDAR",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "DTSTART:20070311T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "DTSTART:20071104T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:series",
    "DTSTART;TZID=America/New_York:20260601T100000",
    "DTEND;TZID=America/New_York:20260601T110000",
    "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1",
    "SUMMARY:First workday",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // 1 December 2026 is a Tuesday; New York is on standard time, UTC-5.
  const now = Date.UTC(2026, 10, 30, 12);
  const list = agenda(cal, now);
  assert.deepEqual(list.map((x) => iso(x.start)), ["2026-12-01T15:00"]);
});

test("a cut-off body: the parser reports where the trustworthy part ends", () => {
  const lines = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT", "UID:1", "DTSTART:20261118T100000Z", "DTEND:20261118T110000Z", "SUMMARY:One", "END:VEVENT",
    "BEGIN:VEVENT", "UID:2", "DTSTART:20261119T100000Z", "DTEND:20261119T110000Z", "SUMMARY:Tw",
  ];
  const r = parse(lines, NOW);
  assert.equal(r.complete, false);
  assert.equal(r.calendar, true);
  assert.equal(r.events.length, 1);
  assert.equal(r.lastStart?.wall, Date.UTC(2026, 10, 18, 10));
});

test("merge: the same meeting in two calendars shows once", () => {
  const a: Instance = { start: 1, end: 2, allDay: false, title: "Sync", location: "", source: 0, uid: "x", free: false };
  const b: Instance = { ...a, source: 1, uid: "y" };
  const c: Instance = { ...a, source: 1, uid: "z", title: "Other" };
  assert.equal(mergeAgenda([[a], [b, c]]).length, 2);
});
