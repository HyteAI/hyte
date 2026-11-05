import React, { useEffect, useState } from "react";
import {
  Bell,
  Download,
  ImagePlus,
  LogOut,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button, Field, Segmented, Sheet } from "./ui.jsx";
import { api, download, imageData, media, supabase } from "../lib/storage.js";
import { makeCalendarFile } from "../lib/domain.js";

function pushKey(value) {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export default function Settings({
  state,
  setState,
  ownerKey,
  wallpaper,
  setWallpaper,
  notify,
  session,
  syncStatus,
  onClose,
  onRestore,
  onClear,
}) {
  const [busy, setBusy] = useState("");
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [pushError, setPushError] = useState("");
  const [subscription, setSubscription] = useState(null);
  const [registrationSaved, setRegistrationSaved] = useState(false);
  const [permission, setPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const settings = state.settings;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  const supported =
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext;
  const needsInstall = isIOS && !installed;
  const patchSettings = (patch) =>
    setState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));

  async function loadConfig() {
    setConfigError("");
    if ("Notification" in window) setPermission(Notification.permission);
    if (!session) {
      setConfig(null);
      setRegistrationSaved(false);
      return;
    }
    try {
      setConfig(await api("/api/notifications"));
    } catch (error) {
      setConfig(null);
      setConfigError(error.message);
    }
  }

  useEffect(() => {
    let active = true;
    setRegistrationSaved(false);
    loadConfig();
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .getRegistration("/")
        .then(async (registration) => {
          const existing = await registration?.pushManager?.getSubscription();
          if (active) setSubscription(existing || null);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  async function uploadWallpaper(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("wallpaper");
    try {
      const image = await imageData(file);
      await media("put", `${ownerKey}:wallpaper`, image);
      setWallpaper(image);
      patchSettings({ hasWallpaper: true });
      notify("Wallpaper saved on this device.");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy("");
    }
  }

  async function removeWallpaper() {
    setBusy("wallpaper");
    try {
      await media("delete", `${ownerKey}:wallpaper`);
      setWallpaper(null);
      patchSettings({ hasWallpaper: false });
      notify("Default wallpaper restored.");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy("");
    }
  }

  async function enablePush() {
    setPushError("");
    if (!supported || needsInstall || !config?.configured || !config?.publicKey)
      return;
    setBusy("push");
    setRegistrationSaved(false);
    let browserSubscription;
    try {
      const result =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted")
        throw new Error(
          result === "denied"
            ? "Notifications are blocked. Change permission in your device settings, then try again."
            : "Permission was not granted. You can enable notifications later.",
        );
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const next =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: pushKey(config.publicKey),
        }));
      browserSubscription = next;
      setSubscription(next);
      const saved = await api("/api/notifications", {
        action: "subscribe",
        subscription: next.toJSON(),
      });
      if (saved.saved !== true)
        throw new Error("The server did not confirm saving this device.");
      setRegistrationSaved(true);
      try {
        await api("/api/schedule", {});
        notify(
          config.schedulerConfigured
            ? "Push connection saved. Send a test to check delivery."
            : "Push connection saved. Scheduled alerts still need the background scheduler.",
        );
      } catch (error) {
        setPushError(
          `Push connection saved, but reminder scheduling needs attention: ${error.message}`,
        );
      }
    } catch (error) {
      setPushError(
        browserSubscription
          ? `The browser subscription exists, but its server registration was not confirmed. ${error.message}`
          : error.message,
      );
    } finally {
      setBusy("");
    }
  }

  async function testPush() {
    setPushError("");
    setBusy("push");
    try {
      await api("/api/notifications", { action: "test" });
      notify("Test sent to your connected devices. Check for its arrival.");
    } catch (error) {
      setPushError(error.message);
    } finally {
      setBusy("");
    }
  }

  async function disablePush() {
    setPushError("");
    setBusy("push");
    try {
      if (!subscription) return;
      await api("/api/notifications", {
        action: "unsubscribe",
        endpoint: subscription.endpoint,
      });
      setRegistrationSaved(false);
      const removed = await subscription.unsubscribe();
      if (!removed)
        throw new Error(
          "The server connection was removed, but this browser could not remove its subscription. Check device notification settings.",
        );
      setSubscription(null);
      notify(
        "Push connection removed for this device. Device permission may still be granted.",
      );
    } catch (error) {
      setPushError(error.message);
    } finally {
      setBusy("");
    }
  }

  async function restoreBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("restore");
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 10 MB.");
      const parsed = JSON.parse(await file.text());
      await onRestore(parsed);
    } catch (error) {
      notify(
        error instanceof SyntaxError
          ? "This file is not a valid JSON backup."
          : error.message,
      );
    } finally {
      setBusy("");
    }
  }

  function exportBackup() {
    const backup = { ...state, settings: { ...settings, hasWallpaper: false } };
    download(
      `hyte-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      "application/json;charset=utf-8",
    );
    notify(
      "Data backup exported. Wallpaper and source images are not included.",
    );
  }

  return (
    <Sheet
      title="Settings"
      subtitle="Make Hyte feel like you."
      onClose={onClose}
    >
      <section className="settings-section">
        <h3>Appearance</h3>
        <Segmented
          label="Appearance"
          values={["System", "Light", "Dark"]}
          value={(settings.appearance || "system").replace(/^./, (letter) =>
            letter.toUpperCase(),
          )}
          onChange={(value) =>
            patchSettings({ appearance: value.toLowerCase() })
          }
        />
        <p className="muted">System follows your iPhone's appearance.</p>
      </section>

      <section className="settings-section">
        <h3>Your Home wallpaper</h3>
        {wallpaper && (
          <img
            className="wallpaper-preview"
            src={wallpaper}
            alt="Your current Home wallpaper"
            style={{ objectPosition: settings.wallpaperPosition || "center" }}
          />
        )}
        <Field
          label={
            busy === "wallpaper"
              ? "Saving wallpaper…"
              : "Choose from Photos or Files"
          }
          hint="JPEG, PNG, or WebP, up to 20 MB. HEIC photos need exporting as JPEG first. Saved only on this device."
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={Boolean(busy)}
            onChange={uploadWallpaper}
          />
        </Field>
        <Field label={`Wallpaper dimming · ${settings.wallpaperDim ?? 35}%`}>
          <input
            type="range"
            min="0"
            max="70"
            step="5"
            value={settings.wallpaperDim ?? 35}
            onChange={(event) =>
              patchSettings({ wallpaperDim: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Image position">
          <select
            value={settings.wallpaperPosition || "center"}
            onChange={(event) =>
              patchSettings({ wallpaperPosition: event.target.value })
            }
          >
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </Field>
        <Button
          icon={ImagePlus}
          variant="secondary"
          disabled={!wallpaper || Boolean(busy)}
          onClick={removeWallpaper}
        >
          Restore default wallpaper
        </Button>
      </section>

      <section className="settings-section">
        <h3>Personal details</h3>
        <Field label="Your name">
          <input
            value={settings.name || ""}
            maxLength="60"
            onChange={(event) => patchSettings({ name: event.target.value })}
            autoComplete="given-name"
          />
        </Field>
        <Field
          label="City"
          hint="Changing this label does not recalculate prayer times. Your confirmed timetable remains the source."
        >
          <input
            value={settings.city || ""}
            maxLength="80"
            onChange={(event) => patchSettings({ city: event.target.value })}
          />
        </Field>
        <Field
          label="Time zone"
          hint="Planning dates and challenge check-ins currently use Muscat time."
        >
          <input value={settings.timeZone || "Asia/Muscat"} readOnly />
        </Field>
        <Field
          label="Hijri date adjustment"
          hint="The general Hijri date is an estimate. Confirmed imported dates take priority for their timetable coverage."
        >
          <select
            value={settings.hijriOffset || 0}
            onChange={(event) =>
              patchSettings({ hijriOffset: Number(event.target.value) })
            }
          >
            {[-2, -1, 0, 1, 2].map((value) => (
              <option key={value} value={value}>
                {value === 0
                  ? "No adjustment"
                  : `${value > 0 ? "+" : ""}${value} day${Math.abs(value) === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="settings-section">
        <h3>Notifications</h3>
        <p className="muted">
          On iPhone, open Hyte in Safari, choose Share → Add to Home Screen,
          then launch it from that icon before enabling notifications.
        </p>
        {!supported && (
          <p className="notice">
            This browser does not currently support secure Web Push. Use a
            supported browser or the installed iPhone app.
          </p>
        )}
        {needsInstall && (
          <p className="notice">
            Add Hyte to your Home Screen and open the installed app first.
          </p>
        )}
        <dl className="settings-status">
          <div>
            <dt>Device permission</dt>
            <dd>
              {permission === "unsupported"
                ? "Unavailable"
                : permission === "default"
                  ? "Not requested"
                  : permission === "granted"
                    ? "Granted"
                    : "Blocked"}
            </dd>
          </div>
          <div>
            <dt>Device subscription</dt>
            <dd>{subscription ? "Present" : "Not connected"}</dd>
          </div>
          <div>
            <dt>Server registration</dt>
            <dd>
              {subscription
                ? registrationSaved
                  ? "Saved this session"
                  : "Reconnect to verify"
                : "Not connected"}
            </dd>
          </div>
          <div>
            <dt>Push sender</dt>
            <dd>
              {config?.configured
                ? "Configured"
                : configError
                  ? "Could not check"
                  : "Needs setup"}
            </dd>
          </div>
          <div>
            <dt>Background scheduler</dt>
            <dd>
              {config?.schedulerConfigured ? "Configured" : "Needs setup"}
            </dd>
          </div>
        </dl>
        <p className="muted">
          Permission and a device subscription alone do not guarantee scheduled
          delivery. The sender and scheduler must both be configured, and the
          device controls delivery.
        </p>
        {!session && (
          <p className="notice">
            Connect the private cloud account before setting up background
            alerts. Your local tasks remain usable.
          </p>
        )}
        {configError && (
          <p role="alert" className="notice">
            {configError} Vite alone does not run the hosted notification API.
          </p>
        )}
        {pushError && (
          <p role="alert" className="notice">
            {pushError}
          </p>
        )}
        <div className="form-row">
          <Button
            icon={Bell}
            disabled={
              Boolean(busy) ||
              !supported ||
              needsInstall ||
              !config?.configured ||
              !config?.publicKey ||
              permission === "denied"
            }
            onClick={enablePush}
          >
            {busy === "push"
              ? "Working…"
              : subscription
                ? "Reconnect push"
                : "Enable push"}
          </Button>
          <Button
            variant="secondary"
            disabled={
              Boolean(busy) ||
              !subscription ||
              !registrationSaved ||
              !config?.configured
            }
            onClick={testPush}
          >
            Send test
          </Button>
        </div>
        {subscription && (
          <Button
            variant="secondary"
            disabled={Boolean(busy) || !session}
            onClick={disablePush}
          >
            Disconnect this device
          </Button>
        )}
        {session && (
          <Button
            icon={RefreshCw}
            variant="quiet"
            disabled={Boolean(busy)}
            onClick={loadConfig}
          >
            Check service setup
          </Button>
        )}
      </section>

      <section className="settings-section">
        <h3>Storage &amp; account</h3>
        <p className="status-pill">
          {{
            local: "Saved on this device",
            loading: "Loading private data…",
            saving: "Saving changes…",
            synced: "Saved privately",
            offline: "Offline · changes stay on this device",
            conflict: "Cloud changes need review",
            error: "Cloud connection needs attention",
          }[syncStatus] ||
            (session
              ? "Private cloud account connected"
              : "Saved on this device")}
        </p>
        <p className="muted">
          Wallpaper and timetable images stay in this browser's private device
          storage. They are not synced to other devices. Notes save when you
          press Save.
        </p>
        <p className="muted">
          Image extraction:{" "}
          {config?.extractionConfigured
            ? "Service configured; review is still required."
            : "Needs a configured private server, or enter the timetable manually."}
        </p>
        {session?.user?.email && <p>{session.user.email}</p>}
        {session && (
          <Button
            icon={LogOut}
            variant="secondary"
            disabled={Boolean(busy)}
            onClick={async () => {
              setBusy("signout");
              try {
                const { error } = await supabase.auth.signOut();
                if (error) throw error;
              } catch (error) {
                notify(error.message);
              } finally {
                setBusy("");
              }
            }}
          >
            Sign out
          </Button>
        )}
      </section>

      <section className="settings-section">
        <h3>Backups &amp; data</h3>
        <p className="muted">
          Backups include structured planning data. Wallpaper and original
          timetable images are excluded.
        </p>
        <Button icon={Download} variant="secondary" onClick={exportBackup}>
          Export data backup
        </Button>
        <Field
          label={
            busy === "restore" ? "Reading backup…" : "Restore a JSON backup"
          }
          hint="You will review a confirmation before replacing saved data."
        >
          <input
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busy)}
            onChange={restoreBackup}
          />
        </Field>
        <Button
          icon={Trash2}
          variant="danger"
          disabled={Boolean(busy)}
          onClick={onClear}
        >
          {session ? "Clear workspace data" : "Clear local data"}
        </Button>
        <p className="muted">
          {session
            ? "This also clears planning records in your connected cloud workspace. It does not delete your account. Export a backup first; the next step asks for confirmation."
            : "A confirmation will explain what is removed. Uploaded source images may remain until you clear this site’s device storage."}
        </p>
      </section>

      <section className="settings-section">
        <h3>Apple connections</h3>
        <p className="muted">
          Apple Calendar receives exported calendar files as snapshots. This is
          not an updating subscription or two-way sync.
        </p>
        <Button
          icon={Download}
          variant="secondary"
          disabled={!state.events.length}
          onClick={() => {
            try {
              download(
                "hyte-calendar.ics",
                makeCalendarFile(
                  state.events,
                  settings.timeZone || "Asia/Muscat",
                ),
                "text/calendar;charset=utf-8",
              );
              notify(
                "Calendar snapshot exported. Import the file in your calendar application.",
              );
            } catch (error) {
              notify(error.message);
            }
          }}
        >
          Export calendar snapshot
        </Button>
        <p className="muted">
          For Apple Reminders, open a saved task and use Copy for Apple
          Reminders, then paste it into Reminders. No reminder is created
          automatically. A connected Apple Shortcut is not included yet.
        </p>
      </section>
    </Sheet>
  );
}

export { Settings };
