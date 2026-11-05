/** Pure domain rules. Local date keys are Gregorian dates, never UTC timestamps. */
export const DEFAULT_TIME_ZONE = "Asia/Muscat";
export const CATEGORIES = ["Personal", "Work", "College", "Islamic"];

export const defaultState = {
  version: 1,
  events: [],
  tasks: [],
  goals: [],
  notes: [],
  challenges: [],
  prayerDays: [],
  imports: [],
  settings: {
    name: "Ali",
    city: "Muscat",
    timeZone: DEFAULT_TIME_ZONE,
    appearance: "system",
    hijriOffset: 0,
    wallpaperDim: 35,
    wallpaperPosition: "center",
  },
};

export function createDefaultState() {
  return structuredClone(defaultState);
}

const formatterCache = new Map();
function formatter(zone) {
  if (!formatterCache.has(zone)) {
    formatterCache.set(
      zone,
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        calendar: "gregory",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return formatterCache.get(zone);
}

function partsInZone(value, zone) {
  const parts = Object.fromEntries(
    formatter(zone)
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map(({ type, value: text }) => [type, text]),
  );
  return {
    date: `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    seconds: parts.second,
  };
}

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(instant.getTime()) &&
    instant.toISOString().slice(0, 10) === value
  );
}

export function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function requireDate(value, label = "Date") {
  if (!isDateKey(value))
    throw new Error(`${label} must be a valid Gregorian date (YYYY-MM-DD).`);
  return value;
}

function requireTime(value, label = "Time") {
  if (!isTime(value))
    throw new Error(`${label} must be a valid 24-hour time (HH:mm).`);
  return value;
}

export function dateKey(value = new Date(), zone = DEFAULT_TIME_ZONE) {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime()))
    throw new Error("Cannot format an invalid date.");
  return partsInZone(instant, zone).date;
}

export function addDays(key, amount) {
  requireDate(key);
  if (!Number.isSafeInteger(amount))
    throw new Error("Day adjustment must be a whole number.");
  const instant = new Date(`${key}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + amount);
  const result = instant.toISOString().slice(0, 10);
  requireDate(result);
  return result;
}

/** Positive if `to` follows `from`; unaffected by daylight-saving transitions. */
export function dayDiff(from, to) {
  requireDate(from);
  requireDate(to);
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  );
}

/** Converts a wall time in an IANA zone to UTC. Earliest occurrence wins at a DST overlap. */
export function dateTimeISO(key, time, zone = DEFAULT_TIME_ZONE) {
  requireDate(key);
  requireTime(time);
  const nominal = Date.parse(`${key}T${time}:00.000Z`);
  const offsets = new Set();
  for (const hours of [-36, 0, 36]) {
    const sample = nominal + hours * 3600000;
    const local = partsInZone(new Date(sample), zone);
    offsets.add(
      Date.parse(`${local.date}T${local.time}:${local.seconds}Z`) - sample,
    );
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((candidate) => {
      const local = partsInZone(new Date(candidate), zone);
      return (
        local.date === key && local.time === time && local.seconds === "00"
      );
    })
    .sort((a, b) => a - b);
  if (!candidates.length)
    throw new Error(
      `The selected time does not exist in ${zone} on this date. Choose another time.`,
    );
  return new Date(candidates[0]).toISOString();
}

export function hijriDate(key, offset = 0, locale = "ar") {
  const adjusted = addDays(key, offset);
  return new Intl.DateTimeFormat(locale, {
    calendar: "islamic-umalqura",
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${adjusted}T12:00:00Z`));
}

function checkInDates(challenge) {
  if (!Array.isArray(challenge.checkIns))
    throw new Error("Challenge check-ins must be a list of dates.");
  challenge.checkIns.forEach((day) => requireDate(day, "Check-in date"));
  return [...new Set(challenge.checkIns)].sort();
}

/** A challenge starts on its first check-in. A missed day requires an explicit reset. */
export function challengeStatus(challenge, today) {
  requireDate(today, "Today");
  const allDays = checkInDates(challenge);
  const days = allDays.filter((day) => day <= today);
  const checkedToday = days.includes(today);
  const base = { count: 0, checkedToday, broken: false, complete: false };
  if (allDays.some((day) => day > today)) return { ...base, broken: true };
  if (!days.length) return base;
  const hasGap = days.some(
    (day, index) => index > 0 && dayDiff(days[index - 1], day) !== 1,
  );
  if (hasGap) return { ...base, broken: true };
  if (days.length >= 40)
    return { count: 40, checkedToday, broken: false, complete: true };
  if (days.at(-1) < addDays(today, -1)) return { ...base, broken: true };
  return { count: days.length, checkedToday, broken: false, complete: false };
}

export function checkIn(challenge, today) {
  const status = challengeStatus(challenge, today);
  if (status.complete)
    throw new Error(
      "This challenge is complete. Reset it to start another 40 days.",
    );
  if (status.checkedToday)
    throw new Error("You have already checked in today.");
  if (status.broken)
    throw new Error(
      "A day was missed or the device date changed. Reset this challenge to begin again.",
    );
  if (challenge.createdDate && requireDate(challenge.createdDate) > today) {
    throw new Error(
      "This challenge cannot be checked in before its start date.",
    );
  }
  return { ...challenge, checkIns: [...checkInDates(challenge), today] };
}

export function resetChallenge(challenge, today) {
  requireDate(today, "Reset date");
  return {
    ...challenge,
    createdDate: today,
    checkIns: [],
    resets: (Number(challenge.resets) || 0) + 1,
  };
}

/** Looks only at the current and next local day, never inventing an unprovided timetable. */
export function nextPrayer(
  prayerDays,
  now = new Date(),
  zone = DEFAULT_TIME_ZONE,
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("Cannot find a prayer for an invalid date.");
  const today = dateKey(now, zone);
  const tomorrow = addDays(today, 1);
  const upcoming = [];
  for (const day of prayerDays || []) {
    if (day.date !== today && day.date !== tomorrow) continue;
    for (const entry of day.entries || []) {
      if (
        entry.kind === "sunrise" ||
        /^(الشروق|شروق|sunrise)$/i.test(String(entry.name || "").trim())
      )
        continue;
      if (!isTime(entry.time)) continue;
      const timestamp = Date.parse(dateTimeISO(day.date, entry.time, zone));
      if (timestamp < now.getTime()) continue;
      upcoming.push({
        name: entry.name,
        time: entry.time,
        date: day.date,
        timestamp,
      });
    }
  }
  upcoming.sort((a, b) => a.timestamp - b.timestamp);
  if (!upcoming.length) return null;
  const { timestamp, ...result } = upcoming[0];
  return {
    ...result,
    remainingSeconds: Math.ceil((timestamp - now.getTime()) / 1000),
  };
}

function text(value, label, required = false, max = 5000) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} is too long.`);
  return clean;
}

function stableId(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function normalizeEvent(raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`Event ${index + 1} is invalid.`);
  const title = text(raw.title, `Event ${index + 1} title`, true, 500);
  const date = requireDate(raw.date, `Event ${index + 1} date`);
  if (raw.allDay != null && typeof raw.allDay !== "boolean")
    throw new Error("All-day must be true or false.");
  const allDay = raw.allDay ?? (!raw.start && !raw.end);
  let start = "",
    end = "";
  if (!allDay) {
    start = requireTime(raw.start, `Event ${index + 1} start time`);
    end = requireTime(raw.end, `Event ${index + 1} end time`);
    const endDate = raw.endDate
      ? requireDate(raw.endDate, "Event end date")
      : date;
    if (endDate < date || (endDate === date && end <= start))
      throw new Error("An event must end after it starts.");
  }
  const category = raw.category || "Islamic";
  if (!CATEGORIES.includes(category))
    throw new Error("Choose a valid calendar category.");
  const reminderMinutes = raw.reminderMinutes ?? null;
  if (
    reminderMinutes !== null &&
    (!Number.isSafeInteger(reminderMinutes) ||
      reminderMinutes < 0 ||
      reminderMinutes > 40320)
  ) {
    throw new Error("Reminder lead time must be between 0 and 40320 minutes.");
  }
  const result = {
    id: raw.id
      ? text(raw.id, "Event ID", true, 200)
      : `import-${stableId(`${date}|${start}|${title}`)}`,
    title,
    date,
    start,
    end,
    allDay,
    category,
    notes: text(raw.notes, "Event notes"),
    location: text(raw.location, "Event location", false, 500),
    reminderMinutes,
  };
  if (raw.endDate) {
    result.endDate = requireDate(raw.endDate, "Event end date");
    if (result.endDate < date || (allDay && result.endDate === date)) {
      throw new Error(
        "The explicit end date must follow the event start (exclusive for all-day events).",
      );
    }
  }
  if (raw.timeZone) {
    formatter(raw.timeZone);
    result.timeZone = raw.timeZone;
  }
  if (raw.importId)
    result.importId = text(raw.importId, "Import ID", true, 200);
  return result;
}

/** Validates an extraction without interpreting dates, completing missing times, or saving data. */
export function validateImport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Import must contain prayer days and events.");
  if (!Array.isArray(data.days) || !Array.isArray(data.events))
    throw new Error("Import must contain days and events lists.");
  if (data.days.length > 62 || data.events.length > 500)
    throw new Error(
      "Import is too large. Upload one monthly timetable at a time.",
    );
  const seenDates = new Set();
  const days = data.days
    .map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`Prayer day ${index + 1} is invalid.`);
      const date = requireDate(raw.date, `Prayer day ${index + 1}`);
      if (seenDates.has(date))
        throw new Error(
          `Prayer date ${date} appears more than once. Resolve it before importing.`,
        );
      seenDates.add(date);
      if (
        !Array.isArray(raw.entries) ||
        !raw.entries.length ||
        raw.entries.length > 20
      )
        throw new Error(`Add the verified prayer entries for ${date}.`);
      const seenNames = new Set();
      const entries = raw.entries
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry))
            throw new Error(`An entry on ${date} is invalid.`);
          const name = text(entry.name, "Prayer name", true, 100);
          const normalizedName = name
            .normalize("NFKC")
            .replace(/\s+/g, " ")
            .toLocaleLowerCase();
          if (seenNames.has(normalizedName))
            throw new Error(`${name} appears more than once on ${date}.`);
          seenNames.add(normalizedName);
          const time = requireTime(entry.time, `${name} on ${date}`);
          const kind =
            entry.kind ||
            (/^(الشروق|شروق|sunrise)$/i.test(name) ? "sunrise" : "prayer");
          if (kind !== "prayer" && kind !== "sunrise")
            throw new Error("Entry kind must be prayer or sunrise.");
          return { name, time, kind };
        })
        .sort((a, b) => a.time.localeCompare(b.time));
      return {
        date,
        hijriLabel: text(raw.hijriLabel, "Hijri date", false, 200),
        entries,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const eventKeys = new Set();
  const eventIds = new Set();
  const events = data.events.map((raw, index) => {
    const event = normalizeEvent(raw, index);
    const key = `${event.date}|${event.start}|${event.title.normalize("NFKC").toLocaleLowerCase()}`;
    if (eventKeys.has(key) || eventIds.has(event.id))
      throw new Error(
        `Duplicate event: ${event.title}. Resolve it before importing.`,
      );
    eventKeys.add(key);
    eventIds.add(event.id);
    return event;
  });
  return { days, events };
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value;
}

function identifier(value, label = "ID") {
  const id = text(value, label, true, 200);
  if (/[\u0000-\u001f\u007f]/.test(id))
    throw new Error(`${label} contains invalid characters.`);
  return id;
}

function boolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`${label} must be true or false.`);
  return value;
}

function optionalDate(value, label) {
  return value == null || value === "" ? "" : requireDate(value, label);
}

function verbatimText(value, label, max) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  if (value.length > max) throw new Error(`${label} is too long.`);
  return value;
}

function timestamp(value, label, optional = false) {
  if (optional && (value == null || value === "")) return "";
  const result = text(value, label, true, 100);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`${label} is invalid.`);
  return result;
}

function zone(value, label) {
  const result = text(value, label, true, 100);
  try {
    formatter(result);
  } catch {
    throw new Error(`${label} must be a valid IANA time zone.`);
  }
  return result;
}

function list(value, label, normalize, max = 10000) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(
      `${label} must be a valid list with at most ${max} entries.`,
    );
  const seen = new Set();
  return value.map((raw, index) => {
    object(raw, `${label} entry ${index + 1}`);
    const id = identifier(raw.id, `${label} ID`);
    if (seen.has(id)) throw new Error(`${label} contains duplicate IDs.`);
    seen.add(id);
    return normalize(raw, id, index);
  });
}

function prayerBackupDay(raw, id) {
  const day = validateImport({ days: [raw], events: [] }).days[0];
  return {
    ...day,
    id,
    ...(raw.importId != null
      ? { importId: identifier(raw.importId, "Prayer import ID") }
      : {}),
  };
}

/** Validates a JSON backup before it can replace any saved workspace data. */
export function validateBackup(data) {
  object(data, "Backup");
  if (data.version !== 1)
    throw new Error("This is not a supported Hyte backup.");
  const settings = object(data.settings, "Settings");
  const defaults = createDefaultState().settings;
  const appearance = settings.appearance ?? defaults.appearance;
  if (!["system", "light", "dark"].includes(appearance))
    throw new Error("Choose a valid theme setting.");
  const hijriOffset = settings.hijriOffset ?? 0;
  if (!Number.isInteger(hijriOffset) || hijriOffset < -2 || hijriOffset > 2)
    throw new Error("Hijri adjustment must be between -2 and +2 days.");
  const wallpaperDim = settings.wallpaperDim ?? defaults.wallpaperDim;
  if (
    typeof wallpaperDim !== "number" ||
    !Number.isFinite(wallpaperDim) ||
    wallpaperDim < 0 ||
    wallpaperDim > 80
  )
    throw new Error("Wallpaper dimming must be between 0 and 80.");
  const wallpaperPosition = settings.wallpaperPosition ?? "center";
  if (!["top", "center", "bottom"].includes(wallpaperPosition))
    throw new Error("Choose a valid wallpaper position.");

  const events = list(data.events, "Events", (raw, id, index) => {
    if (raw.allDay !== undefined) boolean(raw.allDay, "All-day event state");
    return normalizeEvent({ ...raw, id }, index);
  });
  const tasks = list(data.tasks, "Tasks", (raw, id) => {
    const date = optionalDate(raw.date, "Task due date");
    const time =
      raw.time == null || raw.time === ""
        ? ""
        : requireTime(raw.time, "Task due time");
    if (time && !date) throw new Error("A task time needs a due date.");
    const reminderMinutes = raw.reminderMinutes ?? null;
    if (
      reminderMinutes !== null &&
      (!Number.isSafeInteger(reminderMinutes) ||
        reminderMinutes < 0 ||
        reminderMinutes > 40320)
    ) {
      throw new Error(
        "Task reminder lead time must be between 0 and 40320 minutes.",
      );
    }
    if (reminderMinutes !== null && (!date || !time))
      throw new Error("A task reminder needs both a date and time.");
    const category = raw.category ?? "Personal";
    if (!CATEGORIES.includes(category))
      throw new Error("Choose a valid task category.");
    const priority = raw.priority ?? "Normal";
    if (!["Normal", "High", "Low"].includes(priority))
      throw new Error("Choose a valid task priority.");
    return {
      id,
      title: text(raw.title, "Task title", true, 500),
      date,
      time,
      reminderMinutes,
      category,
      priority,
      notes: text(raw.notes, "Task notes"),
      done: boolean(raw.done, "Task completion"),
    };
  });
  const goals = list(data.goals, "Goals", (raw, id) => ({
    id,
    title: text(raw.title, "Goal title", true, 500),
    description: text(raw.description, "Goal description"),
    targetDate: optionalDate(raw.targetDate, "Goal target date"),
    done: boolean(raw.done, "Goal completion"),
    archived: boolean(raw.archived, "Goal archive state"),
    milestones: list(
      raw.milestones ?? [],
      "Milestones",
      (milestone, milestoneId) => ({
        id: milestoneId,
        title: text(milestone.title, "Milestone title", false, 500),
        done: boolean(milestone.done, "Milestone completion"),
      }),
      1000,
    ),
  }));
  const notes = list(data.notes, "Notes", (raw, id) => {
    if (raw.body !== undefined && typeof raw.body !== "string")
      throw new Error("Note body must be text.");
    if ((raw.body || "").length > 100000)
      throw new Error("Note body is too long.");
    return {
      id,
      title: text(raw.title, "Note title", true, 500),
      body: raw.body || "",
      pinned: boolean(raw.pinned, "Note pin state"),
      updatedAt: timestamp(raw.updatedAt, "Note update date", true),
    };
  });
  const challenges = list(data.challenges, "Challenges", (raw, id) => {
    const createdDate = requireDate(raw.createdDate, "Challenge start date");
    if (!Array.isArray(raw.checkIns) || raw.checkIns.length > 40)
      throw new Error(
        "Challenge check-ins must be a list of at most 40 dates.",
      );
    const checkIns = raw.checkIns.map((day) =>
      requireDate(day, "Check-in date"),
    );
    if (new Set(checkIns).size !== checkIns.length)
      throw new Error("A challenge contains duplicate daily check-ins.");
    if (checkIns.some((day) => day < createdDate))
      throw new Error("Challenge check-ins cannot precede the start date.");
    const resets = raw.resets ?? 0;
    if (!Number.isSafeInteger(resets) || resets < 0)
      throw new Error(
        "Challenge reset count must be a nonnegative whole number.",
      );
    return {
      id,
      title: text(raw.title, "Challenge title", true, 500),
      description: text(raw.description, "Challenge description"),
      createdDate,
      timeZone: zone(raw.timeZone, "Challenge time zone"),
      checkIns: [...checkIns].sort(),
      resets,
    };
  });
  const prayerDays = list(data.prayerDays, "Prayer days", prayerBackupDay);
  if (new Set(prayerDays.map((day) => day.date)).size !== prayerDays.length)
    throw new Error("Prayer days contain overlapping dates.");
  const imports = list(data.imports, "Imports", (raw, id) => {
    const dates = raw.dates ?? [];
    if (
      !Array.isArray(dates) ||
      dates.some((day) => !isDateKey(day)) ||
      new Set(dates).size !== dates.length
    )
      throw new Error("Import coverage contains invalid or duplicate dates.");
    const replacedDays = list(
      raw.replacedDays ?? [],
      "Previous prayer days",
      prayerBackupDay,
      62,
    );
    if (
      new Set(replacedDays.map((day) => day.date)).size !== replacedDays.length
    )
      throw new Error("Previous prayer days contain overlapping dates.");
    return {
      id,
      name: text(raw.name, "Import name", true, 500),
      month: text(raw.month, "Import month", false, 200),
      city: text(raw.city, "Import city", false, 200),
      createdAt: timestamp(raw.createdAt, "Import date"),
      imageId:
        raw.imageId == null
          ? null
          : text(raw.imageId, "Source image ID", true, 500),
      dates: [...dates],
      replacedDays,
    };
  });
  return {
    version: 1,
    events,
    tasks,
    goals,
    notes,
    challenges,
    prayerDays,
    imports,
    settings: {
      name:
        settings.name === undefined
          ? defaults.name
          : verbatimText(settings.name, "Name", 200),
      city:
        settings.city === undefined
          ? defaults.city
          : verbatimText(settings.city, "City", 200),
      timeZone: zone(
        settings.timeZone ?? defaults.timeZone,
        "Planning time zone",
      ),
      appearance,
      hijriOffset,
      wallpaperDim,
      wallpaperPosition,
      ...(settings.hasWallpaper !== undefined
        ? { hasWallpaper: boolean(settings.hasWallpaper, "Wallpaper state") }
        : {}),
    },
  };
}

/** Undo is deliberately blocked while a newer import depends on its previous rows. */
export function undoImportedSchedule(state, recordId) {
  const record = state.imports.find((item) => item.id === recordId);
  if (!record) throw new Error("This timetable import no longer exists.");
  if (
    state.imports.some(
      (item) =>
        item.id !== recordId &&
        (item.replacedDays || []).some((day) => day.importId === recordId),
    )
  ) {
    throw new Error("Undo the newer overlapping import first.");
  }
  const imports = state.imports.filter((item) => item.id !== recordId);
  const remaining = state.prayerDays.filter((day) => day.importId !== recordId);
  const previous = (record.replacedDays || []).filter(
    (day) =>
      (!day.importId || imports.some((item) => item.id === day.importId)) &&
      !remaining.some((current) => current.date === day.date),
  );
  return {
    ...state,
    imports,
    prayerDays: [...remaining, ...previous],
    events: state.events.filter((item) => item.importId !== recordId),
  };
}

function escapeCalendarText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** RFC 5545 content-line folds are at 75 UTF-8 octets, not 75 JS characters. */
function foldCalendarLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = "",
    bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}

function calendarTimestamp(iso) {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Exports a snapshot. It is not a subscription and cannot synchronize Apple Calendar. */
export function makeCalendarFile(events, zone = DEFAULT_TIME_ZONE) {
  if (!Array.isArray(events)) throw new Error("Select events to export.");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hyte//Personal Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Hyte",
  ];
  const timestamp = calendarTimestamp(new Date().toISOString());
  for (const [index, raw] of events.entries()) {
    const event = normalizeEvent(raw, index);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeCalendarText(event.id)}@hyte.local`,
      `DTSTAMP:${timestamp}`,
      `SUMMARY:${escapeCalendarText(event.title)}`,
    );
    if (event.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${event.date.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${(event.endDate || addDays(event.date, 1)).replaceAll("-", "")}`,
      );
    } else {
      const eventZone = event.timeZone || zone;
      lines.push(
        `DTSTART:${calendarTimestamp(dateTimeISO(event.date, event.start, eventZone))}`,
        `DTEND:${calendarTimestamp(dateTimeISO(event.endDate || event.date, event.end, eventZone))}`,
      );
    }
    if (event.notes)
      lines.push(`DESCRIPTION:${escapeCalendarText(event.notes)}`);
    if (event.location)
      lines.push(`LOCATION:${escapeCalendarText(event.location)}`);
    lines.push(`CATEGORIES:${escapeCalendarText(event.category)}`);
    if (event.reminderMinutes !== null) {
      lines.push(
        "BEGIN:VALARM",
        `TRIGGER:-PT${event.reminderMinutes}M`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeCalendarText(event.title)}`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}
