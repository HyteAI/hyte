import { useCallback, useEffect, useRef, useState } from "react";
import { api, supabase } from "./storage.js";
import { createDefaultState, validateBackup } from "./domain.js";

const COLLECTIONS = [
  "events",
  "tasks",
  "goals",
  "notes",
  "challenges",
  "prayerDays",
  "imports",
];
const CONFLICT_MESSAGE =
  "The cloud version changed on another device. Your local edits are kept here. Reload cloud to replace them with the cloud version.";

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Saved data is not a valid Hyte workspace.");
  if (value.version != null && value.version !== 1)
    throw new Error("This workspace uses a different data version.");
  const defaults = createDefaultState();
  const state = { ...defaults, ...value, version: 1 };
  for (const key of COLLECTIONS) {
    if (value[key] != null && !Array.isArray(value[key]))
      throw new Error(`Saved ${key} data is invalid.`);
    state[key] = value[key] || defaults[key];
  }
  if (
    value.settings != null &&
    (typeof value.settings !== "object" || Array.isArray(value.settings))
  ) {
    throw new Error("Saved settings are invalid.");
  }
  state.settings = { ...defaults.settings, ...value.settings };
  return validateBackup(state);
}

function readCache(key) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
    if (!raw)
      return {
        data: createDefaultState(),
        revision: null,
        dirty: false,
        error: null,
        corruptRaw: null,
      };
    const parsed = JSON.parse(raw);
    const envelope = parsed?.cacheVersion === 1;
    return {
      data: normalizeState(envelope ? parsed.data : parsed),
      revision:
        envelope &&
        Number.isSafeInteger(parsed.revision) &&
        parsed.revision >= 0
          ? parsed.revision
          : null,
      dirty: envelope && parsed.dirty === true,
      error: null,
      corruptRaw: null,
    };
  } catch {
    return {
      data: createDefaultState(),
      revision: null,
      dirty: false,
      corruptRaw: raw,
      error:
        "Saved device data could not be read. It has not been overwritten. New changes remain in memory if device storage is unavailable.",
    };
  }
}

function offline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function message(error, fallback) {
  return error?.message || fallback;
}

/** Device persistence plus serialized optimistic cloud writes for a single signed-in owner. */
export function useHyteState(userId = null) {
  const key = `hyte-state:${userId || "local"}`;
  const cloud = Boolean(supabase && userId);
  const cached = useRef(null);
  if (!cached.current || cached.current.key !== key)
    cached.current = { key, ...readCache(key) };

  const [record, setRecord] = useState(() => ({
    key,
    data: cached.current.data,
  }));
  const [syncStatus, setSyncStatus] = useState(cloud ? "loading" : "local");
  const [error, setError] = useState(cached.current.error);
  const [scheduleError, setScheduleError] = useState(null);
  const control = useRef(null);

  useEffect(() => {
    const initial = cached.current;
    const c = {
      key,
      userId,
      cloud,
      active: true,
      latest: initial.data,
      baseline: initial.dirty ? null : JSON.stringify(initial.data),
      baseRevision: initial.revision,
      revision: null,
      dirty: initial.dirty,
      ready: !cloud,
      loading: false,
      saving: false,
      blocked: false,
      timer: null,
      loadPromise: null,
      localError: initial.error,
      remoteError: null,
      corruptRaw: initial.corruptRaw,
    };
    control.current = c;
    setRecord({ key, data: c.latest });
    setError(c.localError);
    setScheduleError(null);
    setSyncStatus(cloud ? "loading" : "local");

    function showError() {
      // Fast Refresh may recreate this effect while preserving refs. Keep its
      // seed current even when storage fails, so it never restores stale data.
      if (cached.current?.key === key) {
        cached.current = {
          key,
          data: c.latest,
          revision: c.baseRevision,
          dirty: c.cloud && c.dirty,
          error: c.localError,
          corruptRaw: c.corruptRaw,
        };
      }
      if (c.active)
        setError(
          [c.localError, c.remoteError].filter(Boolean).join(" ") || null,
        );
    }

    function persist() {
      try {
        // Preserve unreadable content before replacing it. If backup storage fails,
        // keep the original untouched and retain the new state in memory.
        if (c.corruptRaw !== null) {
          localStorage.setItem(`${key}:recovery:${Date.now()}`, c.corruptRaw);
          c.corruptRaw = null;
        }
        localStorage.setItem(
          key,
          JSON.stringify({
            cacheVersion: 1,
            data: c.latest,
            revision: c.baseRevision,
            dirty: c.cloud && c.dirty,
          }),
        );
        c.localError = null;
      } catch {
        c.localError =
          "Changes are still in memory, but could not be saved on this device. Storage may be full or blocked. Keep Hyte open and export your data.";
      }
      showError();
    }

    function markConflict() {
      c.blocked = true;
      c.ready = false;
      c.remoteError = CONFLICT_MESSAGE;
      if (c.active) setSyncStatus("conflict");
      persist();
    }

    function queueSave(delay = 700) {
      clearTimeout(c.timer);
      if (!c.active || !c.cloud || !c.ready || c.blocked || !c.dirty) return;
      c.timer = setTimeout(save, delay);
    }

    async function save() {
      if (!c.active || c.saving || !c.ready || c.blocked || !c.dirty) return;
      if (offline()) {
        c.remoteError =
          "You are offline. Changes are saved on this device and will retry when you reconnect.";
        setSyncStatus("offline");
        persist();
        return;
      }
      const sent = JSON.stringify(c.latest);
      const revision = c.revision;
      c.saving = true;
      c.remoteError = null;
      setSyncStatus("saving");
      showError();
      try {
        const payload = {
          user_id: userId,
          data: JSON.parse(sent),
          revision: revision + 1,
        };
        const query =
          revision === 0
            ? supabase.from("hyte_state").insert(payload)
            : supabase
                .from("hyte_state")
                .update({ data: payload.data, revision: payload.revision })
                .eq("user_id", userId)
                .eq("revision", revision);
        const result = await query.select("revision").maybeSingle();
        if (!c.active) return;
        if (result.error?.code === "23505" || (!result.error && !result.data)) {
          markConflict();
          return;
        }
        if (result.error) throw result.error;
        if (result.data.revision !== revision + 1)
          throw new Error("The cloud returned an unexpected data revision.");
        c.revision = result.data.revision;
        c.baseRevision = result.data.revision;
        c.baseline = sent;
        c.dirty = JSON.stringify(c.latest) !== sent;
        c.remoteError = null;
        persist();
        // Scheduler failure never turns a saved workspace into a fake success for reminders.
        try {
          await api("/api/schedule", {});
          if (c.active) setScheduleError(null);
        } catch (scheduleFailure) {
          if (c.active)
            setScheduleError(
              `Your data was saved, but reminders could not be scheduled: ${message(scheduleFailure, "Please retry later.")}`,
            );
        }
        if (c.active) setSyncStatus(c.dirty ? "saving" : "synced");
      } catch (failure) {
        if (!c.active) return;
        c.remoteError = `Cloud save failed. Your local changes are kept. ${message(failure, "Reconnect and try again.")}`;
        setSyncStatus(offline() ? "offline" : "error");
        persist();
      } finally {
        c.saving = false;
      }
      // Edits made during a save are a separate payload with the newly returned revision.
      if (c.active && !c.remoteError && c.dirty) queueSave(200);
    }

    function loadCloud(discardLocal = false) {
      if (!c.active || !c.cloud) return Promise.resolve(false);
      if (c.loadPromise) return c.loadPromise;
      if (c.saving) {
        c.remoteError =
          "Wait for the current save to finish before reloading the cloud version.";
        showError();
        return Promise.resolve(false);
      }
      clearTimeout(c.timer);
      c.loading = true;
      c.ready = false;
      setSyncStatus("loading");
      const pending = Promise.resolve().then(async () => {
        try {
          const result = await supabase
            .from("hyte_state")
            .select("data, revision")
            .eq("user_id", userId)
            .maybeSingle();
          if (!c.active) return false;
          if (result.error) throw result.error;
          const remote = result.data
            ? normalizeState(result.data.data)
            : createDefaultState();
          const revision = result.data ? result.data.revision : 0;
          if (!Number.isSafeInteger(revision) || revision < 0)
            throw new Error("The cloud workspace has an invalid revision.");
          const serialized = JSON.stringify(remote);
          const localMatches = JSON.stringify(c.latest) === serialized;
          // Offline edits may resume only from the exact revision they were based on.
          // An unknown or different baseline requires an explicit discard/reload.
          if (
            !discardLocal &&
            c.dirty &&
            !localMatches &&
            revision !== 0 &&
            revision !== c.baseRevision
          ) {
            markConflict();
            return false;
          }
          if (discardLocal || !c.dirty || localMatches) {
            c.latest = remote;
            c.dirty = false;
            setRecord({ key, data: remote });
          }
          c.revision = revision;
          c.baseRevision = revision;
          c.baseline = serialized;
          c.blocked = false;
          c.ready = true;
          c.remoteError = null;
          c.dirty = JSON.stringify(c.latest) !== serialized;
          persist();
          setSyncStatus(c.dirty ? "saving" : "synced");
          if (c.dirty) queueSave(0);
          return true;
        } catch (failure) {
          if (!c.active) return false;
          c.remoteError = `Cloud data could not be loaded. Cached data is shown on this device; cloud writes are paused. ${message(failure, "Reconnect or reload cloud to retry.")}`;
          setSyncStatus(offline() ? "offline" : "error");
          showError();
          return false;
        } finally {
          c.loading = false;
          c.loadPromise = null;
        }
      });
      c.loadPromise = pending;
      return pending;
    }

    c.persist = persist;
    c.queueSave = queueSave;
    c.showError = showError;
    c.loadCloud = loadCloud;
    if (cloud) void loadCloud();

    function reconnect() {
      if (!c.active || !c.cloud || c.blocked) return;
      if (!c.ready) void loadCloud();
      else if (c.dirty) queueSave(0);
      else {
        c.remoteError = null;
        showError();
        setSyncStatus("synced");
      }
    }
    function disconnected() {
      if (c.active && c.cloud && !c.blocked) setSyncStatus("offline");
    }
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnected);
    return () => {
      c.active = false;
      clearTimeout(c.timer);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", disconnected);
      if (control.current === c) control.current = null;
    };
  }, [key, userId, cloud]);

  const setState = useCallback(
    (update) => {
      const c = control.current;
      if (!c || c.key !== key || !c.active) return;
      if (c.cloud && c.loading) {
        c.remoteError =
          "Please wait for your private data to finish loading before making changes.";
        c.showError();
        return;
      }
      try {
        const next = normalizeState(
          typeof update === "function" ? update(c.latest) : update,
        );
        const serialized = JSON.stringify(next);
        c.latest = next;
        c.dirty = c.cloud && serialized !== c.baseline;
        setRecord({ key, data: next });
        c.persist();
        if (c.cloud && c.ready && !c.blocked) c.queueSave();
      } catch (failure) {
        c.localError = `The change could not be applied. ${message(failure, "Your previous data has been kept.")}`;
        c.showError();
      }
    },
    [key],
  );

  const reloadCloud = useCallback(async () => {
    const c = control.current;
    if (!c || c.key !== key || !c.active || !c.cloud) return false;
    // Calling this is the explicit recovery action: it discards unsynced local edits.
    return c.loadCloud(true);
  }, [key]);

  return {
    state: record.key === key ? record.data : cached.current.data,
    setState,
    syncStatus,
    error,
    scheduleError,
    reloadCloud,
  };
}
