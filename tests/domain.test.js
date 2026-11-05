import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultState,
  defaultState,
  dateKey,
  addDays,
  dayDiff,
  dateTimeISO,
  hijriDate,
  challengeStatus,
  checkIn,
  resetChallenge,
  nextPrayer,
  validateImport,
  makeCalendarFile,
  validateBackup,
  undoImportedSchedule,
} from "../src/lib/domain.js";

const challenge = (checkIns = [], other = {}) => ({
  id: "challenge-1",
  title: "Read daily",
  description: "",
  createdDate: "2026-11-01",
  timeZone: "Asia/Muscat",
  checkIns,
  resets: 0,
  ...other,
});
const entry = (name, time, kind = "prayer") => ({ name, time, kind });
const event = (other = {}) => ({
  id: "event-1",
  title: "Study",
  date: "2026-11-05",
  start: "09:00",
  end: "10:00",
  allDay: false,
  category: "College",
  ...other,
});

test("fresh state copies never share mutable collections or settings", () => {
  const a = createDefaultState(),
    b = createDefaultState();
  a.tasks.push({ title: "One" });
  a.settings.city = "Other";
  assert.equal(b.tasks.length, 0);
  assert.equal(defaultState.settings.city, "Muscat");
});

test("date keys respect Muscat midnight rather than the machine zone", () => {
  assert.equal(dateKey(new Date("2026-11-04T20:00:00Z")), "2026-11-05");
  assert.equal(dateKey(new Date("2026-11-04T19:59:59Z")), "2026-11-04");
  assert.equal(
    dateKey(new Date("2026-11-04T23:00:00Z"), "America/New_York"),
    "2026-11-04",
  );
  assert.throws(() => dateKey(new Date("bad")), /invalid/);
});

test("date arithmetic crosses years and leap days without DST effects", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dayDiff("2026-03-07", "2026-03-09"), 2);
  assert.throws(() => addDays("2026-02-30", 1), /valid Gregorian/);
  assert.throws(() => addDays("2026-11-01", 0.5), /whole/);
});

test("wall-time conversion handles Muscat, date rollover, and DST overlaps/gaps", () => {
  assert.equal(dateTimeISO("2026-11-05", "09:00"), "2026-11-05T05:00:00.000Z");
  assert.equal(dateTimeISO("2026-11-05", "00:30"), "2026-11-04T20:30:00.000Z");
  assert.equal(
    dateTimeISO("2026-11-01", "01:30", "America/New_York"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.throws(
    () => dateTimeISO("2026-03-08", "02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(() => dateTimeISO("2026-11-05", "24:00"), /24-hour/);
  assert.throws(
    () => dateTimeISO("2026-11-05", "10:00", "Not/AZone"),
    RangeError,
  );
});

test("Hijri offset shifts only date presentation", () => {
  const original = "2026-11-05";
  assert.equal(hijriDate(original, 1), hijriDate(addDays(original, 1), 0));
  assert.match(hijriDate(original), /[\u0600-\u06ff]/);
  assert.equal(original, "2026-11-05");
});

test("challenge starts on first check-in and does not mutate the previous state", () => {
  const previous = challenge();
  assert.deepEqual(challengeStatus(previous, "2026-11-05"), {
    count: 0,
    checkedToday: false,
    broken: false,
    complete: false,
  });
  const updated = checkIn(previous, "2026-11-05");
  assert.deepEqual(previous.checkIns, []);
  assert.deepEqual(updated.checkIns, ["2026-11-05"]);
  assert.equal(challengeStatus(updated, "2026-11-05").count, 1);
});

test("a second check-in on the same day cannot increase progress", () => {
  const c = challenge(["2026-11-05"]);
  assert.throws(() => checkIn(c, "2026-11-05"), /already checked/);
  assert.equal(
    challengeStatus(challenge(["2026-11-05", "2026-11-05"]), "2026-11-05")
      .count,
    1,
  );
});

test("consecutive challenge days bridge month and year boundaries", () => {
  const c = challenge(["2026-12-30", "2026-12-31"]);
  const updated = checkIn(c, "2027-01-01");
  assert.deepEqual(challengeStatus(updated, "2027-01-01"), {
    count: 3,
    checkedToday: true,
    broken: false,
    complete: false,
  });
});

test("missing a day breaks the attempt and requires an explicit reset", () => {
  const c = challenge(["2026-11-01", "2026-11-02"]);
  assert.equal(challengeStatus(c, "2026-11-03").broken, false);
  assert.deepEqual(challengeStatus(c, "2026-11-04"), {
    count: 0,
    checkedToday: false,
    broken: true,
    complete: false,
  });
  assert.throws(() => checkIn(c, "2026-11-04"), /Reset/);
  assert.equal(
    challengeStatus(challenge(["2026-11-01", "2026-11-03"]), "2026-11-03")
      .broken,
    true,
  );
  const reset = resetChallenge(c, "2026-11-04");
  assert.equal(reset.timeZone, "Asia/Muscat");
  assert.equal(reset.resets, 1);
  assert.equal(checkIn(reset, "2026-11-04").checkIns.length, 1);
  assert.deepEqual(c.checkIns, ["2026-11-01", "2026-11-02"]);
});

test("exactly 40 consecutive days complete a challenge and completion persists", () => {
  const days = Array.from({ length: 39 }, (_, index) =>
    addDays("2026-10-01", index),
  );
  const c = checkIn(
    challenge(days, { createdDate: "2026-10-01" }),
    "2026-11-09",
  );
  assert.deepEqual(challengeStatus(c, "2026-11-09"), {
    count: 40,
    checkedToday: true,
    broken: false,
    complete: true,
  });
  assert.equal(challengeStatus(c, "2026-12-05").complete, true);
  assert.throws(() => checkIn(c, "2026-11-10"), /complete/);
});

test("backward device dates cannot silently add days", () => {
  assert.equal(
    challengeStatus(challenge(["2026-11-05"]), "2026-11-04").broken,
    true,
  );
  assert.throws(
    () => checkIn(challenge(["2026-11-05"]), "2026-11-04"),
    /date changed/,
  );
  assert.throws(
    () => checkIn(challenge([], { createdDate: "2026-11-06" }), "2026-11-05"),
    /start date/,
  );
});

test("next prayer skips sunrise and uses confirmed next-day data after midnight rollover", () => {
  const days = [
    {
      date: "2026-11-05",
      entries: [
        entry("الفجر", "04:56"),
        entry("الشروق", "06:00", "sunrise"),
        entry("الظهر", "11:49"),
        entry("المغرب", "17:39"),
      ],
    },
    { date: "2026-11-06", entries: [entry("الفجر", "04:57")] },
  ];
  assert.deepEqual(nextPrayer(days, new Date("2026-11-05T01:30:00Z")), {
    name: "الظهر",
    time: "11:49",
    date: "2026-11-05",
    remainingSeconds: 22740,
  });
  assert.deepEqual(nextPrayer(days, new Date("2026-11-05T19:59:00Z")), {
    name: "الفجر",
    time: "04:57",
    date: "2026-11-06",
    remainingSeconds: 17880,
  });
  assert.equal(nextPrayer([days[0]], new Date("2026-11-05T20:00:00Z")), null);
  assert.equal(
    nextPrayer(
      [{ date: "2026-11-08", entries: [entry("الفجر", "04:57")] }],
      new Date("2026-11-05T13:00:00Z"),
    ),
    null,
  );
});

test("prayer countdown can reach zero at the exact confirmed instant", () => {
  assert.equal(
    nextPrayer(
      [{ date: "2026-11-05", entries: [entry("الفجر", "04:56")] }],
      new Date("2026-11-05T00:56:00Z"),
    ).remainingSeconds,
    0,
  );
});

test("import normalizes and sorts verified values without filling missing times", () => {
  const raw = {
    days: [
      {
        date: "2026-11-05",
        hijriLabel: "٢٥ جمادى الأولى",
        entries: [entry("المغرب", "17:39"), entry("الفجر", "04:56")],
      },
    ],
    events: [{ title: "مناسبة", date: "2026-11-06" }],
  };
  const normalized = validateImport(raw);
  assert.equal(normalized.days[0].entries[0].name, "الفجر");
  assert.equal(raw.days[0].entries[0].name, "المغرب");
  assert.equal(normalized.events[0].allDay, true);
  assert.equal(normalized.events[0].category, "Islamic");
  assert.equal(normalized.events[0].start, "");
  assert.equal(validateImport(raw).events[0].id, normalized.events[0].id);
});

test("import rejects impossible dates, times, duplicates, and incomplete timed events", () => {
  assert.throws(
    () =>
      validateImport({
        days: [{ date: "2026-02-30", entries: [entry("الفجر", "04:56")] }],
        events: [],
      }),
    /valid Gregorian/,
  );
  assert.throws(
    () =>
      validateImport({
        days: [{ date: "2026-11-05", entries: [entry("الفجر", "4:56")] }],
        events: [],
      }),
    /24-hour/,
  );
  assert.throws(
    () =>
      validateImport({
        days: [
          {
            date: "2026-11-05",
            entries: [entry("الفجر", "04:56"), entry("الفجر", "04:57")],
          },
        ],
        events: [],
      }),
    /more than once/,
  );
  assert.throws(
    () =>
      validateImport({
        days: [
          { date: "2026-11-05", entries: [entry("الفجر", "04:56")] },
          { date: "2026-11-05", entries: [entry("الظهر", "11:49")] },
        ],
        events: [],
      }),
    /more than once/,
  );
  assert.throws(
    () =>
      validateImport({
        days: [],
        events: [{ title: "Event", date: "2026-11-05", start: "09:00" }],
      }),
    /end time/,
  );
  assert.throws(
    () => validateImport({ days: [], events: [event(), event()] }),
    /Duplicate event/,
  );
  assert.throws(
    () => validateImport({ days: [], events: [event({ end: "08:00" })] }),
    /end after/,
  );
  assert.throws(
    () => validateImport({ days: [], events: [event({ allDay: "false" })] }),
    /true or false/,
  );
});

test("calendar snapshot exports UTC times, exclusive all-day end dates, and alarm lead times", () => {
  const ics = makeCalendarFile([
    event({ reminderMinutes: 15 }),
    event({ id: "all-day", title: "مناسبة", allDay: true }),
  ]);
  assert.match(ics, /DTSTART:20261105T050000Z\r\nDTEND:20261105T060000Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261106/);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.match(ics, /UID:event-1@hyte.local/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.replaceAll("\r\n", "").includes("\n"), false);
});

test("calendar text is escaped and Arabic lines fold at UTF-8 byte boundaries", () => {
  const title = "مناسبة عربية ".repeat(18) + ", semicolon; \\ path\nEND:VEVENT";
  const ics = makeCalendarFile([
    event({ title, notes: "First\r\nSecond", location: "A,B;C" }),
  ]);
  const lines = ics.split("\r\n");
  for (const line of lines)
    assert.ok(
      Buffer.byteLength(line, "utf8") <= 75,
      `line exceeds 75 octets: ${line}`,
    );
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("\\, semicolon\\; \\\\ path\\nEND:VEVENT"));
  assert.match(unfolded, /DESCRIPTION:First\\nSecond/);
  assert.equal(lines.filter((line) => line === "END:VEVENT").length, 1);
  assert.ok(!unfolded.includes("\ufffd"));
});

test("calendar accepts explicit overnight end dates and rejects invalid exports", () => {
  const ics = makeCalendarFile([
    event({ start: "23:00", end: "01:00", endDate: "2026-11-06" }),
  ]);
  assert.match(ics, /DTEND:20261105T210000Z/);
  assert.throws(
    () => makeCalendarFile([event({ date: "2026-02-30" })]),
    /valid Gregorian/,
  );
  assert.throws(
    () => makeCalendarFile([event({ reminderMinutes: -1 })]),
    /Reminder/,
  );
});

test("a complete default backup round-trips without invented data", () => {
  const source = createDefaultState();
  assert.deepEqual(validateBackup(source), source);
  assert.notEqual(validateBackup(source), source);
});

function completeBackup() {
  const state = createDefaultState();
  state.events = [event({ importId: "import-a" })];
  state.tasks = [
    {
      id: "task-1",
      title: "Read",
      category: "Personal",
      priority: "High",
      date: "2026-11-05",
      time: "09:00",
      reminderMinutes: 5,
      done: false,
    },
  ];
  state.goals = [
    {
      id: "goal-1",
      title: "Learn",
      milestones: [{ id: "milestone-1", title: "Read chapter", done: true }],
    },
  ];
  state.notes = [
    {
      id: "note-1",
      title: "Thought",
      body: "An Arabic note: فكرة",
      pinned: false,
      updatedAt: "2026-11-05T05:00:00Z",
    },
  ];
  state.challenges = [challenge(["2026-11-01", "2026-11-02"])];
  state.prayerDays = [
    {
      id: "day-1",
      date: "2026-11-05",
      importId: "import-a",
      hijriLabel: "٢٥ جمادى الأولى",
      entries: [entry("الفجر", "04:56")],
    },
  ];
  state.imports = [
    {
      id: "import-a",
      name: "Community timetable",
      month: "جمادى الأولى",
      city: "Muscat",
      createdAt: "2026-11-01T05:00:00Z",
      imageId: "local:import:a",
      dates: ["2026-11-05"],
      replacedDays: [],
    },
  ];
  return state;
}

test("backup normalization preserves event/prayer source links and nested model values", () => {
  const source = completeBackup();
  const restored = validateBackup(source);
  assert.equal(restored.events[0].id, "event-1");
  assert.equal(restored.events[0].importId, "import-a");
  assert.equal(restored.prayerDays[0].id, "day-1");
  assert.equal(restored.prayerDays[0].importId, "import-a");
  assert.equal(restored.goals[0].milestones[0].done, true);
  assert.equal(restored.notes[0].body, source.notes[0].body);
  assert.equal(restored.imports[0].imageId, "local:import:a");
  assert.deepEqual(source.goals[0].milestones, [
    { id: "milestone-1", title: "Read chapter", done: true },
  ]);
  source.notes[0].body = "  Indented thought\n\n";
  assert.equal(validateBackup(source).notes[0].body, "  Indented thought\n\n");
  source.settings.name = "Ali ";
  source.settings.city = "New ";
  assert.equal(validateBackup(source).settings.name, "Ali ");
  assert.equal(validateBackup(source).settings.city, "New ");
});

test("malformed backup arrays, nested values, dates, duplicate IDs, and booleans are rejected", () => {
  const corruptions = [
    (state) => {
      state.tasks = {};
    },
    (state) => {
      state.settings = [];
    },
    (state) => {
      state.notes[0].body = { html: "<script>" };
    },
    (state) => {
      state.notes[0].body = null;
    },
    (state) => {
      state.notes[0].updatedAt = "not a date";
    },
    (state) => {
      state.tasks[0].done = "false";
    },
    (state) => {
      state.events[0].allDay = null;
    },
    (state) => {
      state.tasks[0].reminderMinutes = "5";
    },
    (state) => {
      state.tasks[0].date = "";
    },
    (state) => {
      state.challenges[0].checkIns = {};
    },
    (state) => {
      state.challenges[0].checkIns = ["2026-11-01", "2026-11-01"];
    },
    (state) => {
      state.challenges[0].timeZone = "Invalid/Zone";
    },
    (state) => {
      state.challenges[0].resets = -1;
    },
    (state) => {
      state.goals[0].milestones = "malformed";
    },
    (state) => {
      state.goals[0].milestones[0].done = 1;
    },
    (state) => {
      state.goals[0].targetDate = "2026-02-30";
    },
    (state) => {
      state.prayerDays[0].entries = null;
    },
    (state) => {
      state.prayerDays[0].entries[0].time = "25:00";
    },
    (state) => {
      state.imports[0].replacedDays = "malformed";
    },
    (state) => {
      state.imports[0].imageId = {};
    },
    (state) => {
      state.tasks.push({ ...state.tasks[0] });
    },
    (state) => {
      state.settings.timeZone = "Invalid/Zone";
    },
    (state) => {
      state.settings.appearance = "neon";
    },
    (state) => {
      state.settings.hijriOffset = 0.5;
    },
    (state) => {
      state.settings.wallpaperDim = Infinity;
    },
    (state) => {
      state.settings.wallpaperPosition = "somewhere";
    },
    (state) => {
      state.settings.name = {};
    },
  ];
  for (const corrupt of corruptions) {
    const source = completeBackup();
    corrupt(source);
    assert.throws(() => validateBackup(source));
  }
});

test("backup source-replacement snapshots are validated and preserved for safe undo", () => {
  const state = completeBackup();
  state.imports[0].replacedDays = [
    {
      id: "prior-day",
      importId: "prior-import",
      date: "2026-11-05",
      entries: [entry("الفجر", "04:55")],
    },
  ];
  const result = validateBackup(state);
  assert.equal(result.imports[0].replacedDays[0].importId, "prior-import");
  state.imports[0].replacedDays[0].entries[0].time = "unknown";
  assert.throws(() => validateBackup(state), /24-hour/);
});

test("undo blocks an older import until its newer overlapping replacement is undone", () => {
  const aDay = {
    id: "a-day",
    date: "2026-11-05",
    importId: "a",
    entries: [entry("الفجر", "04:56")],
  };
  const bDay = {
    id: "b-day",
    date: "2026-11-05",
    importId: "b",
    entries: [entry("الفجر", "04:57")],
  };
  const unrelated = {
    id: "other-day",
    date: "2026-11-06",
    importId: "other",
    entries: [entry("الفجر", "04:58")],
  };
  const state = {
    ...createDefaultState(),
    imports: [
      { id: "a", replacedDays: [] },
      { id: "b", replacedDays: [aDay] },
      { id: "other", replacedDays: [] },
    ],
    prayerDays: [bDay, unrelated],
    events: [
      event({ id: "a-event", importId: "a" }),
      event({ id: "b-event", importId: "b" }),
      event({ id: "manual" }),
    ],
  };
  assert.throws(
    () => undoImportedSchedule(state, "a"),
    /newer overlapping import first/,
  );
  const withoutB = undoImportedSchedule(state, "b");
  assert.deepEqual(withoutB.prayerDays, [unrelated, aDay]);
  assert.deepEqual(
    withoutB.events.map((item) => item.id),
    ["a-event", "manual"],
  );
  assert.equal(state.prayerDays[0].id, "b-day");
  const withoutA = undoImportedSchedule(withoutB, "a");
  assert.deepEqual(withoutA.prayerDays, [unrelated]);
  assert.deepEqual(
    withoutA.events.map((item) => item.id),
    ["manual"],
  );
});

test("undo never overwrites unrelated current days or resurrects a deleted source", () => {
  const state = {
    ...createDefaultState(),
    imports: [
      {
        id: "a",
        replacedDays: [
          { id: "old-1", date: "2026-11-05", importId: "missing" },
          { id: "old-2", date: "2026-11-06" },
        ],
      },
    ],
    prayerDays: [{ id: "manual", date: "2026-11-06" }],
    events: [],
  };
  assert.deepEqual(
    undoImportedSchedule(state, "a").prayerDays,
    state.prayerDays,
  );
  assert.throws(
    () => undoImportedSchedule(state, "unknown"),
    /no longer exists/,
  );
});
