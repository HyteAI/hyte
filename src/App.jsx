import React, { useCallback, useEffect, useState } from "react";
import {
  Home as HomeIcon,
  CalendarDays,
  LayoutGrid,
  Moon,
  Settings as SettingsIcon,
  CloudOff,
  Check,
  AlertCircle,
  WifiOff,
  Download,
  Loader2,
  Mail,
  KeyRound,
  ArrowRight,
} from "lucide-react";
import { useHyteState } from "./lib/useHyteState";
import { cloudConfigured, supabase, media, download } from "./lib/storage";
import {
  createDefaultState,
  dateKey,
  checkIn,
  resetChallenge,
  validateBackup,
  undoImportedSchedule,
} from "./lib/domain";
import {
  ArabicText,
  Button,
  Confirm,
  IconButton,
  Segmented,
  Sheet,
} from "./components/ui";
import { EntityForm } from "./components/EntityForm";
import { PrayerImport } from "./components/PrayerImport";
import {
  Home,
  CalendarPage,
  MySpace,
  PrayersPage,
  ChallengeCard,
} from "./components/Pages";
import { Settings } from "./components/Settings";

const collections = {
  task: "tasks",
  event: "events",
  goal: "goals",
  note: "notes",
  challenge: "challenges",
};
const tabs = [
  { name: "Home", icon: HomeIcon },
  { name: "Calendar", icon: CalendarDays },
  { name: "My Space", icon: LayoutGrid },
  { name: "Prayers", icon: Moon },
];

function AuthScreen() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [method, setMethod] = useState(() =>
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true
        ? "Password"
        : "Email link",
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function signIn(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error } =
        method === "Password"
          ? await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : await supabase.auth.signInWithOtp({
              email: email.trim(),
              options: {
                emailRedirectTo: window.location.origin,
                shouldCreateUser: false,
              },
            });
      if (error) throw error;
      setPassword("");
      if (method === "Email link")
        setMessage("Check your email for your private sign-in link.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <img src="/logo-dark.svg" alt="Hyte" />
        <p className="eyebrow">YOUR DAY, WITH INTENTION</p>
        <h1>A space that’s yours.</h1>
        <p>Sign in to your private Hyte workspace.</p>
        <Segmented
          label="Sign-in method"
          values={["Password", "Email link"]}
          value={method}
          onChange={(next) => {
            if (busy) return;
            setMethod(next);
            setPassword("");
            setMessage("");
            setError("");
          }}
        />
        <form onSubmit={signIn}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            disabled={busy}
            placeholder="Your account email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {method === "Password" && (
            <>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>Use the password you set in Hyte Settings.</small>
            </>
          )}
          <Button
            type="submit"
            icon={method === "Password" ? KeyRound : Mail}
            disabled={busy}
          >
            {method === "Password"
              ? busy
                ? "Signing in…"
                : "Sign in"
              : busy
                ? "Sending link…"
                : "Send sign-in link"}
          </Button>
        </form>
        {message && <p className="notice">{message}</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <small>Only your private account can access this workspace.</small>
      </div>
    </main>
  );
}
export default function App() {
  const [session, setSession] = useState(null),
    [authReady, setAuthReady] = useState(!cloudConfigured);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setAuthReady(true);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuthReady(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!authReady)
    return (
      <div className="loading-screen">
        <Loader2 className="spin" />
        <p>Opening your space…</p>
      </div>
    );
  if (cloudConfigured && !session) return <AuthScreen />;
  return <Workspace key={session?.user.id || "local"} session={session} />;
}
function Workspace({ session }) {
  const { state, setState, syncStatus, error, scheduleError, reloadCloud } =
    useHyteState(session?.user.id);
  const [tab, setTab] = useState(
    () =>
      ({ calendar: "Calendar", tasks: "My Space", prayers: "Prayers" })[
        new URLSearchParams(location.search).get("view")
      ] || "Home",
  );
  const [section, setSection] = useState("Tasks"),
    [sheet, setSheet] = useState(null),
    [confirm, setConfirm] = useState(null),
    [toast, setToast] = useState(""),
    [now, setNow] = useState(new Date()),
    [wallpaper, setWallpaper] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [systemDark, setSystemDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [updateReady, setUpdateReady] = useState(null);
  const ownerKey = session?.user.id || "local",
    today = dateKey(now, state.settings.timeZone),
    dark =
      state.settings.appearance === "dark" ||
      (state.settings.appearance === "system" && systemDark);
  const notify = useCallback((text) => setToast(text), []);
  const close = useCallback(() => setSheet(null), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    const mediaQuery = matchMedia("(prefers-color-scheme: dark)");
    const theme = (e) => setSystemDark(e.matches);
    mediaQuery.addEventListener("change", theme);
    const network = () => setOffline(!navigator.onLine);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      clearInterval(timer);
      mediaQuery.removeEventListener("change", theme);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#101a16" : "#edf1e9");
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    let active = true;
    media("get", `${ownerKey}:wallpaper`)
      .then((value) => {
        if (active && value) setWallpaper(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ownerKey]);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
    let mounted = true;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting && mounted) setUpdateReady(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller &&
              mounted
            )
              setUpdateReady(worker);
          });
        });
      })
      .catch(() =>
        notify("Offline installation is unavailable in this browser."),
      );
    return () => {
      mounted = false;
    };
  }, []);
  function navigate(next, sub) {
    setTab(next);
    if (sub) setSection(sub);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function edit(type, item) {
    if (syncStatus === "loading")
      return notify("Your private data is still loading.");
    setSheet({ type, item });
  }
  function patch(collection, item) {
    setState((s) => ({
      ...s,
      [collection]: s[collection].some((x) => x.id === item.id)
        ? s[collection].map((x) => (x.id === item.id ? item : x))
        : [item, ...s[collection]],
    }));
  }
  function saveEntity(type, item) {
    patch(collections[type], item);
    notify(
      `${type[0].toUpperCase() + type.slice(1)} saved${session ? "" : " on this device"}.`,
    );
  }
  function deleteEntity(type, item) {
    close();
    setConfirm({
      title: `Delete this ${type}?`,
      text: `“${item.title}” will be removed. This cannot be undone.`,
      action: "Delete",
      run: () => {
        setState((s) => ({
          ...s,
          [collections[type]]: s[collections[type]].filter(
            (x) => x.id !== item.id,
          ),
        }));
        notify(`${type} deleted.`);
      },
    });
  }
  function checkChallenge(challenge) {
    try {
      patch(
        "challenges",
        checkIn(challenge, dateKey(new Date(), challenge.timeZone)),
      );
      notify("You showed up today. That counts.");
    } catch (err) {
      notify(err.message);
    }
  }
  function reset(challenge) {
    close();
    setConfirm({
      title: "Start your 40 days again?",
      text: `Resetting “${challenge.title}” clears all current check-ins. Your challenge stays, and you can begin again today.`,
      action: "Reset progress",
      run: () => {
        patch(
          "challenges",
          resetChallenge(challenge, dateKey(new Date(), challenge.timeZone)),
        );
        notify("Progress reset. A fresh start is ready.");
      },
    });
  }
  function addImport({ record, days, events }) {
    setState((s) => ({
      ...s,
      imports: [record, ...s.imports],
      prayerDays: [
        ...s.prayerDays.filter(
          (d) => !days.some((newDay) => newDay.date === d.date),
        ),
        ...days,
      ],
      events: [...s.events, ...events],
    }));
    notify("Reviewed timetable and events saved.");
  }
  async function source(record) {
    try {
      const image = record.imageId ? await media("get", record.imageId) : null;
      setSheet({ type: "source", record, image });
    } catch (err) {
      notify(err.message);
    }
  }
  function undoImport(record) {
    setConfirm({
      title: "Undo this timetable import?",
      text: "Prayer times and calendar events still linked to this import will be removed. Earlier times are restored where possible. Undo newer overlapping imports first.",
      action: "Undo import",
      run: () => {
        try {
          setState(undoImportedSchedule(state, record.id));
          if (record.imageId) media("delete", record.imageId).catch(() => {});
          notify("Import undone.");
        } catch (err) {
          notify(err.message);
        }
      },
    });
  }
  function restore(data) {
    try {
      const replacement = validateBackup(data);
      replacement.settings.hasWallpaper = Boolean(state.settings.hasWallpaper);
      close();
      setConfirm({
        title: "Replace your current data?",
        text: "This restores the backup and replaces your current plans, notes, imports, and challenges. Export your current data first if you need to keep it. Images are device-local and are not included in JSON backups.",
        action: "Restore backup",
        run: () => {
          setState(replacement);
          notify("Backup restored.");
        },
      });
    } catch (err) {
      notify(err.message);
    }
  }
  function clearData() {
    close();
    setConfirm({
      title: session
        ? "Clear your Hyte workspace?"
        : "Clear this device’s Hyte data?",
      text: session
        ? "This removes your saved planning records and will sync the empty workspace to your cloud account. Export a backup first."
        : "This removes your saved planning records from this browser. Export a backup first. Uploaded images may remain in device storage until you clear the site’s data.",
      action: "Clear data",
      run: () => {
        setState(createDefaultState());
        media("delete", `${ownerKey}:wallpaper`).catch(() => {});
        setWallpaper("");
        notify("Planning data cleared.");
      },
    });
  }
  const shared = { state, today, now, onEdit: edit };
  return (
    <div
      className={`app ${tab === "Home" ? "on-home" : ""}`}
      style={{
        "--wallpaper-dim": `${state.settings.wallpaperDim / 100}`,
        "--wallpaper-position": state.settings.wallpaperPosition || "center",
      }}
    >
      {tab === "Home" && (
        <div
          className={`home-backdrop ${wallpaper ? "has-wallpaper" : ""}`}
          style={
            wallpaper
              ? {
                  backgroundImage: `linear-gradient(rgba(8,27,19,var(--wallpaper-dim)),rgba(8,27,19,var(--wallpaper-dim))),url("${wallpaper}")`,
                }
              : undefined
          }
        />
      )}
      <header className="app-header">
        <button
          className="brand"
          onClick={() => navigate("Home")}
          aria-label="Hyte Home"
        >
          <img src={dark ? "/logo-dark.svg" : "/logo-light.svg"} alt="" />
          <span>
            hyte<span className="brand-period">.</span>
          </span>
        </button>
        <div className="header-right">
          <span className={`save-status ${error ? "has-error" : ""}`}>
            <span className="status-dot" />
            {offline
              ? "Offline"
              : syncStatus === "local"
                ? "On this device"
                : syncStatus === "synced"
                  ? "Saved privately"
                  : syncStatus === "saving"
                    ? "Saving…"
                    : syncStatus === "loading"
                      ? "Loading…"
                      : syncStatus === "conflict"
                        ? "Review sync"
                        : "Check connection"}
          </span>
          <IconButton
            icon={SettingsIcon}
            label="Open Settings"
            onClick={() => setSheet({ type: "settings" })}
          />
        </div>
      </header>
      <main className="main-content" id="main-content">
        {(error || scheduleError) && (
          <div className="error-banner" role="alert">
            <AlertCircle size={19} />
            <div>
              {error && <p>{error}</p>}
              {scheduleError && <p>Notification scheduling: {scheduleError}</p>}
              <div className="banner-actions">
                <button
                  onClick={() =>
                    download(
                      "hyte-backup.json",
                      JSON.stringify(state, null, 2),
                      "application/json",
                    )
                  }
                >
                  Export a backup
                </button>
                {session && (
                  <button
                    onClick={() =>
                      setConfirm({
                        title: "Load the cloud version?",
                        text: "Your unsynced edits on this device will be replaced. Export a backup before continuing.",
                        action: "Load cloud copy",
                        run: () => reloadCloud(),
                      })
                    }
                  >
                    Load cloud copy
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {offline && (
          <div className="offline-banner">
            <WifiOff size={15} />
            Offline · edits stay on this device until you reconnect.
          </div>
        )}
        {updateReady && (
          <div className="notice">
            <Download size={19} />
            <div>
              A fresh version of Hyte is available.
              <button
                className="text-button"
                onClick={() => {
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                  updateReady.postMessage("SKIP_WAITING");
                }}
              >
                Save and refresh
              </button>
            </div>
          </div>
        )}
        {syncStatus === "loading" ? (
          <div className="loading-screen">
            <Loader2 className="spin" />
            <p>Opening your private plans…</p>
          </div>
        ) : (
          <>
            {tab === "Home" && (
              <Home
                {...shared}
                onToggleTask={(task) =>
                  patch("tasks", { ...task, done: !task.done })
                }
                onImport={() => edit("import")}
                onNavigate={navigate}
                onChallenge={(challenge) =>
                  setSheet({ type: "challenge-detail", item: challenge })
                }
              />
            )}
            {tab === "Calendar" && <CalendarPage {...shared} notify={notify} />}
            {tab === "My Space" && (
              <MySpace
                {...shared}
                section={section}
                setSection={setSection}
                onToggleTask={(task) =>
                  patch("tasks", { ...task, done: !task.done })
                }
                onPatch={patch}
                onCheck={checkChallenge}
                onReset={reset}
              />
            )}
            {tab === "Prayers" && (
              <PrayersPage
                {...shared}
                onImport={() => edit("import")}
                onSource={source}
                onUndo={undoImport}
              />
            )}
          </>
        )}
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {tabs.map(({ name, icon: Icon }) => (
          <button
            key={name}
            aria-current={tab === name ? "page" : undefined}
            className={tab === name ? "active" : ""}
            onClick={() => navigate(name)}
          >
            <Icon size={23} strokeWidth={1.65} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
        </div>
      )}
      {sheet && collections[sheet.type] && (
        <EntityForm
          key={`${sheet.type}:${sheet.item?.id || "new"}`}
          type={sheet.type}
          item={sheet.item}
          today={today}
          zone={state.settings.timeZone}
          onSave={(item) => saveEntity(sheet.type, item)}
          onDelete={(item) => deleteEntity(sheet.type, item)}
          onClose={close}
          notify={notify}
        />
      )}
      {sheet?.type === "import" && (
        <PrayerImport
          state={state}
          ownerKey={ownerKey}
          today={today}
          onSave={addImport}
          onClose={close}
        />
      )}
      {sheet?.type === "settings" && (
        <Settings
          state={state}
          setState={setState}
          ownerKey={ownerKey}
          wallpaper={wallpaper}
          setWallpaper={setWallpaper}
          notify={notify}
          session={session}
          syncStatus={syncStatus}
          onClose={close}
          onRestore={restore}
          onClear={clearData}
        />
      )}
      {sheet?.type === "source" && (
        <Sheet
          title={sheet.record.month || sheet.record.name}
          subtitle="Original timetable · device-local source"
          onClose={close}
        >
          {sheet.image ? (
            <img
              className="source-image"
              src={sheet.image}
              alt="Original uploaded timetable"
            />
          ) : (
            <p className="muted">
              {sheet.record.imageId
                ? "The original image is stored on the device where it was uploaded. It is not available in this browser."
                : "This timetable was entered manually; no image was attached."}
            </p>
          )}
        </Sheet>
      )}
      {sheet?.type === "challenge-detail" && (
        <Sheet title="Forty days, one at a time" onClose={close}>
          <ChallengeCard
            challenge={
              state.challenges.find((c) => c.id === sheet.item.id) || sheet.item
            }
            now={now}
            onEdit={edit}
            onCheck={checkChallenge}
            onReset={reset}
            detailed
          />
        </Sheet>
      )}
      {confirm && (
        <Confirm
          title={confirm.title}
          text={confirm.text}
          action={confirm.action}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run();
          }}
        />
      )}
    </div>
  );
}
