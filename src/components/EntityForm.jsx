import React, { useState } from "react";
import { Plus, Trash2, CalendarPlus, Copy, Check } from "lucide-react";
import { Button, Field, Sheet } from "./ui";
import { dateKey, normalizeEvent, makeCalendarFile } from "../lib/domain";
import { download } from "../lib/storage";

export const uid = () => crypto.randomUUID();
export const categories = ["Personal", "Work", "College", "Islamic"];
export function EntityForm({
  type,
  item,
  today,
  zone,
  onSave,
  onDelete,
  onClose,
  notify,
}) {
  const initial = item || {};
  const editing = Boolean(item?.id);
  const [value, setValue] = useState({
    title: "",
    description: "",
    notes: "",
    body: "",
    category: "Personal",
    date: type === "event" ? today : "",
    start: "09:00",
    end: "10:00",
    time: "",
    allDay: false,
    priority: "Normal",
    reminderMinutes: "",
    location: "",
    targetDate: "",
    milestones: [],
    pinned: false,
    ...initial,
  });
  const [error, setError] = useState("");
  const set = (key, val) => setValue((v) => ({ ...v, [key]: val }));
  const labels = {
    task: "task",
    event: "event",
    goal: "goal",
    note: "note",
    challenge: "40-day challenge",
  };
  function save(e) {
    e.preventDefault();
    setError("");
    try {
      if (!value.title.trim()) throw new Error("Give this a title first.");
      let result = {
        ...value,
        title: value.title.trim(),
        id: item?.id || uid(),
      };
      if (type === "event")
        result = normalizeEvent({
          ...result,
          reminderMinutes:
            value.reminderMinutes == null ||
            value.reminderMinutes === "" ||
            value.allDay
              ? null
              : Number(value.reminderMinutes),
        });
      if (type === "task") {
        if (value.time && !value.date)
          throw new Error("Choose a due date for this time.");
        if (
          value.reminderMinutes != null &&
          value.reminderMinutes !== "" &&
          (!value.date || !value.time)
        )
          throw new Error("A reminder needs both a due date and time.");
        result.done = item?.done || false;
        result.reminderMinutes =
          value.reminderMinutes == null || value.reminderMinutes === ""
            ? null
            : Number(value.reminderMinutes);
      }
      if (type === "challenge" && !editing)
        result = {
          ...result,
          createdDate: today,
          timeZone: zone,
          checkIns: [],
          resets: 0,
        };
      if (type === "note") result.updatedAt = new Date().toISOString();
      onSave(result);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Sheet
      title={`${editing ? "Edit" : "New"} ${labels[type]}`}
      subtitle={
        type === "challenge"
          ? "One small commitment. Forty days in a row."
          : "Make room for what matters."
      }
      onClose={onClose}
    >
      <form onSubmit={save} className="entity-form">
        <Field label="Title">
          <input
            required
            maxLength={180}
            dir="auto"
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={
              type === "challenge"
                ? "e.g. Read for 20 minutes"
                : "What’s on your mind?"
            }
          />
        </Field>
        {(type === "task" || type === "event") && (
          <Field label="Calendar">
            <select
              value={value.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        )}
        {type === "event" && (
          <>
            <Field label="Date">
              <input
                type="date"
                required
                value={value.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <label className="switch-row">
              All-day event
              <input
                type="checkbox"
                role="switch"
                checked={value.allDay}
                onChange={(e) => set("allDay", e.target.checked)}
              />
            </label>
            {!value.allDay && (
              <div className="form-row">
                <Field label="Starts">
                  <input
                    type="time"
                    required
                    value={value.start}
                    onChange={(e) => set("start", e.target.value)}
                  />
                </Field>
                <Field label="Ends">
                  <input
                    type="time"
                    required
                    value={value.end}
                    onChange={(e) => set("end", e.target.value)}
                  />
                </Field>
              </div>
            )}
            <Field label="Location (optional)">
              <input
                value={value.location}
                onChange={(e) => set("location", e.target.value)}
                dir="auto"
              />
            </Field>
          </>
        )}
        {type === "task" && (
          <>
            <div className="form-row">
              <Field label="Due date (optional)">
                <input
                  type="date"
                  value={value.date}
                  onChange={(e) => set("date", e.target.value)}
                />
              </Field>
              <Field label="Due time (optional)">
                <input
                  type="time"
                  value={value.time}
                  onChange={(e) => set("time", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Priority">
              <select
                value={value.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                <option>Normal</option>
                <option>High</option>
                <option>Low</option>
              </select>
            </Field>
          </>
        )}
        {(type === "task" || type === "event") && (
          <>
            {!value.allDay && (
              <Field
                label="Notification"
                hint="Delivery needs connected cloud storage and an enabled notification sender. You can configure these in Settings."
              >
                <select
                  value={value.reminderMinutes ?? ""}
                  onChange={(e) => set("reminderMinutes", e.target.value)}
                >
                  <option value="">No notification</option>
                  <option value="0">At the scheduled time</option>
                  <option value="5">5 minutes before</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </select>
              </Field>
            )}
            <Field label="Notes (optional)">
              <textarea
                rows={3}
                dir="auto"
                value={value.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </>
        )}
        {type === "goal" && (
          <>
            <Field label="Target date (optional)">
              <input
                type="date"
                value={value.targetDate}
                onChange={(e) => set("targetDate", e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                dir="auto"
                value={value.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <div className="field">
              <label>Milestones</label>
              {value.milestones.map((m, index) => (
                <div className="milestone-edit" key={m.id}>
                  <input
                    aria-label={`Milestone ${index + 1}`}
                    dir="auto"
                    value={m.title}
                    onChange={(e) =>
                      set(
                        "milestones",
                        value.milestones.map((x) =>
                          x.id === m.id ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove milestone"
                    onClick={() =>
                      set(
                        "milestones",
                        value.milestones.filter((x) => x.id !== m.id),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
              <Button
                variant="quiet"
                icon={Plus}
                onClick={() =>
                  set("milestones", [
                    ...value.milestones,
                    { id: uid(), title: "", done: false },
                  ])
                }
              >
                Add milestone
              </Button>
            </div>
          </>
        )}
        {type === "note" && (
          <>
            <Field label="Your note">
              <textarea
                rows={11}
                dir="auto"
                value={value.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder="A thought worth keeping…"
              />
            </Field>
            <label className="switch-row">
              Pin this note
              <input
                type="checkbox"
                role="switch"
                checked={value.pinned}
                onChange={(e) => set("pinned", e.target.checked)}
              />
            </label>
            <small className="muted">
              Choose Save to keep your changes. Closing discards unsaved edits.
            </small>
          </>
        )}
        {type === "challenge" && (
          <Field
            label="Your intention (optional)"
            hint="Check in once each day. A missed day breaks the streak and requires a confirmed reset."
          >
            <textarea
              rows={3}
              dir="auto"
              value={value.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Why does this matter to you?"
            />
          </Field>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {editing && (
            <Button
              variant="danger-quiet"
              icon={Trash2}
              onClick={() => onDelete(item)}
            >
              Delete
            </Button>
          )}
          <Button variant="primary" icon={Check} type="submit">
            Save {labels[type]}
          </Button>
        </div>
        {editing && type === "event" && (
          <Button
            variant="secondary"
            icon={CalendarPlus}
            onClick={() => {
              download(
                "hyte-event.ics",
                makeCalendarFile([item], zone),
                "text/calendar;charset=utf-8",
              );
              notify(
                "Calendar file exported. Open it in Apple Calendar to import.",
              );
            }}
          >
            Export to Apple Calendar
          </Button>
        )}
        {editing && type === "task" && (
          <Button
            variant="secondary"
            icon={Copy}
            onClick={async () => {
              try {
                const text = `${item.title}${item.date ? `\nDue: ${item.date} ${item.time || ""}` : ""}${item.notes ? `\n${item.notes}` : ""}`;
                await navigator.clipboard.writeText(text);
                notify(
                  "Copied. Paste into Apple Reminders; no reminder was created automatically.",
                );
              } catch {
                notify(
                  "Copy is unavailable here. Select the task text to copy it manually.",
                );
              }
            }}
          >
            Copy for Apple Reminders
          </Button>
        )}
      </form>
    </Sheet>
  );
}
