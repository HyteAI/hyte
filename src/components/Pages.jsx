import React, { useState } from "react";
import {
  Sun,
  Sunrise,
  Sunset,
  Moon,
  MapPin,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  Plus,
  StickyNote,
  Target,
  Flame,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Upload,
  FileImage,
  Trash2,
  Search,
  Pin,
  Clock,
  MoreHorizontal,
  CalendarPlus,
  BookOpen,
  Leaf,
} from "lucide-react";
import {
  ArabicText,
  Button,
  Empty,
  IconButton,
  SectionTitle,
  Segmented,
} from "./ui";
import {
  addDays,
  challengeStatus,
  dateKey,
  dateTimeISO,
  hijriDate,
  makeCalendarFile,
  nextPrayer,
} from "../lib/domain";
import { download } from "../lib/storage";
import { categories } from "./EntityForm";

export const formatDay = (day, options = {}) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...options,
    timeZone: "UTC",
  });
export function formatTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":");
  return `${Number(h) % 12 || 12}:${m} ${Number(h) < 12 ? "AM" : "PM"}`;
}
const categoryClass = (category) =>
  `category-${(category || "Personal").toLowerCase()}`;
export function TaskRow({ task, today, onToggle, onEdit }) {
  return (
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button
        className="task-check"
        aria-label={`${task.done ? "Mark incomplete" : "Complete"}: ${task.title}`}
        aria-pressed={task.done}
        onClick={() => onToggle(task)}
      >
        {task.done && <Check size={14} />}
      </button>
      <button className="row-content" onClick={() => onEdit("task", task)}>
        <ArabicText text={task.title} />
        <span className="row-meta">
          <span className={`category-dot ${categoryClass(task.category)}`} />
          {task.category}
          {task.date && (
            <>
              {" "}
              ·{" "}
              <span
                className={task.date < today && !task.done ? "overdue" : ""}
              >
                {task.date === today ? "Today" : formatDay(task.date)}
                {task.time && `, ${formatTime(task.time)}`}
              </span>
            </>
          )}
          {task.priority === "High" && <span className="priority">High</span>}
        </span>
      </button>
      <IconButton
        icon={MoreHorizontal}
        label={`Edit ${task.title}`}
        onClick={() => onEdit("task", task)}
      />
    </div>
  );
}
export function EventRow({ event, onEdit }) {
  return (
    <button className="event-row" onClick={() => onEdit("event", event)}>
      <span className={`event-stripe ${categoryClass(event.category)}`} />
      <span className="event-time">
        {event.allDay ? "ALL DAY" : formatTime(event.start)}
        <small>{formatDay(event.date)}</small>
      </span>
      <span className="event-body">
        <ArabicText text={event.title} />
        <span className="row-meta">
          {event.category}
          {event.location && ` · ${event.location}`}
        </span>
      </span>
      <ArrowUpRight size={17} />
    </button>
  );
}
export function PrayerWidget({ state, now, today, onImport, onPrayers }) {
  const next = nextPrayer(state.prayerDays, now, state.settings.timeZone);
  const day = state.prayerDays.find((d) => d.date === today);
  const preferred = ["الفجر", "الظهر", "المغرب"];
  const entries = preferred
    .map((name) => day?.entries.find((e) => e.name === name))
    .filter(Boolean);
  const shown = entries.length
    ? entries
    : day?.entries.filter((e) => e.kind !== "sunrise").slice(0, 3) ||
      preferred.map((name) => ({ name, time: null }));
  const seconds = next?.remainingSeconds || 0;
  const countdown = `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
  return (
    <section className="prayer-widget" aria-label="Prayer times">
      <div className="prayer-card-top">
        <div>
          <span className="eyebrow gold">A MOMENT TO PAUSE</span>
          <p className="hijri" lang="ar" dir="rtl">
            {day?.hijriLabel || hijriDate(today, state.settings.hijriOffset)}
          </p>
        </div>
        <span className="prayer-location">
          <MapPin size={13} />
          {state.settings.city}
        </span>
      </div>
      <div className="prayer-tiles" dir="rtl">
        {shown.map((entry, i) => {
          const Icon = i === 0 ? Sunrise : i === 1 ? Sun : Moon;
          return (
            <div
              key={entry.name}
              className={`prayer-tile ${next?.date === today && next?.name === entry.name ? "next" : ""}`}
            >
              <Icon size={26} strokeWidth={1.25} />
              <span className="prayer-name" lang="ar">
                {entry.name}
              </span>
              <strong>
                {entry.time ? formatTime(entry.time).split(" ")[0] : "—:—"}
              </strong>
              <small>
                {entry.time
                  ? formatTime(entry.time).split(" ")[1]
                  : "Not added"}
              </small>
            </div>
          );
        })}
      </div>
      <div className="prayer-card-footer">
        {next ? (
          <>
            <span>
              Next:{" "}
              <span lang="ar" dir="rtl">
                {next.name}
              </span>{" "}
              in <b className="countdown">{countdown}</b>
            </span>
            <button onClick={onPrayers} aria-label="Open all prayers">
              <ArrowUpRight size={19} />
            </button>
          </>
        ) : (
          <>
            <span>
              {day
                ? "Next prayer times unavailable"
                : "Add your timetable to see accurate times"}
            </span>
            <button onClick={day ? onPrayers : onImport}>
              {day ? "View all" : "Add timetable"}
              <ArrowUpRight size={15} />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
export function Home({
  state,
  now,
  today,
  onEdit,
  onToggleTask,
  onImport,
  onNavigate,
  onChallenge,
}) {
  const tasks = state.tasks
    .filter((t) => !t.done && (!t.date || t.date <= today))
    .slice(0, 3);
  const events = state.events
    .filter((event) => {
      if (event.allDay)
        return event.endDate ? event.endDate > today : event.date >= today;
      try {
        return (
          Date.parse(
            dateTimeISO(
              event.endDate || event.date,
              event.end,
              event.timeZone || state.settings.timeZone,
            ),
          ) > now.getTime()
        );
      } catch {
        return event.date >= today;
      }
    })
    .sort((a, b) =>
      `${a.date}${a.start || ""}`.localeCompare(`${b.date}${b.start || ""}`),
    )
    .slice(0, 3);
  const challenges = state.challenges.slice(0, 2);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: state.settings.timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <>
      <div className="greeting">
        <div>
          <p className="eyebrow">
            {formatDay(today, { weekday: "long", month: "long" })}
          </p>
          <h1>
            {greeting}, {state.settings.name || "Ali"}
            <span className="greeting-dot">.</span>
          </h1>
          <p>A little more intention, every day.</p>
        </div>
        <span className="greeting-flower">
          <Leaf size={30} strokeWidth={1.2} />
        </span>
      </div>
      <div className="home-grid">
        <div className="home-primary">
          <PrayerWidget
            state={state}
            today={today}
            now={now}
            onImport={onImport}
            onPrayers={() => onNavigate("Prayers")}
          />
          <section className="card">
            <SectionTitle
              title="Make today count"
              subtitle={`${state.tasks.filter((t) => t.done && t.date === today).length} completed · your pace, your priorities`}
              action="My tasks"
              onAction={() => onNavigate("My Space", "Tasks")}
            />
            {tasks.length ? (
              <div className="list">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    onToggle={onToggleTask}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            ) : (
              <Empty
                icon={CheckCheck}
                title="A little space to begin"
                text="Choose one thing you’d like to get done today."
                action="Add your first task"
                onAction={() => onEdit("task")}
                compact
              />
            )}
            <button className="add-row" onClick={() => onEdit("task")}>
              <Plus size={17} />
              Add a task
            </button>
          </section>
        </div>
        <div className="home-secondary">
          <section className="card">
            <SectionTitle
              title="On the horizon"
              subtitle="A little room for what’s next."
              action="Calendar"
              onAction={() => onNavigate("Calendar")}
            />
            {events.length ? (
              <div className="list">
                {events.map((event) => (
                  <EventRow key={event.id} event={event} onEdit={onEdit} />
                ))}
              </div>
            ) : (
              <Empty
                icon={CalendarDays}
                title="Your time, thoughtfully planned"
                text="Bring your personal, work, and college plans together."
                action="Plan something"
                onAction={() => onEdit("event")}
                compact
              />
            )}
          </section>
          <section className="intention-card">
            <div className="intention-icon">
              <Flame size={23} strokeWidth={1.5} />
            </div>
            <span className="eyebrow">40 DAYS OF SHOWING UP</span>
            <h2>
              Small steps.
              <br />
              Lasting change.
            </h2>
            <p>Make a commitment to yourself, one day at a time.</p>
            {challenges.length ? (
              challenges.map((challenge) => {
                const status = challengeStatus(
                  challenge,
                  dateKey(now, challenge.timeZone),
                );
                return (
                  <button
                    className="challenge-mini"
                    key={challenge.id}
                    onClick={() => onChallenge(challenge)}
                  >
                    <ArabicText text={challenge.title} />
                    <strong>
                      {status.count}/40 <ArrowRight size={14} />
                    </strong>
                  </button>
                );
              })
            ) : (
              <Button
                variant="secondary"
                icon={Plus}
                onClick={() => onEdit("challenge")}
              >
                Start a challenge
              </Button>
            )}
          </section>
        </div>
      </div>
      <section className="quick-capture">
        <span>
          <StickyNote size={22} strokeWidth={1.4} />
          <span>
            <strong>A thought worth keeping?</strong>
            <small>Give it a little space.</small>
          </span>
        </span>
        <Button variant="quiet" icon={Plus} onClick={() => onEdit("note")}>
          Write a note
        </Button>
      </section>
      <p className="home-footer">
        <span className="tiny-line" />
        YOUR DAY. YOUR RHYTHM.
        <span className="tiny-line" />
      </p>
    </>
  );
}

export function ChallengeCard({
  challenge,
  now,
  onEdit,
  onCheck,
  onReset,
  detailed = false,
}) {
  const status = challengeStatus(challenge, dateKey(now, challenge.timeZone));
  return (
    <article className="card challenge-card">
      <div className="challenge-card-heading">
        <span className="small-icon">
          <Flame size={21} />
        </span>
        <span className={`status-pill ${status.broken ? "warning" : ""}`}>
          {status.complete
            ? "Completed"
            : status.broken
              ? "Streak interrupted"
              : status.checkedToday
                ? "Checked in today"
                : "Ready for today"}
        </span>
        <IconButton
          icon={MoreHorizontal}
          label={`Edit ${challenge.title}`}
          onClick={() => onEdit("challenge", challenge)}
        />
      </div>
      <h3>
        <ArabicText text={challenge.title} />
      </h3>
      {challenge.description && <p dir="auto">{challenge.description}</p>}
      <div className="challenge-count">
        <strong>{status.count}</strong>
        <span>
          / 40 days
          <br />
          <small>Consecutive, at your own pace</small>
        </span>
      </div>
      <div
        className="forty-grid"
        aria-label={`${status.count} of 40 consecutive days completed`}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className={i < status.count ? "filled" : ""}>
            {i < status.count ? <Check size={12} /> : detailed ? i + 1 : ""}
          </span>
        ))}
      </div>
      {status.broken && (
        <p className="inline-warning">
          A day was missed. Reset when you’re ready to begin again.
        </p>
      )}
      <div className="challenge-actions">
        <Button
          variant={
            status.checkedToday || status.complete ? "secondary" : "primary"
          }
          icon={Check}
          disabled={status.checkedToday || status.complete || status.broken}
          onClick={() => onCheck(challenge)}
        >
          {status.complete
            ? "Forty days. Well done."
            : status.checkedToday
              ? "Today is done"
              : "Check in today"}
        </Button>
        <IconButton
          icon={RotateCcw}
          label={`Reset ${challenge.title}`}
          onClick={() => onReset(challenge)}
        />
      </div>
    </article>
  );
}

export function MySpace({
  state,
  today,
  now,
  section,
  setSection,
  onEdit,
  onToggleTask,
  onPatch,
  onCheck,
  onReset,
}) {
  const [query, setQuery] = useState(""),
    [taskFilter, setTaskFilter] = useState("Open");
  const names = {
    Tasks: "task",
    Goals: "goal",
    Notes: "note",
    Challenges: "challenge",
  };
  const match = (item) =>
    `${item.title} ${item.body || ""} ${item.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const items = (
    section === "Tasks"
      ? state.tasks.filter(
          (t) =>
            taskFilter === "All" ||
            (taskFilter === "Completed" ? t.done : !t.done),
        )
      : section === "Goals"
        ? state.goals
        : section === "Notes"
          ? [...state.notes].sort(
              (a, b) =>
                Number(b.pinned) - Number(a.pinned) ||
                (b.updatedAt || "").localeCompare(a.updatedAt || ""),
            )
          : state.challenges
  ).filter(match);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A PLACE FOR YOUR INTENTIONS</p>
          <h1>My Space</h1>
          <p>Thoughts, plans, and the person you’re becoming.</p>
        </div>
        <Button icon={Plus} onClick={() => onEdit(names[section])}>
          New {names[section]}
        </Button>
      </div>
      <Segmented
        values={["Tasks", "Goals", "Notes", "Challenges"]}
        value={section}
        onChange={setSection}
        label="My Space sections"
      />
      <div className="space-tools">
        <label className="search">
          <Search size={17} />
          <input
            aria-label={`Search ${section}`}
            placeholder={`Search ${section.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {section === "Tasks" && (
          <select
            aria-label="Filter tasks"
            className="compact-select"
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
          >
            <option>Open</option>
            <option>Completed</option>
            <option>All</option>
          </select>
        )}
      </div>
      {!items.length ? (
        <section className="card">
          <Empty
            icon={
              section === "Tasks"
                ? CheckCheck
                : section === "Goals"
                  ? Target
                  : section === "Notes"
                    ? StickyNote
                    : Flame
            }
            title={
              query
                ? "Nothing found just yet"
                : `A fresh start for your ${section.toLowerCase()}`
            }
            text={
              query
                ? "Try a different word or create something new."
                : section === "Challenges"
                  ? "Choose a small commitment and show up for 40 consecutive days."
                  : "Start with one. There’s no need to have it all figured out."
            }
            action={`New ${names[section]}`}
            onAction={() => onEdit(names[section])}
          />
        </section>
      ) : section === "Tasks" ? (
        <section className="card task-list-card">
          {items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              onToggle={onToggleTask}
              onEdit={onEdit}
            />
          ))}
        </section>
      ) : (
        <div className="space-grid">
          {items.map((item) =>
            section === "Challenges" ? (
              <ChallengeCard
                key={item.id}
                challenge={item}
                now={now}
                onEdit={onEdit}
                onCheck={onCheck}
                onReset={onReset}
                detailed
              />
            ) : section === "Notes" ? (
              <button
                className="card note-card"
                key={item.id}
                onClick={() => onEdit("note", item)}
              >
                <div className="note-top">
                  <StickyNote size={18} />
                  {item.pinned && <Pin size={14} />}
                </div>
                <h3>
                  <ArabicText text={item.title} />
                </h3>
                <p dir="auto">
                  {item.body || "An empty page, ready for a thought."}
                </p>
                <small>
                  {item.updatedAt
                    ? new Date(item.updatedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : ""}
                </small>
              </button>
            ) : (
              <article
                className={`card goal-card ${item.done ? "is-done" : ""}`}
                key={item.id}
              >
                <div className="section-heading">
                  <span className="small-icon">
                    <Target size={21} />
                  </span>
                  <IconButton
                    icon={MoreHorizontal}
                    label={`Edit ${item.title}`}
                    onClick={() => onEdit("goal", item)}
                  />
                </div>
                <h3>
                  <ArabicText text={item.title} />
                </h3>
                {item.description && <p dir="auto">{item.description}</p>}
                {item.targetDate && (
                  <small className="row-meta">
                    <CalendarDays size={13} />
                    {formatDay(item.targetDate)}
                  </small>
                )}
                {item.milestones?.length ? (
                  <>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${(item.milestones.filter((m) => m.done).length / item.milestones.length) * 100}%`,
                        }}
                      />
                    </div>
                    {item.milestones.map((m) => (
                      <label className="milestone-row" key={m.id}>
                        <input
                          type="checkbox"
                          checked={m.done}
                          onChange={() =>
                            onPatch("goals", {
                              ...item,
                              milestones: item.milestones.map((x) =>
                                x.id === m.id ? { ...x, done: !x.done } : x,
                              ),
                            })
                          }
                        />
                        <ArabicText text={m.title || "Untitled milestone"} />
                      </label>
                    ))}
                  </>
                ) : null}
                <Button
                  variant="secondary"
                  icon={Check}
                  onClick={() =>
                    onPatch("goals", { ...item, done: !item.done })
                  }
                >
                  {item.done ? "Completed · reopen" : "Mark goal complete"}
                </Button>
              </article>
            ),
          )}
        </div>
      )}
    </>
  );
}

function minutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function arranged(events) {
  const sorted = events
    .filter((e) => !e.allDay)
    .sort((a, b) => minutes(a.start) - minutes(b.start));
  let group = [],
    end = 0;
  const groups = [];
  for (const event of sorted) {
    if (group.length && minutes(event.start) >= end) {
      groups.push(group);
      group = [];
      end = 0;
    }
    group.push(event);
    end = Math.max(end, minutes(event.end));
  }
  if (group.length) groups.push(group);
  return groups.flatMap((group) => {
    const columns = [];
    const output = group.map((event) => {
      let column = columns.findIndex((end) => end <= minutes(event.start));
      if (column === -1) column = columns.length;
      columns[column] = minutes(event.end);
      return { ...event, column };
    });
    return output.map((event) => ({ ...event, columns: columns.length }));
  });
}
function Timeline({ dates, events, onEdit, today, now, zone }) {
  const current = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const currentMinutes =
    Number(current.hour) * 60 +
    Number(current.minute) +
    Number(current.second) / 60;
  return (
    <div className="timeline-scroll">
      <div className="timeline" style={{ "--day-count": dates.length }}>
        <div className="time-rail">
          <div className="timeline-day-heading" />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour}>
              {hour === 0
                ? "12 AM"
                : hour < 12
                  ? `${hour} AM`
                  : hour === 12
                    ? "12 PM"
                    : `${hour - 12} PM`}
            </span>
          ))}
        </div>
        {dates.map((day) => (
          <div className="timeline-day" key={day}>
            <div
              className={`timeline-day-heading ${day === today ? "today" : ""}`}
            >
              <span>
                {formatDay(day, { weekday: "short", month: undefined })}
              </span>
              <div className="all-day-events">
                {events
                  .filter((e) => e.date === day && e.allDay)
                  .map((event) => (
                    <button
                      key={event.id}
                      className={categoryClass(event.category)}
                      onClick={() => onEdit("event", event)}
                    >
                      <ArabicText text={event.title} />
                    </button>
                  ))}
              </div>
            </div>
            <div className="timeline-hours">
              {Array.from({ length: 24 }, (_, hour) => (
                <button
                  className="hour-slot"
                  aria-label={`New event ${day} ${hour}:00`}
                  key={hour}
                  onClick={() =>
                    onEdit("event", {
                      date: day,
                      start: `${String(hour).padStart(2, "0")}:00`,
                      end: `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${hour === 23 ? "59" : "00"}`,
                    })
                  }
                />
              ))}
              {arranged(events.filter((e) => e.date === day)).map((event) => (
                <button
                  className={`time-event ${categoryClass(event.category)}`}
                  style={{
                    top: `${(minutes(event.start) / 60) * 54}px`,
                    height: `${Math.max(30, ((minutes(event.end) - minutes(event.start)) / 60) * 54)}px`,
                    left: `calc(${(event.column / event.columns) * 100}% + 3px)`,
                    width: `calc(${100 / event.columns}% - 6px)`,
                  }}
                  key={event.id}
                  onClick={() => onEdit("event", event)}
                >
                  <ArabicText text={event.title} />
                  <small>{formatTime(event.start)}</small>
                </button>
              ))}
              {day === today && (
                <span
                  className="current-time-line"
                  role="img"
                  aria-label={`Current time ${formatTime(`${current.hour}:${current.minute}`)} in ${zone}`}
                  style={{ top: `${(currentMinutes / 60) * 54}px` }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function CalendarPage({
  state,
  today,
  now = new Date(),
  onEdit,
  notify,
}) {
  const [selected, setSelected] = useState(today),
    [view, setView] = useState("Month"),
    [filters, setFilters] = useState(categories);
  const first = `${selected.slice(0, 7)}-01`,
    weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monthDates = Array.from({ length: 42 }, (_, i) =>
    addDays(first, i - weekday),
  );
  const weekStart = addDays(
    selected,
    -((new Date(`${selected}T12:00:00Z`).getUTCDay() + 6) % 7),
  );
  const filtered = state.events.filter((e) => filters.includes(e.category));
  const dayEvents = filtered
    .filter((e) => e.date === selected)
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const selectedHijri =
    state.prayerDays.find((day) => day.date === selected)?.hijriLabel ||
    hijriDate(selected, state.settings.hijriOffset);
  function move(direction) {
    if (view === "Month") {
      const d = new Date(`${first}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + direction);
      setSelected(d.toISOString().slice(0, 10));
    } else
      setSelected(addDays(selected, direction * (view === "Week" ? 7 : 1)));
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
          <h1>Your calendar</h1>
          <p>Life, work, and college. In a little more balance.</p>
        </div>
        <Button icon={Plus} onClick={() => onEdit("event", { date: selected })}>
          New event
        </Button>
      </div>
      <div className="calendar-toolbar">
        <Segmented
          values={["Month", "Week", "Day", "Agenda"]}
          value={view}
          onChange={setView}
          label="Calendar view"
        />
        <button className="text-button" onClick={() => setSelected(today)}>
          Today
        </button>
        <IconButton
          icon={CalendarPlus}
          label="Export filtered calendars"
          onClick={() => {
            if (!filtered.length)
              return notify("Add an event before exporting your calendar.");
            download(
              "hyte-calendar.ics",
              makeCalendarFile(filtered, state.settings.timeZone),
              "text/calendar;charset=utf-8",
            );
            notify(
              "Calendar snapshot exported. Open it in Apple Calendar to import.",
            );
          }}
        />
      </div>
      <div className="category-filters">
        {categories.map((category) => (
          <button
            key={category}
            className={filters.includes(category) ? "active" : ""}
            aria-pressed={filters.includes(category)}
            onClick={() =>
              setFilters((f) =>
                f.includes(category)
                  ? f.filter((c) => c !== category)
                  : [...f, category],
              )
            }
          >
            <span className={`category-dot ${categoryClass(category)}`} />
            {category}
          </button>
        ))}
      </div>
      <section className="card calendar-card">
        <div className="month-heading">
          <IconButton
            icon={ChevronLeft}
            label="Previous period"
            onClick={() => move(-1)}
          />
          <label className="date-jump">
            <strong>
              {formatDay(selected, {
                month: "long",
                year: "numeric",
                day: undefined,
              })}
            </strong>
            <input
              type="date"
              aria-label="Jump to date"
              value={selected}
              onInput={(e) => e.target.value && setSelected(e.target.value)}
              onChange={(e) => e.target.value && setSelected(e.target.value)}
            />
          </label>
          <IconButton
            icon={ChevronRight}
            label="Next period"
            onClick={() => move(1)}
          />
        </div>
        {view === "Month" ? (
          <>
            <div className="weekdays">
              {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="month-grid">
              {monthDates.map((day) => {
                const events = filtered.filter((e) => e.date === day);
                return (
                  <button
                    key={day}
                    aria-label={`${formatDay(day)}${day === today ? ", today" : ""}, ${events.length} events`}
                    aria-pressed={day === selected}
                    className={`${day.slice(0, 7) !== selected.slice(0, 7) ? "other-month" : ""} ${day === selected ? "selected" : ""} ${day === today ? "today" : ""}`}
                    onClick={() => setSelected(day)}
                  >
                    <span>{Number(day.slice(-2))}</span>
                    <div className="day-dots">
                      {events.slice(0, 3).map((event) => (
                        <i
                          key={event.id}
                          className={categoryClass(event.category)}
                        />
                      ))}
                    </div>
                    <div className="month-event-labels">
                      {events.slice(0, 2).map((event) => (
                        <span key={event.id}>
                          <i className={categoryClass(event.category)} />
                          <ArabicText text={event.title} />
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : view === "Week" || view === "Day" ? (
          <Timeline
            dates={
              view === "Day"
                ? [selected]
                : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
            }
            events={filtered}
            today={today}
            now={now}
            zone={state.settings.timeZone}
            onEdit={onEdit}
          />
        ) : (
          <div className="agenda-list">
            {filtered
              .filter((e) => e.date >= selected)
              .sort((a, b) =>
                `${a.date}${a.start || ""}`.localeCompare(
                  `${b.date}${b.start || ""}`,
                ),
              )
              .slice(0, 60)
              .map((event) => (
                <EventRow key={event.id} event={event} onEdit={onEdit} />
              ))}
            {!filtered.some((e) => e.date >= selected) && (
              <Empty
                icon={CalendarDays}
                title="Open days ahead"
                text="Choose a date and make your first plan."
                action="New event"
                onAction={() => onEdit("event", { date: selected })}
              />
            )}
          </div>
        )}
      </section>
      {view !== "Agenda" && (
        <section className="card selected-day">
          <SectionTitle
            title={
              selected === today
                ? "Today’s plans"
                : formatDay(selected, { weekday: "long", month: "long" })
            }
            subtitle={selectedHijri}
            action="Add event"
            onAction={() => onEdit("event", { date: selected })}
          />
          {dayEvents.length ? (
            dayEvents.map((event) => (
              <EventRow key={event.id} event={event} onEdit={onEdit} />
            ))
          ) : (
            <p className="quiet-empty">
              No events here yet. A little breathing room.
            </p>
          )}
        </section>
      )}
    </>
  );
}

export function PrayersPage({ state, today, now, onImport, onSource, onUndo }) {
  const [selected, setSelected] = useState(today);
  const day = state.prayerDays.find((d) => d.date === selected);
  const record = state.imports.find((i) => i.id === day?.importId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ANCHORS FOR YOUR DAY</p>
          <h1>Prayers</h1>
          <p>Your community’s timetable. Your daily rhythm.</p>
        </div>
        <Button icon={Upload} onClick={onImport}>
          Add timetable
        </Button>
      </div>
      <PrayerWidget
        state={state}
        today={today}
        now={now}
        onImport={onImport}
        onPrayers={() =>
          document
            .getElementById("prayer-detail")
            ?.scrollIntoView({ behavior: "smooth" })
        }
      />
      <section className="card" id="prayer-detail">
        <div className="section-heading">
          <div>
            <h2>Daily timetable</h2>
            <p>
              <MapPin size={12} /> {state.settings.city} ·{" "}
              {state.settings.timeZone}
            </p>
          </div>
          <input
            className="compact-date"
            aria-label="Timetable date"
            type="date"
            value={selected}
            onInput={(e) => e.target.value && setSelected(e.target.value)}
            onChange={(e) => e.target.value && setSelected(e.target.value)}
          />
        </div>
        <p className="table-hijri" lang="ar" dir="rtl">
          {day?.hijriLabel || hijriDate(selected, state.settings.hijriOffset)}
        </p>
        {day ? (
          <>
            <div
              className="prayer-table"
              role="table"
              aria-label="Confirmed prayer timetable"
            >
              <div className="prayer-table-header" role="row">
                <span role="columnheader">Prayer</span>
                <span role="columnheader">Time</span>
              </div>
              {day.entries.map((entry) => (
                <div className="prayer-table-row" role="row" key={entry.name}>
                  <span role="cell" className="prayer-table-name">
                    <span className="small-icon">
                      {entry.kind === "sunrise" ? (
                        <Sunrise size={20} />
                      ) : (
                        <Moon size={20} />
                      )}
                    </span>
                    <span lang="ar" dir="rtl">
                      {entry.name}
                    </span>
                    {entry.kind === "sunrise" && <small>Sunrise</small>}
                  </span>
                  <strong role="cell">{formatTime(entry.time)}</strong>
                </div>
              ))}
            </div>
            <div className="source-line">
              <CheckCheck size={15} />
              <span>
                Reviewed import · {record?.name || "Confirmed timetable"}
              </span>
              {record?.imageId && (
                <button
                  className="text-button"
                  onClick={() => onSource(record)}
                >
                  Source
                </button>
              )}
            </div>
          </>
        ) : (
          <Empty
            icon={Moon}
            title="No confirmed times for this date"
            text="Upload your monthly timetable or enter the exact times manually. Hyte won’t guess your prayer times."
            action="Add timetable"
            onAction={onImport}
          />
        )}
      </section>
      <section className="card">
        <SectionTitle
          title="Your monthly imports"
          subtitle="Source images stay privately on this device."
        />
        {state.imports.length ? (
          state.imports.map((record) => (
            <div className="import-history-row" key={record.id}>
              <span className="small-icon">
                <FileImage size={20} />
              </span>
              <button className="row-content" onClick={() => onSource(record)}>
                <ArabicText text={record.month || record.name} />
                <span className="row-meta">
                  {record.city} ·{" "}
                  {new Date(record.createdAt).toLocaleDateString("en-GB")}
                </span>
              </button>
              <IconButton
                icon={Trash2}
                label={`Undo import ${record.month || record.name}`}
                onClick={() => onUndo(record)}
              />
            </div>
          ))
        ) : (
          <p className="quiet-empty">
            Your confirmed imports will appear here.
          </p>
        )}
      </section>
      <p className="page-footnote">
        Hijri dates are estimates unless confirmed by your timetable. Adjust the
        date in Settings to match your local month.
      </p>
    </>
  );
}
