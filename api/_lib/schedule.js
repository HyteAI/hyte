import { createHash } from "node:crypto";
import { dateTimeISO, isDateKey, isTime } from "../../src/lib/domain.js";

export function localDateTime(date, time, timeZone) {
  if (!isDateKey(date) || !isTime(time)) return null;
  try {
    return dateTimeISO(date, time, timeZone);
  } catch (error) {
    if (error instanceof RangeError) throw error; // Invalid IANA zone is a setup error.
    return null; // Nonexistent wall time in a daylight-saving gap: never guess.
  }
}

export function jobsFromState(state, userId, revision, now = Date.now()) {
  const jobs = [];
  const timeZone = state.settings?.timeZone || "Asia/Muscat";
  // Validate the zone once; an invalid zone must not silently move reminders.
  new Intl.DateTimeFormat("en", { timeZone }).format();
  const rows = [
    ...(state.events || []).map((item) => ({ ...item, type: "event" })),
    ...(state.tasks || [])
      .filter((item) => !item.done)
      .map((item) => ({ ...item, type: "task" })),
  ];
  for (const item of rows.slice(0, 2500)) {
    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      !item.id ||
      !item.title ||
      item.allDay
    )
      continue;
    const lead = item.reminderMinutes;
    if (!Number.isInteger(lead) || lead < 0 || lead > 43200) continue;
    const start = localDateTime(
      item.date,
      item.type === "event" ? item.start : item.time,
      timeZone,
    );
    if (!start) continue;
    const dueMs = Date.parse(start) - lead * 60_000;
    if (dueMs <= now) continue;
    const payload = {
      title: "Hyte reminder",
      body: String(item.title).slice(0, 180),
      url: item.type === "event" ? "/?tab=calendar" : "/?tab=space",
    };
    const itemKey = `${item.type}:${item.id}`;
    const id = createHash("sha256")
      .update(JSON.stringify([userId, itemKey, dueMs, payload]))
      .digest("hex");
    jobs.push({
      id,
      item_key: itemKey,
      due_at: new Date(dueMs).toISOString(),
      payload,
      source_revision: revision,
    });
  }
  return jobs;
}
