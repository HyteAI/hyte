import test from "node:test";
import assert from "node:assert/strict";
import { localDateTime, jobsFromState } from "../api/_lib/schedule.js";
import { body, requireMethod, requireOwner, send } from "../api/_lib/shared.js";
import { safeEndpoint } from "../api/_lib/push.js";
import { validateExtraction } from "../api/extract.js";

const now = Date.parse("2026-11-01T00:00:00Z");
const owner = "00000000-0000-4000-8000-000000000001";
function state(overrides = {}) {
  return {
    settings: { timeZone: "Asia/Muscat" },
    events: [
      {
        id: "college",
        title: "Class",
        date: "2026-11-05",
        start: "09:00",
        end: "10:00",
        reminderMinutes: 15,
      },
    ],
    tasks: [],
    ...overrides,
  };
}

test("scheduler converts Muscat wall time and subtracts reminder lead across midnight", () => {
  assert.equal(
    localDateTime("2026-11-05", "09:00", "Asia/Muscat"),
    "2026-11-05T05:00:00.000Z",
  );
  const jobs = jobsFromState(
    state({
      events: [
        {
          id: "a",
          title: "Early",
          date: "2026-11-05",
          start: "00:10",
          reminderMinutes: 30,
        },
      ],
    }),
    owner,
    2,
    now,
  );
  assert.equal(jobs[0].due_at, "2026-11-04T19:40:00.000Z");
  assert.equal(jobs[0].source_revision, 2);
});

test("scheduler rejects invalid dates/times and nonexistent DST times without guessing", () => {
  for (const [date, time] of [
    ["2026-02-30", "09:00"],
    ["2026-11-05", "25:00"],
    ["2026-11-05", "09:70"],
    ["", "09:00"],
  ]) {
    assert.equal(localDateTime(date, time, "Asia/Muscat"), null);
  }
  assert.equal(localDateTime("2026-03-08", "02:30", "America/New_York"), null);
  assert.equal(
    localDateTime("2026-11-01", "01:30", "America/New_York"),
    "2026-11-01T05:30:00.000Z",
  );
  // Use the same earliest-occurrence convention as client exports and calendars.
  assert.equal(
    localDateTime("2026-10-25", "01:30", "Europe/London"),
    "2026-10-25T00:30:00.000Z",
  );
  assert.throws(
    () =>
      jobsFromState(
        state({ settings: { timeZone: "Invalid/Zone" } }),
        owner,
        1,
        now,
      ),
    RangeError,
  );
});

test("reminder edits change job identity; revision-only saves preserve identity", () => {
  const initial = jobsFromState(state(), owner, 1, now)[0];
  const laterSave = jobsFromState(state(), owner, 2, now)[0];
  assert.equal(initial.id, laterSave.id);
  assert.equal(laterSave.source_revision, 2);
  const edited = jobsFromState(
    state({ events: [{ ...state().events[0], start: "10:00" }] }),
    owner,
    3,
    now,
  )[0];
  assert.notEqual(initial.id, edited.id);
  assert.notEqual(initial.due_at, edited.due_at);
  assert.notEqual(
    initial.id,
    jobsFromState(state(), "different-owner", 1, now)[0].id,
  );
  assert.equal(jobsFromState(state({ events: [] }), owner, 4, now).length, 0);
});

test("completed, all-day, disabled, malformed, and overdue reminders do not queue", () => {
  const base = state().events[0];
  const cases = [
    { ...base, allDay: true },
    { ...base, reminderMinutes: null },
    { ...base, reminderMinutes: undefined },
    { ...base, reminderMinutes: -1 },
    { ...base, reminderMinutes: Infinity },
    { ...base, reminderMinutes: "" },
    { ...base, reminderMinutes: "0" },
    { ...base, reminderMinutes: false },
    { ...base, date: "2026-10-31" },
    { ...base, start: "" },
  ];
  assert.deepEqual(jobsFromState(state({ events: cases }), owner, 1, now), []);
  const tasks = [
    {
      id: "a",
      title: "Done",
      date: "2026-11-05",
      time: "11:00",
      reminderMinutes: 0,
      done: true,
    },
    {
      id: "b",
      title: "Due",
      date: "2026-11-05",
      time: "11:00",
      reminderMinutes: 0,
      done: false,
    },
  ];
  const result = jobsFromState(state({ events: [], tasks }), owner, 1, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].item_key, "task:b");
  assert.equal(result[0].due_at, "2026-11-05T07:00:00.000Z");
});

test("push endpoint allowlist prevents SSRF through arbitrary subscriptions", () => {
  for (const url of [
    "https://web.push.apple.com/token",
    "https://fcm.googleapis.com/token",
    "https://updates.push.services.mozilla.com/token",
  ])
    assert.equal(safeEndpoint(url), true);
  for (const url of [
    "http://web.push.apple.com/a",
    "https://127.0.0.1/a",
    "https://localhost/a",
    "https://web.push.apple.com.evil.test/a",
    "https://web.push.apple.com:8080/a",
    "https://secret@web.push.apple.com/a",
    "not-a-url",
  ])
    assert.equal(safeEndpoint(url), false);
});

test("image extraction validates real dates, preserves Arabic, and rejects duplicates", () => {
  const day = {
    date: "2026-11-05",
    hijriLabel: "مثال للمراجعة",
    entries: [{ name: "الفجر", time: "04:56", kind: "prayer" }],
  };
  const data = { days: [day], events: [], warnings: [] };
  assert.equal(validateExtraction(data).days[0].entries[0].name, "الفجر");
  assert.throws(() =>
    validateExtraction({ ...data, days: [{ ...day, date: "2026-02-30" }] }),
  );
  assert.throws(() =>
    validateExtraction({
      ...data,
      days: [{ ...day, entries: [{ ...day.entries[0], time: "4:56" }] }],
    }),
  );
  assert.throws(
    () => validateExtraction({ ...data, days: [day, day] }),
    (error) => error.status === 422,
  );
  assert.throws(
    () =>
      validateExtraction({
        ...data,
        days: [{ ...day, entries: [day.entries[0], day.entries[0]] }],
      }),
    (error) => error.status === 422,
  );
  assert.throws(() =>
    validateExtraction({
      ...data,
      events: [
        {
          title: "Event",
          date: day.date,
          start: "12:00",
          end: "11:00",
          allDay: false,
          notes: "",
        },
      ],
    }),
  );
  assert.deepEqual(
    validateExtraction({
      days: [],
      events: [],
      warnings: ["No readable dated rows."],
    }).days,
    [],
  );
});

test("API method, payload limit, and cache helpers produce explicit safe errors", () => {
  const headers = {};
  const res = {
    setHeader: (name, value) => {
      headers[name] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
  assert.throws(
    () => requireMethod({ method: "DELETE" }, res, ["GET", "POST"]),
    (error) => error.status === 405,
  );
  assert.equal(headers.Allow, "GET, POST");
  assert.doesNotThrow(() => requireMethod({ method: "POST" }, res, ["POST"]));
  assert.throws(
    () => body({ body: "{bad" }),
    (error) => error.status === 400,
  );
  assert.throws(
    () => body({ body: { data: "a".repeat(100) } }, 30),
    (error) => error.status === 413,
  );
  send(res, 200, { ready: true });
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(res.code, 200);
});

test("owner authentication rejects a missing bearer token before any network request", async () => {
  const values = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    HYTE_OWNER_ID: process.env.HYTE_OWNER_ID,
  };
  try {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "placeholder-public-key";
    process.env.HYTE_OWNER_ID = owner;
    await assert.rejects(
      requireOwner({ headers: {} }),
      (error) => error.status === 401,
    );
  } finally {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
