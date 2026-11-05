import React, { useRef, useState } from "react";
import {
  Upload,
  Sparkles,
  Check,
  Plus,
  Trash2,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { Button, Field, Sheet } from "./ui";
import { validateImport } from "../lib/domain";
import { api, imageData, media } from "../lib/storage";
import { uid } from "./EntityForm";

export function PrayerImport({ state, ownerKey, onSave, onClose }) {
  const [image, setImage] = useState(""),
    [name, setName] = useState(""),
    [month, setMonth] = useState(""),
    [anchor, setAnchor] = useState("");
  const [step, setStep] = useState("upload"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [warnings, setWarnings] = useState([]);
  const [draft, setDraft] = useState({ days: [], events: [] }),
    [consent, setConsent] = useState(false),
    [resolveConflicts, setResolveConflicts] = useState(false);
  const inFlight = useRef(false);
  const setDay = (index, key, value) =>
    setDraft((d) => ({
      ...d,
      days: d.days.map((day, i) =>
        i === index ? { ...day, [key]: value } : day,
      ),
    }));
  const setEntry = (dayIndex, entryIndex, key, value) =>
    setDraft((d) => ({
      ...d,
      days: d.days.map((day, i) =>
        i === dayIndex
          ? {
              ...day,
              entries: day.entries.map((entry, j) =>
                j === entryIndex ? { ...entry, [key]: value } : entry,
              ),
            }
          : day,
      ),
    }));
  const setEvent = (index, key, value) =>
    setDraft((d) => ({
      ...d,
      events: d.events.map((event, i) =>
        i === index ? { ...event, [key]: value } : event,
      ),
    }));
  const conflicts = draft.days
    .filter((day) =>
      state.prayerDays.some((existing) => existing.date === day.date),
    )
    .map((d) => d.date);
  async function pick(file) {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setError("");
    setBusy(true);
    try {
      setImage(await imageData(file));
      setName(file.name);
      setConsent(false);
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function extract() {
    if (inFlight.current || !image || !consent) return;
    inFlight.current = true;
    setError("");
    setBusy(true);
    try {
      const result = await api("/api/extract", {
        image,
        month,
        anchorDate: anchor,
        city: state.settings.city,
      });
      setDraft({ days: result.days || [], events: result.events || [] });
      setWarnings(result.warnings || []);
      setResolveConflicts(false);
      setStep("review");
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    setBusy(true);
    try {
      const validated = validateImport(draft);
      if (!validated.days.length && !validated.events.length)
        throw new Error("Add at least one prayer day or event.");
      if (conflicts.length && !resolveConflicts)
        throw new Error(
          "Review and confirm replacement of existing prayer dates first.",
        );
      const duplicate = validated.events.find((event) =>
        state.events.some(
          (existing) =>
            existing.date === event.date &&
            existing.title === event.title &&
            existing.start === event.start,
        ),
      );
      if (duplicate)
        throw new Error(
          `“${duplicate.title}” already exists on ${duplicate.date}. Remove the duplicate from this import.`,
        );
      const id = uid();
      let imageId = null;
      if (image) {
        imageId = `${ownerKey}:import:${id}`;
        await media("put", imageId, image);
      }
      const record = {
        id,
        name: name || "Manual timetable",
        month,
        city: state.settings.city,
        createdAt: new Date().toISOString(),
        imageId,
        replacedDays: state.prayerDays.filter((day) =>
          validated.days.some((d) => d.date === day.date),
        ),
        dates: validated.days.map((d) => d.date),
      };
      onSave({
        record,
        days: validated.days.map((day) => ({
          ...day,
          id: uid(),
          importId: id,
        })),
        events: validated.events.map((event) => ({
          ...event,
          id: uid(),
          category: "Islamic",
          importId: id,
        })),
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={
        step === "upload" ? "Your monthly timetable" : "Review every detail"
      }
      subtitle={
        step === "upload"
          ? "From your community, into your day."
          : "Nothing is saved until you confirm."
      }
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
      wide
    >
      {step === "upload" ? (
        <fieldset
          disabled={busy}
          className="entity-form"
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <label className={`upload-zone ${image ? "has-image" : ""}`}>
            {image ? (
              <img src={image} alt="Your timetable, ready to review" />
            ) : (
              <>
                <Upload size={32} strokeWidth={1.4} />
                <strong>Choose your monthly image</strong>
                <span>JPEG, PNG or WebP · up to 20 MB</span>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => pick(e.target.files[0])}
            />
          </label>
          <Field
            label="Hijri month and year"
            hint="Confirm the month shown in the source; unclear dates must be corrected during review."
          >
            <input
              dir="auto"
              placeholder="e.g. جمادى الأولى ١٤٤٨"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
          <Field
            label="Gregorian anchor date"
            hint="Optional. Use a Gregorian date printed in the image, not today's date unless it actually matches. Uncertain mappings need review."
          >
            <input
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
            />
          </Field>
          <div className="notice">
            <Sparkles size={20} />
            <div>
              <strong>Optional image reading</strong>
              <p>
                With cloud extraction configured, this image is sent to the
                configured OpenAI service for analysis. Always review dates and
                times before saving. The original is kept on this device.
              </p>
            </div>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree to send this image for extraction.
          </label>
          <Button
            icon={Sparkles}
            disabled={!image || !consent || busy}
            onClick={extract}
          >
            {busy ? "Reading image…" : "Read timetable"}
          </Button>
          <Button
            variant="secondary"
            icon={FileText}
            disabled={busy}
            onClick={() => setStep("review")}
          >
            Enter dates and times manually
          </Button>
        </fieldset>
      ) : (
        <fieldset
          disabled={busy}
          className="entity-form"
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Button
            variant="quiet"
            icon={ArrowLeft}
            disabled={busy}
            onClick={() => setStep("upload")}
          >
            Back to source
          </Button>
          {image && (
            <details className="source-preview">
              <summary>View original image</summary>
              <img src={image} alt="Original timetable for comparison" />
            </details>
          )}
          {warnings.length > 0 && (
            <div className="notice warning">
              <div>
                <strong>Needs your attention</strong>
                {warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </div>
            </div>
          )}
          <div className="section-heading">
            <h3>Prayer days</h3>
            <Button
              variant="quiet"
              icon={Plus}
              disabled={busy}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  days: [
                    ...d.days,
                    {
                      date: "",
                      hijriLabel: "",
                      entries: [
                        { name: "الفجر", time: "", kind: "prayer" },
                        { name: "الظهر", time: "", kind: "prayer" },
                        { name: "المغرب", time: "", kind: "prayer" },
                      ],
                    },
                  ],
                }))
              }
            >
              Add day
            </Button>
          </div>
          {!draft.days.length && (
            <p className="muted">
              Add the dates and exact times printed in your timetable. Missing
              values will never be filled automatically.
            </p>
          )}
          {draft.days.map((day, i) => (
            <div className="import-day" key={i}>
              <div className="form-row">
                <Field label="Gregorian date">
                  <input
                    type="date"
                    value={day.date}
                    onChange={(e) => setDay(i, "date", e.target.value)}
                  />
                </Field>
                <Field label="Hijri date label">
                  <input
                    lang="ar"
                    dir="rtl"
                    placeholder="Optional"
                    value={day.hijriLabel || ""}
                    onChange={(e) => setDay(i, "hijriLabel", e.target.value)}
                  />
                </Field>
              </div>
              {day.entries.map((entry, j) => (
                <div className="prayer-entry-edit" key={j}>
                  <input
                    aria-label="Prayer name"
                    lang="ar"
                    dir="rtl"
                    placeholder="اسم الصلاة"
                    value={entry.name}
                    onChange={(e) => setEntry(i, j, "name", e.target.value)}
                  />
                  <input
                    aria-label="Prayer time"
                    type="time"
                    value={entry.time}
                    onInput={(e) => setEntry(i, j, "time", e.target.value)}
                    onChange={(e) => setEntry(i, j, "time", e.target.value)}
                  />
                  <select
                    aria-label="Entry type"
                    value={entry.kind || "prayer"}
                    onChange={(e) => setEntry(i, j, "kind", e.target.value)}
                  >
                    <option value="prayer">Prayer</option>
                    <option value="sunrise">Sunrise</option>
                  </select>
                  <button
                    className="icon-button"
                    aria-label="Remove prayer"
                    onClick={() =>
                      setDay(
                        i,
                        "entries",
                        day.entries.filter((_, index) => index !== j),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div className="import-actions">
                <Button
                  variant="quiet"
                  icon={Plus}
                  onClick={() =>
                    setDay(i, "entries", [
                      ...day.entries,
                      { name: "", time: "", kind: "prayer" },
                    ])
                  }
                >
                  Add entry
                </Button>
                <Button
                  variant="danger-quiet"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      days: d.days.filter((_, index) => index !== i),
                    }))
                  }
                >
                  Exclude day
                </Button>
              </div>
            </div>
          ))}
          <div className="section-heading">
            <h3>Islamic events</h3>
            <Button
              variant="quiet"
              icon={Plus}
              disabled={busy}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  events: [
                    ...d.events,
                    {
                      title: "",
                      date: "",
                      allDay: true,
                      start: "",
                      end: "",
                      notes: "",
                    },
                  ],
                }))
              }
            >
              Add event
            </Button>
          </div>
          {draft.events.map((event, i) => (
            <div className="import-day" key={i}>
              <Field label="Event title">
                <input
                  dir="auto"
                  value={event.title}
                  onChange={(e) => setEvent(i, "title", e.target.value)}
                />
              </Field>
              <Field label="Date">
                <input
                  type="date"
                  value={event.date}
                  onChange={(e) => setEvent(i, "date", e.target.value)}
                />
              </Field>
              <label className="switch-row">
                All day
                <input
                  type="checkbox"
                  role="switch"
                  checked={event.allDay}
                  onChange={(e) => setEvent(i, "allDay", e.target.checked)}
                />
              </label>
              {!event.allDay && (
                <div className="form-row">
                  <Field label="Starts">
                    <input
                      type="time"
                      value={event.start}
                      onChange={(e) => setEvent(i, "start", e.target.value)}
                    />
                  </Field>
                  <Field label="Ends">
                    <input
                      type="time"
                      value={event.end}
                      onChange={(e) => setEvent(i, "end", e.target.value)}
                    />
                  </Field>
                </div>
              )}
              <Field
                label="Event notes"
                hint="Review any printed time or source note preserved here before saving."
              >
                <textarea
                  dir="auto"
                  rows={3}
                  value={event.notes || ""}
                  onChange={(e) => setEvent(i, "notes", e.target.value)}
                />
              </Field>
              <Button
                variant="danger-quiet"
                disabled={busy}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    events: d.events.filter((_, index) => index !== i),
                  }))
                }
              >
                Exclude event
              </Button>
            </div>
          ))}
          {conflicts.length > 0 && (
            <label className="checkbox-label notice warning">
              <input
                type="checkbox"
                checked={resolveConflicts}
                onChange={(e) => setResolveConflicts(e.target.checked)}
              />
              Replace existing prayer times on {conflicts.length} overlapping
              date(s): {conflicts.join(", ")}. Previous rows are retained for
              undo.
            </label>
          )}
          <p className="muted small">
            Confirmed imported dates take priority. Arabic event titles are
            preserved. Review each time in 24-hour format.
          </p>
          <Button
            icon={Check}
            disabled={busy || (!draft.days.length && !draft.events.length)}
            onClick={confirm}
          >
            {busy ? "Saving…" : "Confirm and save import"}
          </Button>
        </fieldset>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
