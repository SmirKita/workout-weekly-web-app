import { createClient } from "@supabase/supabase-js";

const META_KEY = "workout-sync-meta:v1";
const OUTBOX_KEY = "workout-sync-outbox:v1";
const IMPORTED_USERS_KEY = "workout-sync-imported-users:v1";
const UPSERT_RPC_NAME = "upsert_workout_sync_record";

function isSyncableKey(key) {
  return key.startsWith("workout-") && !key.startsWith("workout-sync-");
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function newestHistoryDate(payload) {
  const dates = Object.values(payload?.exercises || {})
    .flatMap((exercise) => exercise.history || [])
    .map((entry) => entry.date)
    .filter(Boolean)
    .sort();
  return dates.at(-1) || "";
}

function inferredUpdatedAt(key, payload) {
  if (payload?.updatedAt) return payload.updatedAt;
  if (key === "workout-exercise-results:v2") return newestHistoryDate(payload);
  if (key === "workout-cardio-results:v1") return payload.sessions?.map((entry) => entry.updatedAt || entry.date).filter(Boolean).sort().at(-1) || "";
  if (key === "workout-body-metrics:v1") return payload.entries?.map((entry) => entry.updatedAt || entry.date).filter(Boolean).sort().at(-1) || "";
  if (key.startsWith("workout-notes-")) {
    const progress = loadJson(key.replace("workout-notes-", "workout-progress-"), {});
    if (progress.updatedAt) return progress.updatedAt;
  }
  return "";
}

function hasMeaningfulData(key, payload) {
  if (!payload || typeof payload !== "object") return false;
  if (key.startsWith("workout-notes-")) {
    return Object.values(payload).some((note) => String(note || "").trim());
  }
  if (key === "workout-exercise-results:v2") {
    return Object.keys(payload.exercises || {}).length > 0;
  }
  if (key === "workout-cardio-results:v1") {
    return (payload.sessions || []).length > 0;
  }
  if (key === "workout-body-metrics:v1") {
    return (payload.entries || []).length > 0;
  }
  return [
    payload.exercises,
    payload.feedback,
    payload.fatigue,
    payload.workingWeights,
    payload.strength,
    payload.cardio,
  ].some((group) => Object.keys(group || {}).length > 0);
}

function localRecords() {
  const meta = loadJson(META_KEY, {});
  const records = new Map();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isSyncableKey(key)) continue;
    const payload = loadJson(key, null);
    if (!hasMeaningfulData(key, payload)) continue;
    const updatedAt = meta[key] || inferredUpdatedAt(key, payload) || new Date().toISOString();
    records.set(key, { recordKey: key, payload, updatedAt });
  }
  return records;
}

function compareDates(left, right) {
  return new Date(left || 0).getTime() - new Date(right || 0).getTime();
}

function stripWrappingQuotes(value) {
  return String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

function normalizeSupabaseUrl(value) {
  const parsed = new URL(stripWrappingQuotes(value));
  if (parsed.protocol !== "https:") throw new Error("Supabase URL должен использовать HTTPS");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Supabase URL должен содержать только адрес проекта без дополнительного пути");
  }
  return parsed.origin;
}

function safeResponseText(value) {
  return String(value || "")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[скрыто]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[скрыто]")
    .slice(0, 1200);
}

export function createWorkoutCloudSync({ onStatus, onRemoteApplied } = {}) {
  const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = stripWrappingQuotes(import.meta.env.VITE_SUPABASE_ANON_KEY);
  let supabaseUrl = "";
  let configurationError = "";
  try {
    if (rawSupabaseUrl) supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
  } catch (error) {
    configurationError = error.message;
  }
  const configured = Boolean(supabaseUrl && supabaseAnonKey && !configurationError);
  let lastRequest = null;
  const diagnosticFetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input.url;
    try {
      const response = await fetch(input, init);
      const responseText = safeResponseText(await response.clone().text());
      let responseCode = "";
      try {
        const body = JSON.parse(responseText);
        responseCode = body.code || body.error_code || "";
      } catch {
        responseCode = "";
      }
      lastRequest = {
        supabaseUrl,
        requestUrl,
        status: response.status,
        code: responseCode,
        response: responseText,
      };
      return response;
    } catch (error) {
      lastRequest = {
        supabaseUrl,
        requestUrl,
        status: 0,
        code: error.name || "network_error",
        response: safeResponseText(error.message),
      };
      throw error;
    }
  };
  const client = configured
    ? createClient(supabaseUrl, supabaseAnonKey, {
      global: { fetch: diagnosticFetch },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    : null;

  let user = null;
  let syncing = false;
  let syncTimer = null;
  let intervalId = null;

  const report = (status, message = "") => onStatus?.({
    configured,
    status,
    message,
    user,
    online: navigator.onLine,
    outboxCount: Object.keys(loadJson(OUTBOX_KEY, {})).length,
    diagnostics: lastRequest || {
      supabaseUrl: supabaseUrl || stripWrappingQuotes(rawSupabaseUrl),
      requestUrl: "",
      status: "",
      code: configurationError ? "invalid_supabase_url" : "",
      response: configurationError,
    },
  });

  function markLocalChange(recordKey, payload, updatedAt = new Date().toISOString()) {
    if (!isSyncableKey(recordKey)) return;
    const meta = loadJson(META_KEY, {});
    const outbox = loadJson(OUTBOX_KEY, {});
    meta[recordKey] = updatedAt;
    outbox[recordKey] = { recordKey, payload, updatedAt };
    saveJson(META_KEY, meta);
    saveJson(OUTBOX_KEY, outbox);
    if (user && !syncing) report(navigator.onLine ? "ready" : "offline");
    scheduleSync();
  }

  function registerExistingData() {
    if (!user) return;
    const importedUsers = loadJson(IMPORTED_USERS_KEY, []);
    if (importedUsers.includes(user.id)) return;
    const meta = loadJson(META_KEY, {});
    const outbox = loadJson(OUTBOX_KEY, {});
    localRecords().forEach((record, key) => {
      meta[key] = record.updatedAt;
      outbox[key] = record;
    });
    saveJson(META_KEY, meta);
    saveJson(OUTBOX_KEY, outbox);
    saveJson(IMPORTED_USERS_KEY, [...importedUsers, user.id]);
  }

  async function pushRecord(record) {
    const { error } = await client.rpc(UPSERT_RPC_NAME, {
      p_record_key: record.recordKey,
      p_payload: record.payload,
      p_client_updated_at: record.updatedAt,
    });
    if (error) throw error;
  }

  function applyCloudRecord(record) {
    localStorage.setItem(record.record_key, JSON.stringify(record.payload));
    const meta = loadJson(META_KEY, {});
    const outbox = loadJson(OUTBOX_KEY, {});
    meta[record.record_key] = record.client_updated_at;
    if (compareDates(outbox[record.record_key]?.updatedAt, record.client_updated_at) <= 0) {
      delete outbox[record.record_key];
    }
    saveJson(META_KEY, meta);
    saveJson(OUTBOX_KEY, outbox);
  }

  async function syncNow() {
    if (!configured || !user || !navigator.onLine || syncing) return;
    syncing = true;
    report("syncing", "Синхронизация...");
    const appliedKeys = [];
    try {
      registerExistingData();
      const { data: cloudRows, error } = await client
        .from("workout_sync_records")
        .select("record_key,payload,client_updated_at");
      if (error) throw error;

      const cloud = new Map((cloudRows || []).map((row) => [row.record_key, row]));
      const local = localRecords();
      const outbox = loadJson(OUTBOX_KEY, {});
      Object.values(outbox).forEach((record) => local.set(record.recordKey, record));
      const keys = new Set([...local.keys(), ...cloud.keys()]);

      for (const key of keys) {
        const localRecord = local.get(key);
        const cloudRecord = cloud.get(key);
        if (!cloudRecord && localRecord) {
          await pushRecord(localRecord);
          continue;
        }
        if (cloudRecord && !localRecord) {
          applyCloudRecord(cloudRecord);
          appliedKeys.push(key);
          continue;
        }
        if (compareDates(localRecord.updatedAt, cloudRecord.client_updated_at) > 0) {
          await pushRecord(localRecord);
        } else if (compareDates(localRecord.updatedAt, cloudRecord.client_updated_at) < 0) {
          applyCloudRecord(cloudRecord);
          appliedKeys.push(key);
        }
      }

      const nextOutbox = loadJson(OUTBOX_KEY, {});
      Object.keys(nextOutbox).forEach((key) => {
        const cloudRecord = cloud.get(key);
        if (!cloudRecord || compareDates(nextOutbox[key].updatedAt, cloudRecord.client_updated_at) >= 0) {
          delete nextOutbox[key];
        }
      });
      saveJson(OUTBOX_KEY, nextOutbox);
      if (appliedKeys.length) onRemoteApplied?.(appliedKeys);
      report("synced", `Синхронизировано ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (error) {
      console.error("Workout cloud sync failed", {
        message: error.message,
        diagnostics: lastRequest,
      });
      report("error", error.message || "Не удалось синхронизировать данные");
    } finally {
      syncing = false;
    }
  }

  function scheduleSync(delay = 700) {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(syncNow, delay);
  }

  async function signIn(email) {
    if (!configured) throw new Error("Supabase ещё не настроен");
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });
    if (error) {
      error.diagnostics = lastRequest;
      throw error;
    }
    report("email-sent", "Код отправлен на почту");
  }

  async function verifyOtp(email, token) {
    if (!configured) throw new Error("Supabase ещё не настроен");
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) {
      error.diagnostics = lastRequest;
      throw error;
    }
    user = data.session?.user || data.user || user;
    report(user ? "ready" : "signed-out");
    if (user) await syncNow();
    return data;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) {
      error.diagnostics = lastRequest;
      throw error;
    }
  }

  async function init() {
    if (!configured) {
      report("unconfigured", configurationError || "Облачная синхронизация не настроена");
      return;
    }
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    report(user ? "ready" : "signed-out");
    if (user) await syncNow();

    client.auth.onAuthStateChange((event, session) => {
      user = session?.user || null;
      report(user ? "ready" : "signed-out");
      if (user && event !== "TOKEN_REFRESHED") scheduleSync(0);
    });

    window.addEventListener("online", () => {
      report(user ? "ready" : "signed-out", "Соединение восстановлено");
      scheduleSync(0);
    });
    window.addEventListener("offline", () => report("offline", "Офлайн: изменения сохраняются на устройстве"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleSync(0);
    });
    intervalId = window.setInterval(() => scheduleSync(0), 30000);
  }

  return {
    configured,
    init,
    markLocalChange,
    signIn,
    verifyOtp,
    signOut,
    syncNow,
    destroy() {
      window.clearTimeout(syncTimer);
      window.clearInterval(intervalId);
    },
  };
}
