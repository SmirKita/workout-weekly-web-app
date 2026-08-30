import { archivedExercises, filters, progression, safety, workouts } from "../data/workouts.js";
import {
  acceptRecommendation,
  calculateSessionEffort,
  createCurrentPlan,
  CURRENT_PLAN_VERSION,
  currentPlanStorageKey,
  effortCategory,
  validateCurrentPlan,
} from "../data/current-plan.js";
import { createWorkoutCloudSync } from "./cloud-sync.js";
import {
  duplicateBodyPairs,
  formatNumber,
  formatWeightData,
  fourWeekChange,
  normalizeCardioEntry,
  normalizeWeightData,
  parseLocaleNumber,
  performanceTextFrom,
  setResultsFrom,
} from "./data-model.js";

const state = {
  activeDayId: workouts[0].id,
  query: "",
  filter: "Все",
  quickMode: false,
  reportWeekKey: null,
  showReportText: false,
};

const currentWeek = getCurrentWeekInfo();
const progressStorageKey = `workout-progress-${currentWeek.key}`;
const notesStorageKey = `workout-notes-${currentWeek.key}`;
const exerciseResultsStorageKey = "workout-exercise-results:v2";
const cardioResultsStorageKey = "workout-cardio-results:v1";
const bodyMetricsStorageKey = "workout-body-metrics:v1";
const dataReviewStorageKey = "workout-data-review:v1";
const authLinkCooldownStorageKey = "workout-sync-auth-link-cooldown-until:v1";
const syncMetaStorageKey = "workout-sync-meta:v1";
const fridayPoolCompletionKey = "fri-pool-section:0";
const legacyFridayPoolCompletionKeys = [
  "fri-warmup-section:0",
  "fri-warmup-section:1",
  "fri-technique-section:0",
  "fri-main-section:0",
  "fri-extra-section:0",
  "fri-cooldown-section:0",
];
const backupFileName = "backup-workout-weekly.json";
const authLinkCooldownMs = 60 * 1000;
const saved = loadSaved();
let currentPlan = loadCurrentPlan();
let exerciseResults;
const cardioResults = loadCardioResults();
let bodyMetrics;
let dataReviewState = loadJson(dataReviewStorageKey, { dismissed: {}, updatedAt: "" });
let cloudSync = null;
let authLinkSubmitting = false;
let authOtpSubmitting = false;
let authLinkCooldownTimer = null;
let lastCloudSyncPayload = null;
const baseUrl = import.meta.env.BASE_URL;

const els = {
  hero: document.querySelector(".hero"),
  scrollTopButton: document.querySelector("#scrollTopButton"),
  dayPills: document.querySelector("#dayPills"),
  todayButton: document.querySelector("#todayButton"),
  week: document.querySelector("#week"),
  dayDetails: document.querySelector("#dayDetails"),
  searchInput: document.querySelector("#searchInput"),
  filters: document.querySelector("#filters"),
  quickMode: document.querySelector("#quickMode"),
  historyList: document.querySelector("#historyList"),
  loadSummary: document.querySelector("#loadSummary"),
  weeklyReport: document.querySelector("#weeklyReport"),
  bodyTracker: document.querySelector("#bodyTracker"),
  dataReview: document.querySelector("#dataReview"),
  safetyList: document.querySelector("#safetyList"),
  progressionList: document.querySelector("#progressionList"),
  cloudSync: document.querySelector("#cloudSync"),
};

const metricHelp = {
  "Подходы/повторы": "Например, 3x10-12 означает: 3 подхода по 10-12 повторений.",
  Вес: "Рабочий стартовый вес на эту неделю. Выполни упражнение по плану и отметь нагрузку по шкале от «Легко» до «Тяжело». В конце недели по отметкам скорректируем вес.",
  "RPE/RIR": "RPE — насколько тяжело по ощущениям. RIR — сколько повторов осталось в запасе.",
  Отдых: "Пауза между подходами перед следующим рабочим подходом.",
};

const groupLabels = {
  prep: "Подготовка",
  main: "Основная часть",
  finish: "Завершение",
};

const effortLevels = Array.from({ length: 10 }, (_, index) => {
  const score = index + 1;
  return { value: score, score: String(score), label: effortCategory(score) };
});

function effortLevelFor(value) {
  return effortLevels.find((level) => level.value === Number(value)) || null;
}

const effortReportLabels = {
  easy: "легко",
  "normal-light": "норма ближе к легко",
  normal: "норма",
  "normal-hard": "норма ближе к тяжело",
  hard: "тяжело",
};

const backupWorkout2Results = {
  "leg-press": ["60 кг", "normal"],
  "leg-extension": ["25 кг", "normal"],
  "lying-leg-curl": ["20 кг", "normal"],
  "hip-thrust": ["10 кг", "normal"],
  "romanian-deadlift": ["14 кг / рука", "normal"],
  "pallof-press": ["10 кг", "normal"],
  "lat-pulldown": ["40 кг", "normal"],
  "seated-row": ["35 кг", "normal"],
  "chest-press": ["35 кг", "normal"],
  "reverse-fly": ["15 кг", "normal"],
  "face-pull-wed": ["15 кг", "normal"],
  "straight-arm-pulldown": ["15 кг", "normal"],
  "shoulder-press": ["8 кг / рука", "easy"],
  "lateral-raise": ["5 кг / рука", "normal"],
  "face-pull-sat": ["15 кг", "normal"],
  "biceps-curl": ["8 кг / рука", "normal"],
  "triceps-pushdown": ["15 кг", "easy"],
  "hammer-curl": ["7 кг / рука", "easy"],
  "biceps-curl-machine": ["15 кг", "hard"],
  "front-raise": ["5 кг / рука", "normal"],
  "close-grip-push-up": ["Без веса", "normal"],
  plank: ["Без веса", "normal"],
  "side-plank": ["Без веса", "normal"],
  crunches: ["Без веса", "normal"],
  "leg-raise": ["Без веса", "normal"],
  "russian-twist": ["5 кг", "normal"],
  "dead-bug": ["Без веса", "normal"],
  superman: ["Без веса", "normal"],
  "bird-dog": ["Без веса", "normal"],
};

exerciseResults = loadExerciseResults();

const bodyMetricDefaults = {
  weightKg: 75.5,
  targetWeightKg: 79.9,
  bodyFatPercent: 24.4,
  waterPercent: 50.5,
  visceralFat: 10.3,
  subcutaneousFatPercent: 16.4,
  musclePercent: 70.8,
  muscleMassKg: 53.45,
  skeletalMusclePercent: 52,
  fatFreeMassKg: 57.08,
  boneMassKg: 2.94,
  proteinPercent: 21.1,
  bmrKcal: 1597,
  biologicalAge: 42,
  waistCm: "",
  weeklyAverageWeightKg: "",
  sleepHours: "",
  recovery: "normal",
};

const bodyMetricFields = [
  ["weightKg", "Вес", "кг"],
  ["bodyFatPercent", "Жир", "%"],
  ["waterPercent", "Вода", "%"],
  ["visceralFat", "Висцеральный жир", ""],
  ["subcutaneousFatPercent", "Подкожный жир", "%"],
  ["musclePercent", "Мышцы", "%"],
  ["muscleMassKg", "Мышечная масса", "кг"],
  ["skeletalMusclePercent", "Скелетные мышцы", "%"],
  ["fatFreeMassKg", "Безжировая масса", "кг"],
  ["boneMassKg", "Костная масса", "кг"],
  ["proteinPercent", "Белок", "%"],
  ["bmrKcal", "BMR", "ккал"],
  ["biologicalAge", "Биологический возраст", ""],
  ["waistCm", "Талия", "см"],
  ["weeklyAverageWeightKg", "Средний вес за неделю", "кг"],
  ["sleepHours", "Сон", "ч"],
];

const bodyComparisonFields = bodyMetricFields
  .map(([key]) => key)
  .filter((key) => !["weeklyAverageWeightKg", "sleepHours"].includes(key));

const recoveryOptions = {
  good: "Хорошее",
  normal: "Нормальное",
  weak: "Слабое",
};

const techniqueOptions = {
  good: "Техника хорошая",
  unstable: "Техника нестабильная",
  discomfort: "Дискомфорт",
  pain: "Боль",
};

const rirOptions = {
  "3plus": "3+",
  "2": "2",
  "1": "1",
  "0": "0",
};

bodyMetrics = loadBodyMetrics();
migrateWeeklyResults();

function weekStartFor(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const dayFromMonday = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - dayFromMonday);
  return value;
}

function getCurrentWeekInfo(offset = 0) {
  const monday = weekStartFor(new Date());
  monday.setDate(monday.getDate() - offset * 7);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const weekYear = thursday.getFullYear();
  const firstMonday = weekStartFor(new Date(weekYear, 0, 4));
  const weekNumber = Math.round((monday - firstMonday) / 604800000) + 1;
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    key: `${weekYear}-W${String(weekNumber).padStart(2, "0")}`,
    weekNumber,
    start: monday,
    end: sunday,
  };
}

function getWeekInfoFromKey(key) {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return currentWeek;
  const weekYear = Number(match[1]);
  const weekNumber = Number(match[2]);
  const firstMonday = weekStartFor(new Date(weekYear, 0, 4));
  const monday = new Date(firstMonday);
  monday.setDate(firstMonday.getDate() + (weekNumber - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    key,
    weekNumber,
    start: monday,
    end: sunday,
  };
}

function emptyProgress() {
  return {
    version: 4,
    days: {},
    exercises: {},
    feedback: {},
    fatigue: {},
    workingWeights: {},
    weightData: {},
    strength: {},
    effortRatings: {},
    sessionEffort: {},
    sessionOrder: {},
    currentPlanVersion: CURRENT_PLAN_VERSION,
    cardio: {},
  };
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function loadCurrentPlan() {
  const stored = loadJson(currentPlanStorageKey, null);
  const planState = createCurrentPlan(stored);
  if (!stored || stored.version !== planState.version) {
    planState.updatedAt = new Date().toISOString();
    localStorage.setItem(currentPlanStorageKey, JSON.stringify(planState));
  }
  return planState;
}

function persistCurrentPlan({ sync = true } = {}) {
  currentPlan.updatedAt = new Date().toISOString();
  localStorage.setItem(currentPlanStorageKey, JSON.stringify(currentPlan));
  if (sync) cloudSync?.markLocalChange(currentPlanStorageKey, currentPlan, currentPlan.updatedAt);
}

function savedForWeek(weekKey) {
  if (weekKey === currentWeek.key) return saved;
  const progress = loadJson(`workout-progress-${weekKey}`, emptyProgress());
  const notes = loadJson(`workout-notes-${weekKey}`, {});
  return {
    ...normalizeProgressV3(progress),
    notes,
  };
}

function loadSaved() {
  const progress = loadJson(progressStorageKey, null);
  const notes = loadJson(notesStorageKey, null);

  if (progress || notes) {
    return {
      ...normalizeProgressV3(progress || emptyProgress()),
      notes: notes || {},
    };
  }

  return {
    ...emptyProgress(),
    notes: {},
  };
}

function migrateFridayPoolCompletion() {
  const updatedAt = new Date().toISOString();

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!/^workout-progress-\d{4}-W\d{2}$/.test(key || "")) continue;

    const progress = key === progressStorageKey ? saved : loadJson(key, emptyProgress());
    progress.days = progress.days || {};
    progress.exercises = progress.exercises || {};
    if (progress.exercises[fridayPoolCompletionKey] !== undefined) continue;

    const legacyItemsComplete = legacyFridayPoolCompletionKeys.every(
      (itemKey) => progress.exercises[itemKey] === true,
    );
    if (!progress.days.fri && !legacyItemsComplete) continue;

    progress.exercises[fridayPoolCompletionKey] = true;
    progress.days.fri = true;
    progress.updatedAt = updatedAt;
    localStorage.setItem(key, JSON.stringify(progress));
  }
}

function loadExerciseResults() {
  const stored = loadJson(exerciseResultsStorageKey, null);
  const results = stored || {
    version: 2,
    exercises: {},
  };
  const seeded = applyBackupWorkout2Results(results);
  const migrated = migrateExerciseResultsV3(seeded.results);
  if (seeded.changed || migrated.changed) {
    localStorage.setItem(exerciseResultsStorageKey, JSON.stringify(migrated.results));
  }
  return migrated.results;
}

function migrateExerciseResultsV3(results) {
  if (results.migrations?.["structured-results-v3"]) return { changed: false, results };
  const migrated = {
    ...results,
    version: 3,
    exercises: { ...(results.exercises || {}) },
    migrations: { ...(results.migrations || {}), "structured-results-v3": true },
  };
  Object.entries(migrated.exercises).forEach(([exerciseId, exerciseResult]) => {
    const workingWeight = exerciseResult.workingWeight || "";
    const workingWeightData = exerciseResult.workingWeightData || normalizeWeightData(workingWeight);
    migrated.exercises[exerciseId] = {
      ...exerciseResult,
      archived: archivedExercises.some((item) => item.id === exerciseId) || Boolean(exerciseResult.archived),
      workingWeightData,
      history: (exerciseResult.history || []).map((entry) => ({
        ...entry,
        weightData: entry.weightData || normalizeWeightData(entry.weight || workingWeight),
      })),
    };
  });
  return { changed: true, results: migrated };
}

function applyBackupWorkout2Results(results) {
  const migrationKey = "backup-workout-weekly-2";
  if (results.migrations?.[migrationKey]) {
    return { changed: false, results };
  }

  const merged = {
    version: 2,
    ...results,
    exercises: { ...(results.exercises || {}) },
    migrations: {
      ...(results.migrations || {}),
      [migrationKey]: true,
    },
  };

  Object.entries(backupWorkout2Results).forEach(([exerciseId, [workingWeight, latestFeedback]]) => {
    const existing = merged.exercises[exerciseId] || {};
    merged.exercises[exerciseId] = {
      ...existing,
      workingWeight,
      latestFeedback: latestFeedback || existing.latestFeedback || "",
      history: existing.history || [],
    };
  });

  return { changed: true, results: merged };
}

function loadCardioResults() {
  // Kept only for backward compatibility with earlier exports/sync records.
  return loadJson(cardioResultsStorageKey, null) || {
    version: 1,
    sessions: [],
  };
}

function loadBodyMetrics() {
  const stored = loadJson(bodyMetricsStorageKey, null);
  if (stored?.entries?.length) {
    if (stored.version >= 2) return stored;
    const migrated = {
      ...stored,
      version: 2,
      duplicateDecisions: stored.duplicateDecisions || {},
      entries: stored.entries.map((entry) => ({
        ...entry,
        comments: entry.comments ?? entry.notes ?? "",
        recovery: entry.recovery || "normal",
      })),
    };
    localStorage.setItem(bodyMetricsStorageKey, JSON.stringify(migrated));
    return migrated;
  }
  return {
    version: 2,
    duplicateDecisions: {},
    entries: [
      {
        date: new Date().toISOString().slice(0, 10),
        ...bodyMetricDefaults,
        comments: "Стартовые значения",
        notes: "Стартовые значения",
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProgressV3(progress) {
  const next = { ...emptyProgress(), ...progress, version: 4 };
  if (progress.currentPlanVersion !== CURRENT_PLAN_VERSION) {
    next.workingWeights = {};
    next.weightData = {};
  }
  next.currentPlanVersion = CURRENT_PLAN_VERSION;
  next.effortRatings = { ...(progress.effortRatings || {}) };
  next.sessionEffort = { ...(progress.sessionEffort || {}) };
  next.sessionOrder = { ...(progress.sessionOrder || {}) };
  next.weightData = { ...(progress.weightData || {}) };
  Object.entries(progress.workingWeights || {}).forEach(([exerciseId, weight]) => {
    if (!next.weightData[exerciseId]) next.weightData[exerciseId] = normalizeWeightData(weight);
  });
  next.cardio = Object.fromEntries(
    Object.entries(progress.cardio || {}).map(([key, entry]) => [key, normalizeCardioEntry(entry)]),
  );
  return next;
}

function migrateWeeklyDataV3() {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!/^workout-progress-\d{4}-W\d{2}$/.test(key || "")) continue;
    const stored = loadJson(key, emptyProgress());
    if (stored.version >= 3) continue;
    const migrated = normalizeProgressV3(stored);
    if (key === progressStorageKey) replaceObject(saved, migrated);
    localStorage.setItem(key, JSON.stringify(migrated));
  }
}

function persistExerciseResults({ sync = true, touch = true } = {}) {
  if (touch) exerciseResults.updatedAt = new Date().toISOString();
  localStorage.setItem(exerciseResultsStorageKey, JSON.stringify(exerciseResults));
  if (sync) {
    cloudSync?.markLocalChange(
      exerciseResultsStorageKey,
      exerciseResults,
      exerciseResults.updatedAt || new Date().toISOString(),
    );
  }
}

function persistCardioResults({ sync = true, touch = true } = {}) {
  if (touch) cardioResults.updatedAt = new Date().toISOString();
  localStorage.setItem(cardioResultsStorageKey, JSON.stringify(cardioResults));
  if (sync) cloudSync?.markLocalChange(cardioResultsStorageKey, cardioResults, cardioResults.updatedAt || new Date().toISOString());
}

function persistBodyMetrics({ sync = true, touch = true } = {}) {
  if (touch) bodyMetrics.updatedAt = new Date().toISOString();
  localStorage.setItem(bodyMetricsStorageKey, JSON.stringify(bodyMetrics));
  if (sync) cloudSync?.markLocalChange(bodyMetricsStorageKey, bodyMetrics, bodyMetrics.updatedAt || new Date().toISOString());
}

function exerciseById(exerciseId) {
  return workouts.flatMap((day) => day.exercises).find((exercise) => exercise.id === exerciseId);
}

function dayForExercise(exerciseId) {
  return workouts.find((day) => day.exercises.some((exercise) => exercise.id === exerciseId));
}

function resultForExercise(exerciseId) {
  if (!exerciseResults.exercises[exerciseId]) {
    exerciseResults.exercises[exerciseId] = {
      workingWeight: weightText(exerciseById(exerciseId)?.weight),
      history: [],
    };
  }
  return exerciseResults.exercises[exerciseId];
}

function resultDateForWeek(weekKey, progress) {
  if (progress.updatedAt) return progress.updatedAt;
  const week = getWeekInfoFromKey(weekKey);
  const date = new Date(week.end);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function migrateWeeklyResults() {
  let changed = false;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    const match = /^workout-progress-(\d{4}-W\d{2})$/.exec(key || "");
    if (!match) continue;
    const weekKey = match[1];
    const progress = loadJson(key, emptyProgress());
    Object.entries(progress.feedback || {}).forEach(([exerciseId, feedback]) => {
      if (!exerciseById(exerciseId)) return;
      const result = resultForExercise(exerciseId);
      if (result.history.some((entry) => entry.weekKey === weekKey)) return;
      const weight = progress.workingWeights?.[exerciseId] || weightText(exerciseById(exerciseId).weight);
      result.history.push({
        date: resultDateForWeek(weekKey, progress),
        weekKey,
        dayId: dayForExercise(exerciseId)?.id || "",
        weight,
        feedback,
      });
      result.workingWeight = weight;
      changed = true;
    });
  }

  if (changed) {
    Object.values(exerciseResults.exercises).forEach((result) => {
      result.history.sort((a, b) => new Date(a.date) - new Date(b.date));
      const latest = result.history[result.history.length - 1];
      if (latest) {
        result.workingWeight = latest.weight;
        result.latestFeedback = latest.feedback;
      }
    });
    persistExerciseResults();
  }
}

function persist({ sync = true, touch = true } = {}) {
  const updatedAt = touch ? new Date().toISOString() : (saved.updatedAt || new Date().toISOString());
  saved.updatedAt = updatedAt;
  const progressPayload = {
    version: 4,
    days: saved.days,
    exercises: saved.exercises,
    feedback: saved.feedback || {},
    fatigue: saved.fatigue || {},
    workingWeights: saved.workingWeights || {},
    weightData: saved.weightData || {},
    strength: saved.strength || {},
    effortRatings: saved.effortRatings || {},
    sessionEffort: saved.sessionEffort || {},
    sessionOrder: saved.sessionOrder || {},
    currentPlanVersion: CURRENT_PLAN_VERSION,
    cardio: saved.cardio || {},
    updatedAt,
  };
  const notesPayload = saved.notes || {};
  localStorage.setItem(progressStorageKey, JSON.stringify(progressPayload));
  localStorage.setItem(notesStorageKey, JSON.stringify(notesPayload));
  if (sync) {
    cloudSync?.markLocalChange(progressStorageKey, progressPayload, updatedAt);
  }
}

function persistNotes() {
  const notesPayload = saved.notes || {};
  const updatedAt = new Date().toISOString();
  localStorage.setItem(notesStorageKey, JSON.stringify(notesPayload));
  cloudSync?.markLocalChange(notesStorageKey, notesPayload, updatedAt);
}

function dateMs(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isWorkoutDataKey(key) {
  return key.startsWith("workout-") && !key.startsWith("workout-sync-");
}

function storagePayload(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function latestExerciseHistoryDate(payload) {
  if (!payload || typeof payload !== "object") return "";
  return Object.values(payload.exercises || {})
    .flatMap((exercise) => exercise.history || [])
    .map((entry) => entry.date)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function inferredStorageUpdatedAt(key, payload) {
  const syncMeta = loadJson(syncMetaStorageKey, {});
  if (syncMeta[key]) return syncMeta[key];
  if (payload && typeof payload === "object" && payload.updatedAt) return payload.updatedAt;
  if (key === exerciseResultsStorageKey) return latestExerciseHistoryDate(payload);
  if (key === cardioResultsStorageKey) {
    return payload?.sessions?.map((entry) => entry.updatedAt || entry.date).filter(Boolean).sort().at(-1) || "";
  }
  if (key === bodyMetricsStorageKey) {
    return payload?.entries?.map((entry) => entry.updatedAt || entry.date).filter(Boolean).sort().at(-1) || "";
  }
  if (key.startsWith("workout-notes-")) {
    const pairedProgress = storagePayload(key.replace("workout-notes-", "workout-progress-"));
    if (pairedProgress?.updatedAt) return pairedProgress.updatedAt;
  }
  return "";
}

function workoutBackupRecords() {
  const records = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isWorkoutDataKey(key)) continue;
    const payload = storagePayload(key);
    records.push({
      key,
      payload,
      updatedAt: inferredStorageUpdatedAt(key, payload) || new Date().toISOString(),
    });
  }
  return records.sort((left, right) => left.key.localeCompare(right.key));
}

function createWorkoutBackup() {
  return {
    app: "workout-weekly-web-app",
    version: 4,
    exportedAt: new Date().toISOString(),
    records: workoutBackupRecords(),
  };
}

function normalizeBackupRecords(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const records = Array.isArray(parsed?.records)
    ? parsed.records
    : Object.entries(parsed?.data || parsed || {}).map(([key, payload]) => ({ key, payload }));
  const normalized = records
    .filter((record) => record && typeof record.key === "string" && isWorkoutDataKey(record.key))
    .map((record) => ({
      key: record.key,
      payload: record.payload,
      updatedAt: record.updatedAt || record.client_updated_at || inferredStorageUpdatedAt(record.key, record.payload) || new Date().toISOString(),
    }))
    .filter((record) => record.payload !== undefined);
  if (!normalized.length) {
    throw new Error("В JSON не найдены данные методички для импорта.");
  }
  return normalized;
}

function importWorkoutBackup(records) {
  const syncMeta = loadJson(syncMetaStorageKey, {});
  const updatedKeys = [];
  let skipped = 0;

  records.forEach((record) => {
    const currentPayload = storagePayload(record.key);
    const currentUpdatedAt = inferredStorageUpdatedAt(record.key, currentPayload);
    if (currentPayload !== null && dateMs(currentUpdatedAt) > dateMs(record.updatedAt)) {
      skipped += 1;
      return;
    }
    localStorage.setItem(record.key, JSON.stringify(record.payload));
    syncMeta[record.key] = record.updatedAt;
    updatedKeys.push(record.key);
    cloudSync?.markLocalChange(record.key, record.payload, record.updatedAt);
  });

  localStorage.setItem(syncMetaStorageKey, JSON.stringify(syncMeta));
  if (updatedKeys.length) applyRemoteData(updatedKeys);
  return { updated: updatedKeys.length, skipped };
}

function replaceObject(target, source) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, source);
}

function applyRemoteData(keys) {
  const affectsCurrentProgress = keys.includes(progressStorageKey);
  const affectsCurrentNotes = keys.includes(notesStorageKey);
  const affectsResults = keys.includes(exerciseResultsStorageKey);
  const affectsPlan = keys.includes(currentPlanStorageKey);
  const affectsCardio = keys.includes(cardioResultsStorageKey);
  const affectsBody = keys.includes(bodyMetricsStorageKey);
  const affectsReview = keys.includes(dataReviewStorageKey);
  if (!affectsCurrentProgress && !affectsCurrentNotes && !affectsResults && !affectsPlan && !affectsCardio && !affectsBody && !affectsReview) {
    renderHistory();
    renderWeeklyReport();
    return;
  }

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const focusedElement = document.activeElement;
  if (affectsCurrentProgress || affectsCurrentNotes) replaceObject(saved, loadSaved());
  if (affectsResults) replaceObject(exerciseResults, loadExerciseResults());
  if (affectsPlan) replaceObject(currentPlan, loadCurrentPlan());
  if (affectsCardio) replaceObject(cardioResults, loadCardioResults());
  if (affectsBody) replaceObject(bodyMetrics, loadBodyMetrics());
  if (affectsReview) replaceObject(dataReviewState, loadJson(dataReviewStorageKey, { dismissed: {}, updatedAt: "" }));
  syncAllDayCompletion();
  render();
  requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, left: scrollX, behavior: "auto" });
    focusedElement?.focus?.({ preventScroll: true });
  });
}

function todayWorkoutId() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

function normalize(value) {
  return String(value).toLowerCase().replaceAll("ё", "е");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function assetPath(path) {
  return `${baseUrl}${path.replace(/^\/+/, "")}`;
}

function completionItems(day) {
  const routineItems = (day.sections || []).flatMap((section) =>
    section.items.map((item, index) => ({
      key: `${section.id}:${index}`,
      group: item.section || section.group || "main",
    })),
  );
  const exerciseItems = day.exercises.map((exercise) => ({
    key: exercise.id,
    group: exercise.section || "main",
  }));
  return [...routineItems, ...exerciseItems];
}

function isDayComplete(day) {
  const items = completionItems(day);
  return items.length > 0 && items.every((item) => saved.exercises[item.key]);
}

function syncDayCompletion(day) {
  const complete = isDayComplete(day);
  const changed = Boolean(saved.days[day.id]) !== complete;
  saved.days[day.id] = complete;
  return changed;
}

function syncAllDayCompletion() {
  workouts.forEach(syncDayCompletion);
}

function progressForDay(day) {
  const groups = Object.fromEntries(
    Object.entries(groupLabels).map(([key, label]) => [key, { key, label, done: 0, total: 0 }]),
  );
  const items = completionItems(day);

  items.forEach((item) => {
    const group = groups[item.group] || groups.main;
    group.total += 1;
    if (saved.exercises[item.key]) group.done += 1;
  });

  const done = items.filter((item) => saved.exercises[item.key]).length;
  return {
    done,
    total: items.length,
    groups: Object.values(groups),
  };
}

function statsForSaved(source) {
  const progress = {
    daysDone: 0,
    daysTotal: workouts.length,
    done: 0,
    total: 0,
  };

  workouts.forEach((day) => {
    if (source.days?.[day.id]) progress.daysDone += 1;
    completionItems(day).forEach((item) => {
      progress.total += 1;
      if (source.exercises?.[item.key]) progress.done += 1;
    });
  });

  return progress;
}

function feedbackStatsForSaved(source) {
  const counts = Object.fromEntries(Object.keys(effortReportLabels).map((value) => [value, 0]));
  const easy = [];
  const normalLight = [];
  const normalHard = [];
  const hard = [];
  const feedback = source.feedback || {};

  workouts.forEach((day) => {
    day.exercises.forEach((exercise) => {
      const value = feedback[exercise.id];
      if (!value || !counts.hasOwnProperty(value)) return;
      counts[value] += 1;
      if (value === "easy") easy.push(exercise.title);
      if (value === "normal-light") normalLight.push(exercise.title);
      if (value === "normal-hard") normalHard.push(exercise.title);
      if (value === "hard") hard.push(exercise.title);
    });
  });

  return { counts, easy, normalLight, normalHard, hard };
}

function weightText(weight) {
  if (!weight || typeof weight !== "object") return weight || "не указан";
  return weight.start || "уточнить";
}

function targetFromSets(value) {
  const text = String(value || "");
  const timeUnit = /сек/i.test(text) ? "сек" : /мин/i.test(text) ? "мин" : "";
  const match = /(\d+)(?:\s*[-–]\s*(\d+))?\s*[x×х]\s*([\d,.]+(?:\s*[-–]\s*[\d,.]+)?|[^\s]+)/i.exec(text);
  if (!match) {
    const timeMatch = /(\d+)\s*(сек|мин)/i.exec(text);
    return {
      targetSets: timeMatch ? 1 : 3,
      targetReps: timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : "12",
      minReps: timeMatch ? Number(timeMatch[1]) : 12,
      maxReps: timeMatch ? Number(timeMatch[1]) : 12,
      unit: timeMatch?.[2] || "повт.",
    };
  }
  const repsText = match[3].replace(",", ".").replace(/\s+/g, "");
  const numbers = repsText.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return {
    targetSets: Number(match[2] || match[1]) || 3,
    targetReps: `${repsText}${timeUnit ? ` ${timeUnit}` : ""}`,
    minReps: numbers[0] || 12,
    maxReps: numbers.at(-1) || numbers[0] || 12,
    unit: timeUnit || "повт.",
  };
}

function strengthForExercise(exercise) {
  const planEntry = currentPlan.exercises?.[exercise?.id];
  const target = planEntry
    ? targetFromSets(`${planEntry.targetSets} x ${planEntry.targetReps}`)
    : targetFromSets(exercise?.sets);
  const stored = saved.strength?.[exercise.id] || {};
  const setResults = setResultsFrom(stored.setResults);
  return {
    targetSets: planEntry?.targetSets || stored.targetSets || target.targetSets,
    targetReps: planEntry?.targetReps || stored.targetReps || target.targetReps,
    actualSets: stored.actualSets || "",
    actualReps: stored.actualReps || "",
    setResults,
    rir: stored.rir || "",
    techniqueStatus: stored.techniqueStatus || "",
    minReps: target.minReps,
    maxReps: target.maxReps,
    unit: target.unit,
  };
}

function performanceText(entry) {
  return performanceTextFrom(entry);
}

function weightForSource(exercise, source, usePersistentFallback = false) {
  return source.workingWeights?.[exercise.id]
    || (usePersistentFallback ? resultForExercise(exercise.id).workingWeight : "")
    || weightText(exercise.weight);
}

function mainExerciseEntries(source, usePersistentFallback = false) {
  return workouts.flatMap((day) =>
    day.exercises.map((exercise) => ({
      day,
      exercise,
      weight: weightForSource(exercise, source, usePersistentFallback),
      feedback: source.feedback?.[exercise.id] || "",
      strength: source.strength?.[exercise.id] || {},
      done: Boolean(source.exercises?.[exercise.id]),
    })),
  );
}

function availableWeekInfos() {
  const keys = new Set([currentWeek.key]);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    const match = /^workout-progress-(\d{4}-W\d{2})$/.exec(key || "");
    if (match) keys.add(match[1]);
  }
  return [...keys]
    .map(getWeekInfoFromKey)
    .sort((a, b) => b.start - a.start);
}

function dayStatus(day, source) {
  if (source.days?.[day.id]) return "выполнено";
  const progress = progressForDayFromSource(day, source);
  if (progress.done > 0) return "начато";
  return "не выполнено";
}

function progressForDayFromSource(day, source) {
  const items = completionItems(day);
  const done = items.filter((item) => source.exercises?.[item.key]).length;
  return {
    done,
    total: items.length,
  };
}

function reportModel(weekKey) {
  const week = getWeekInfoFromKey(weekKey);
  const source = savedForWeek(week.key);
  const stats = statsForSaved(source);
  const entries = mainExerciseEntries(source, week.key === currentWeek.key);
  const grouped = {
    easy: entries.filter((entry) => entry.feedback === "easy"),
    normalLight: entries.filter((entry) => entry.feedback === "normal-light"),
    normal: entries.filter((entry) => entry.feedback === "normal"),
    normalHard: entries.filter((entry) => entry.feedback === "normal-hard"),
    hard: entries.filter((entry) => entry.feedback === "hard"),
    unrated: entries.filter((entry) => !entry.feedback),
  };
  const hasData = hasStoredProgress(source);

  return {
    week,
    source,
    stats,
    entries,
    grouped,
    hasData,
    progressPercent: percent(stats.done, stats.total),
  };
}

function percent(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

function statusLabel(done, total) {
  if (!total || done === 0) return "Не начато";
  if (done === total) return "Готово";
  return "В процессе";
}

function progressMarkup(day, compact = false) {
  const progress = progressForDay(day);
  const totalPercent = percent(progress.done, progress.total);
  return `
    <div class="progress-total">
      <span>${compact ? "Прогресс" : "Общий прогресс"}</span>
      <strong>${progress.done}/${progress.total}</strong>
    </div>
    <div class="progress-bar" aria-hidden="true"><span style="width: ${totalPercent}%"></span></div>
    <div class="progress-segments">
      ${progress.groups.map((group) => {
        const groupPercent = percent(group.done, group.total);
        return `
          <div class="progress-segment is-${groupPercent === 0 ? "empty" : groupPercent === 100 ? "done" : "active"}">
            <div>
              <span>${group.label}</span>
              <strong>${group.done}/${group.total}</strong>
            </div>
            <div class="progress-bar" aria-hidden="true"><span style="width: ${groupPercent}%"></span></div>
            <small>${groupPercent}% · ${statusLabel(group.done, group.total)}</small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function formatHistoryDate(date) {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function hasStoredProgress(source) {
  return Boolean(
    Object.values(source.days || {}).some(Boolean) ||
      Object.values(source.exercises || {}).some(Boolean) ||
      Object.values(source.feedback || {}).some(Boolean) ||
      Object.values(source.fatigue || {}).some(Boolean) ||
      Object.values(source.workingWeights || {}).some(Boolean) ||
      Object.values(source.strength || {}).some(Boolean) ||
      Object.values(source.cardio || {}).some((entry) => Object.values(entry || {}).some(Boolean)),
  );
}

function normalizedStoredSessionEffort(value) {
  if (!value || typeof value !== "object") return null;
  // Итоги прежней версии могли содержать ручной sessionEffortFinal без данных
  // о выполненных упражнениях. Не выдаём их за новый автоматический расчёт.
  if (!("completedExercises" in value)) return null;
  const exact = parseLocaleNumber(value.exact ?? value.sessionEffortCalculatedExact ?? value.sessionEffortCalculated);
  if (exact === null) return null;
  return {
    exact,
    rounded: Number(value.rounded ?? Math.round(exact)),
    ratedExercises: Number(value.ratedExercises || 0),
    completedExercises: Number(value.completedExercises || value.totalExercises || 0),
    completedSets: Number(value.completedSets || value.completedWorkingSets || 0),
    complete: Boolean(value.complete),
    updatedAt: value.updatedAt || "",
  };
}

function sessionEffortHistoryMarkup(source) {
  const entries = workouts
    .map((day) => ({ day, effort: normalizedStoredSessionEffort(source.sessionEffort?.[day.id]) }))
    .filter((entry) => entry.effort);
  if (!entries.length) return "";
  return `<div class="history-session-efforts">${entries.map(({ day, effort }) => `
    <div>
      <time>${effort.updatedAt ? new Date(effort.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : day.day}</time>
      <span>${day.day}</span>
      <strong>${effort.rounded} — ${effortCategory(effort.rounded)}</strong>
      <small>Среднее: ${formatNumber(Math.round(effort.exact * 10) / 10)} · ${effort.completedExercises} упр. · ${effort.completedSets} подх.</small>
    </div>
  `).join("")}</div>`;
}

function renderHistory() {
  if (!els.historyList) return;

  const weeks = Array.from({ length: 8 }, (_, index) => getCurrentWeekInfo(index));
  const rows = weeks.map((week) => {
    const progress = loadJson(`workout-progress-${week.key}`, emptyProgress());
    const isCurrent = week.key === currentWeek.key;
    const source = isCurrent ? saved : progress;
    const stats = statsForSaved(source);
    const hasData = hasStoredProgress(source);
    return {
      week,
      stats,
      hasData,
      hasProgress: isCurrent || hasStoredProgress(source),
      totalPercent: percent(stats.done, stats.total),
    };
  });

  if (!rows.some((row) => row.hasData)) {
    els.historyList.innerHTML = `<p class="history-empty">История появится после первой завершённой недели.</p>`;
    return;
  }

  els.historyList.innerHTML = rows
    .filter((row) => row.hasProgress)
    .map((row) => `
      <article class="history-week ${row.week.key === currentWeek.key ? "is-current" : ""}">
        <div>
          <strong>${row.week.key === currentWeek.key ? "Эта неделя" : `Неделя ${row.week.weekNumber}`}</strong>
          <span>${formatHistoryDate(row.week.start)}-${formatHistoryDate(row.week.end)}</span>
        </div>
        <div class="history-week__stats">
          <span>${row.stats.daysDone}/${row.stats.daysTotal} дней</span>
          <strong>${row.totalPercent}%</strong>
        </div>
        <div class="progress-bar" aria-hidden="true"><span style="width: ${row.totalPercent}%"></span></div>
        ${sessionEffortHistoryMarkup(row.week.key === currentWeek.key ? saved : loadJson(`workout-progress-${row.week.key}`, emptyProgress()))}
      </article>
    `)
    .join("");
}

function listMarkup(items, emptyText) {
  if (!items.length) return `<p>${emptyText}</p>`;
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function repeatedFeedback(kind) {
  const previousWeek = getCurrentWeekInfo(1);
  const previous = loadJson(`workout-progress-${previousWeek.key}`, emptyProgress());
  return workouts.flatMap((day) =>
    day.exercises
      .filter((exercise) => saved.feedback?.[exercise.id] === kind && previous.feedback?.[exercise.id] === kind)
      .map((exercise) => exercise.title),
  );
}

function hasConsecutiveFeedback(exerciseId, feedback) {
  const history = [...(resultForExercise(exerciseId).history || [])]
    .filter((entry) => entry.feedback)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return history.length >= 2 && history[0].feedback === feedback && history[1].feedback === feedback;
}

function feedbackHitUpperReps(entry) {
  const target = targetFromSets(entry.exercise?.sets);
  const strength = entry.strength || {};
  const setResults = setResultsFrom(strength.setResults || resultForExercise(entry.exercise.id).history.at(-1)?.setResults);
  if (setResults.length) return setResults.length >= target.targetSets && setResults.every((item) => Number(item.reps) >= Number(target.maxReps || 0));
  const reps = parseLocaleNumber(strength.actualReps || resultForExercise(entry.exercise.id).history.at(-1)?.actualReps);
  return reps !== null && reps >= Number(target.maxReps || 0);
}

function resultHitUpperReps(result, exercise) {
  const target = targetFromSets(exercise?.sets);
  const setResults = setResultsFrom(result?.setResults || (Array.isArray(result?.actualSets) ? result.actualSets : []));
  if (setResults.length) {
    return setResults.length >= target.targetSets
      && setResults.every((item) => Number(item.reps) >= Number(target.maxReps || 0));
  }
  const actualSets = parseLocaleNumber(result?.actualSets);
  const actualReps = parseLocaleNumber(result?.actualReps);
  return actualSets !== null
    && actualSets >= target.targetSets
    && actualReps !== null
    && actualReps >= target.maxReps;
}

function isLightCoreDay(day) {
  return day?.id === "thu";
}

function reportEntryLine(entry) {
  return `${entry.day.day} · ${entry.exercise.title} · ${entry.weight}`;
}

function recommendationFor(entry) {
  const techniqueStatus = entry.strength?.techniqueStatus || "";
  const rir = entry.strength?.rir || "";
  if (techniqueStatus === "pain") {
    return `${entry.exercise.title} — ${entry.weight} → отмечена боль: вес не повышать и разобраться с причиной`;
  }
  if (techniqueStatus === "unstable" || techniqueStatus === "discomfort") {
    return `${entry.exercise.title} — ${entry.weight} → сначала вернуть стабильную технику и движение без дискомфорта`;
  }
  if (isLightCoreDay(entry.day)) {
    if (entry.feedback === "hard" || entry.feedback === "normal-hard") {
      return `${entry.exercise.title} — ${entry.weight} → для четверга тяжеловато: лучше оставить легче, без добивания перед йогой`;
    }
    return `${entry.exercise.title} — ${entry.weight} → для четверга нагрузка ок, цель — лёгкая активация и контроль`;
  }
  if (rir === "0") {
    return `${entry.exercise.title} — ${entry.weight} → RIR 0: вес не повышать; проверить повторы и технику`;
  }
  if (rir === "1") {
    return `${entry.exercise.title} — ${entry.weight} → RIR 1: оставить нагрузку и закрепить технику`;
  }
  if (entry.feedback === "easy") {
    return `${entry.exercise.title} — ${entry.weight} → легко, можно немного увеличить вес, если техника чистая`;
  }
  if (entry.feedback === "normal-light") {
    const repeated = hasConsecutiveFeedback(entry.exercise.id, "normal-light");
    return repeated && feedbackHitUpperReps(entry)
      ? `${entry.exercise.title} — ${entry.weight} → норма ближе к легко второй раз подряд, можно чуть повысить вес`
      : `${entry.exercise.title} — ${entry.weight} → норма ближе к легко; если так повторится ещё раз и верх повторов выполнен, можно чуть повысить`;
  }
  if (entry.feedback === "normal") {
    return `${entry.exercise.title} — ${entry.weight} → рабочий вес подходит, оставить и закреплять технику`;
  }
  if (entry.feedback === "normal-hard") {
    const repeated = hasConsecutiveFeedback(entry.exercise.id, "normal-hard");
    return repeated && feedbackHitUpperReps(entry)
      ? `${entry.exercise.title} — ${entry.weight} → хорошая нагрузка для роста; можно попробовать минимальное повышение без потери техники`
      : `${entry.exercise.title} — ${entry.weight} → хорошая нагрузка для роста, вес пока оставить и следить за техникой`;
  }
  if (entry.feedback === "hard") {
    return `${entry.exercise.title} — ${entry.weight} → тяжело, вес не повышать; если техника ломалась или повторы не добраны, снизить или оставить до адаптации`;
  }
  return "";
}

function reportList(items, emptyText, mapper = reportEntryLine) {
  if (!items.length) return `<p class="weekly-report__empty">${emptyText}</p>`;
  return `<ul>${items.map((item) => `<li>${mapper(item)}</li>`).join("")}</ul>`;
}

function reportConclusions(model) {
  const lines = [];
  const { easy, normalLight, normal, normalHard, hard } = model.grouped;
  const strongFatigueDays = Object.entries(model.source.fatigue || {})
    .filter(([, value]) => value === "strong")
    .map(([dayId]) => workouts.find((day) => day.id === dayId)?.day)
    .filter(Boolean);

  if (!model.hasData) {
    return ["На этой неделе пока нет отмеченных упражнений."];
  }
  const ratedCount = easy.length + normalLight.length + normal.length + normalHard.length + hard.length;
  if (!ratedCount) {
    lines.push("Результаты уже внесены, но оценка нагрузки по упражнениям пока не отмечена.");
  }
  if ((normal.length + normalHard.length) > 0 && (normal.length + normalHard.length) >= easy.length && (normal.length + normalHard.length) >= hard.length) {
    lines.push("Большая часть весов подобрана нормально, базовые веса можно оставить.");
  }
  if (normalHard.length) {
    lines.push("Для роста мышц главный ориентир — «Норма ближе к тяжело»: последние повторы ощутимые, но техника чистая.");
  }
  if (easy.length || normalLight.length) {
    lines.push("Упражнения с отметками «Легко» и «Норма ближе к легко» можно рассматривать для аккуратного повышения, если техника была чистой.");
  }
  if (hard.length) {
    lines.push("Упражнения с отметкой «Тяжело» лучше не повышать: проверить технику, повторы и восстановление.");
  }
  if (strongFatigueDays.length) {
    lines.push(`В дни с сильной усталостью (${strongFatigueDays.join(", ")}) веса лучше не повышать, даже если отдельные упражнения были лёгкими.`);
  }
  workouts.forEach((day) => {
    const dayEasy = easy.filter((entry) => entry.day.id === day.id).length + normalLight.filter((entry) => entry.day.id === day.id).length;
    const dayHard = hard.filter((entry) => entry.day.id === day.id).length;
    const dayFatigue = model.source.fatigue?.[day.id];
    if (!isLightCoreDay(day) && dayEasy >= 3 && dayFatigue === "light") {
      lines.push(`${day.day}: много лёгких упражнений и лёгкая усталость — нагрузку можно аккуратно повышать.`);
    }
    if (isLightCoreDay(day)) {
      lines.push(`${day.day}: цель — «Норма» или «Норма ближе к легко», без повышения нагрузки перед вечерней йогой.`);
    }
    if (dayHard >= 3) {
      lines.push(`${day.day}: много тяжёлых упражнений — нагрузку лучше не повышать, проверить технику и восстановление.`);
    }
  });
  lines.push("Веса автоматически не менялись.");
  return [...new Set(lines)];
}

function weeklyReportText(model) {
  const lines = [
    `Итоги недели: ${model.week.key}`,
    `Период: ${formatHistoryDate(model.week.start)}-${formatHistoryDate(model.week.end)}`,
    "",
    "Общий прогресс:",
    `— Выполнено дней: ${model.stats.daysDone} из ${model.stats.daysTotal}`,
    `— Выполнено пунктов: ${model.stats.done} из ${model.stats.total}`,
    `— Общий прогресс: ${model.progressPercent}%`,
  ];

  workouts.forEach((day) => {
    const dayEntries = day.exercises;
    if (!dayEntries.length) return;
    lines.push("", `${day.day} — ${day.title}`, `Статус: ${dayStatus(day, model.source)}`);
    const sessionEffort = normalizedStoredSessionEffort(model.source.sessionEffort?.[day.id]);
    lines.push(`Итоговое усилие: ${sessionEffort ? `${sessionEffort.rounded} — ${effortCategory(sessionEffort.rounded)} (среднее ${formatNumber(Math.round(sessionEffort.exact * 10) / 10)})` : "недостаточно данных"}`);
    lines.push("", "Основная часть:");
    dayEntries.forEach((exercise) => {
      const entry = model.entries.find((item) => item.exercise.id === exercise.id);
      const strength = model.source.strength?.[exercise.id] || {};
      const performance = performanceText(strength);
      const technique = techniqueOptions[strength.techniqueStatus] || "";
      lines.push(`— ${exercise.title} — ${entry?.weight || weightText(exercise.weight)}${performance ? ` — ${performance}` : ""}${strength.rir ? ` — RIR ${rirOptions[strength.rir] || strength.rir}` : ""}${technique ? ` — ${technique.toLowerCase()}` : ""} — ${effortReportLabels[model.source.feedback?.[exercise.id]] || "не отмечено"}`);
    });
  });

  lines.push(
    "",
    "Сводка по нагрузке:",
    `— Легко: ${model.grouped.easy.length}`,
    `— Норма ближе к легко: ${model.grouped.normalLight.length}`,
    `— Норма: ${model.grouped.normal.length}`,
    `— Норма ближе к тяжело: ${model.grouped.normalHard.length}`,
    `— Тяжело: ${model.grouped.hard.length}`,
    `— Не отмечено: ${model.grouped.unrated.length}`,
    "",
    "Предварительные выводы:",
    ...reportConclusions(model).map((line) => `— ${line}`),
    "",
    "Кандидаты на повышение:",
    ...(
      model.grouped.easy.length || model.grouped.normalLight.length
        ? [...model.grouped.easy, ...model.grouped.normalLight].map((entry) => `— ${recommendationFor(entry)}`)
        : ["— нет"]
    ),
    "",
    "Оставить / закрепить:",
    ...(
      model.grouped.normal.length || model.grouped.normalHard.length
        ? [...model.grouped.normal, ...model.grouped.normalHard].map((entry) => `— ${recommendationFor(entry)}`)
        : ["— нет"]
    ),
    "",
    "Проверить / возможно снизить:",
    ...(model.grouped.hard.length ? model.grouped.hard.map((entry) => `— ${recommendationFor(entry)}`) : ["— нет"]),
  );

  return lines.join("\n");
}

function renderLoadSummary() {
  if (!els.loadSummary) return;
  const wasOpen = els.loadSummary.querySelector("details")?.open;
  const feedback = feedbackStatsForSaved(saved);
  const repeatedEasy = repeatedFeedback("easy");
  const repeatedNormalLight = repeatedFeedback("normal-light");
  const repeatedHard = repeatedFeedback("hard");

  els.loadSummary.innerHTML = `
    <details ${wasOpen ? "open" : ""}>
      <summary>
        <span>
          <strong>Итоги нагрузки за неделю</strong>
          <small>Собираем ощущения по весам, ничего не меняем автоматически</small>
        </span>
      </summary>
      <div class="load-summary">
        <div class="load-summary__stats">
          <span class="is-easy">Легко: <strong>${feedback.counts.easy}</strong></span>
          <span class="is-normal-light">Норма ближе к легко: <strong>${feedback.counts["normal-light"]}</strong></span>
          <span class="is-normal">Норма: <strong>${feedback.counts.normal}</strong></span>
          <span class="is-normal-hard">Норма ближе к тяжело: <strong>${feedback.counts["normal-hard"]}</strong></span>
          <span class="is-hard">Тяжело: <strong>${feedback.counts.hard}</strong></span>
        </div>
        <div class="load-summary__grid">
          <article>
            <h3>Возможное повышение веса</h3>
            ${listMarkup([...feedback.easy, ...feedback.normalLight], "Пока нет упражнений с лёгкой стороной нормы.")}
          </article>
          <article>
            <h3>Проверить нагрузку</h3>
            ${listMarkup([...feedback.normalHard, ...feedback.hard], "Пока нет упражнений с тяжёлой стороной нормы.")}
          </article>
          <article>
            <h3>Повторяется 2 недели</h3>
            ${listMarkup(
              [
                ...repeatedEasy.map((item) => `${item} — легко 2 недели подряд`),
                ...repeatedNormalLight.map((item) => `${item} — норма ближе к легко 2 недели подряд`),
                ...repeatedHard.map((item) => `${item} — тяжело 2 недели подряд`),
              ],
              "Повторов за 2 недели пока нет.",
            )}
          </article>
        </div>
        <p class="load-summary__note">
          Вес не меняется автоматически. Сначала собираем ощущения за неделю, потом корректируем стартовые веса.
        </p>
      </div>
    </details>
  `;
}

function renderWeeklyReport() {
  if (!els.weeklyReport) return;
  if (!state.reportWeekKey) state.reportWeekKey = currentWeek.key;
  const weeks = availableWeekInfos();
  const model = reportModel(state.reportWeekKey);
  const reportText = weeklyReportText(model);

  els.weeklyReport.innerHTML = `
    <div class="weekly-report__header">
      <div>
        <p class="eyebrow">Отчёт</p>
        <h2>Итоги недели</h2>
        <p>Неделя ${model.week.weekNumber} · ${formatHistoryDate(model.week.start)}-${formatHistoryDate(model.week.end)}</p>
      </div>
      <label class="week-select">
        <span>Неделя</span>
        <select id="reportWeekSelect">
          ${weeks.map((week) => `
            <option value="${week.key}" ${week.key === model.week.key ? "selected" : ""}>
              ${week.key} · ${formatHistoryDate(week.start)}-${formatHistoryDate(week.end)}
            </option>
          `).join("")}
        </select>
      </label>
    </div>

    <div class="weekly-report__actions">
      <button class="report-copy" id="copyWeeklyReport" type="button">Скопировать итоги недели</button>
      <button class="report-toggle" id="toggleReportText" type="button">
        ${state.showReportText ? "Скрыть текст отчёта" : "Показать текст отчёта"}
      </button>
      <span class="copy-status" id="copyStatus" role="status"></span>
    </div>

    ${model.hasData ? `
      <div class="weekly-report__progress">
        <article><span>Выполнено дней</span><strong>${model.stats.daysDone}/${model.stats.daysTotal}</strong></article>
        <article><span>Выполнено пунктов</span><strong>${model.stats.done}/${model.stats.total}</strong></article>
        <article><span>Общий прогресс</span><strong>${model.progressPercent}%</strong></article>
      </div>

      <section class="weekly-report__section">
        <h3>Нагрузка по упражнениям</h3>
        <div class="weekly-report__stats">
          <span class="is-easy">Легко: <strong>${model.grouped.easy.length}</strong></span>
          <span class="is-normal-light">Норма ближе к легко: <strong>${model.grouped.normalLight.length}</strong></span>
          <span class="is-normal">Норма: <strong>${model.grouped.normal.length}</strong></span>
          <span class="is-normal-hard">Норма ближе к тяжело: <strong>${model.grouped.normalHard.length}</strong></span>
          <span class="is-hard">Тяжело: <strong>${model.grouped.hard.length}</strong></span>
          <span>Не отмечено: <strong>${model.grouped.unrated.length}</strong></span>
        </div>
        <div class="weekly-report__lists">
          <article>
            <h4>Легко</h4>
            ${reportList(model.grouped.easy, "Пока нет лёгких упражнений.")}
          </article>
          <article>
            <h4>Норма ближе к легко</h4>
            ${reportList(model.grouped.normalLight, "Пока нет упражнений ближе к легко.")}
          </article>
          <article>
            <h4>Норма</h4>
            ${reportList(model.grouped.normal, "Пока нет упражнений с нормой.")}
          </article>
          <article>
            <h4>Норма ближе к тяжело</h4>
            ${reportList(model.grouped.normalHard, "Пока нет упражнений ближе к тяжело.")}
          </article>
          <article>
            <h4>Тяжело</h4>
            ${reportList(model.grouped.hard, "Пока нет тяжёлых упражнений.")}
          </article>
        </div>
      </section>

      <section class="weekly-report__section">
        <h3>Предварительные выводы</h3>
        <ul>${reportConclusions(model).map((line) => `<li>${line}</li>`).join("")}</ul>
      </section>

      <section class="weekly-report__section">
        <h3>Рекомендации по весам</h3>
        <div class="weekly-report__lists">
          <article>
            <h4>Кандидаты на повышение</h4>
            ${reportList([...model.grouped.easy, ...model.grouped.normalLight], "Пока нет кандидатов.", recommendationFor)}
          </article>
          <article>
            <h4>Оставить / закрепить</h4>
            ${reportList([...model.grouped.normal, ...model.grouped.normalHard], "Пока нет упражнений.", recommendationFor)}
          </article>
          <article>
            <h4>Проверить / возможно снизить</h4>
            ${reportList(model.grouped.hard, "Пока нет упражнений.", recommendationFor)}
          </article>
        </div>
      </section>
    ` : `<div class="empty">На этой неделе пока нет отмеченных упражнений.</div>`}

    <div class="manual-copy ${state.showReportText ? "is-visible" : ""}" id="manualCopy">
      <label for="reportText">Текст отчёта</label>
      <textarea id="reportText" readonly>${reportText}</textarea>
      <p>Если автоматическое копирование недоступно, скопируй текст вручную.</p>
    </div>
  `;

  els.weeklyReport.querySelector("#reportWeekSelect")?.addEventListener("change", (event) => {
    state.reportWeekKey = event.target.value;
    state.showReportText = false;
    renderWeeklyReport();
  });
  els.weeklyReport.querySelector("#toggleReportText")?.addEventListener("click", () => {
    state.showReportText = !state.showReportText;
    renderWeeklyReport();
  });
  els.weeklyReport.querySelector("#copyWeeklyReport")?.addEventListener("click", async () => {
    const status = els.weeklyReport.querySelector("#copyStatus");
    try {
      await navigator.clipboard.writeText(reportText);
      status.textContent = "Итоги недели скопированы";
    } catch {
      state.showReportText = true;
      renderWeeklyReport();
      els.weeklyReport.querySelector("#reportText")?.focus();
      els.weeklyReport.querySelector("#reportText")?.select();
    }
  });
}

function updateProgressViews() {
  const day = workouts.find((item) => item.id === state.activeDayId);
  if (!day) return;

  const activeProgress = els.dayDetails.querySelector("#trainingProgress");
  if (activeProgress) activeProgress.innerHTML = progressMarkup(day);

  document.querySelectorAll("[data-day-progress]").forEach((node) => {
    const progressDay = workouts.find((item) => item.id === node.dataset.dayProgress);
    if (progressDay) node.innerHTML = progressMarkup(progressDay, true);
  });

  document.querySelectorAll("[data-day-done]").forEach((node) => {
    const progressDay = workouts.find((item) => item.id === node.dataset.dayDone);
    if (progressDay) node.checked = Boolean(saved.days[progressDay.id]);
  });

  renderHistory();
  renderLoadSummary();
  renderWeeklyReport();
}

function restoreViewport(anchor, anchorTop, scrollX, scrollY, focusedElement) {
  requestAnimationFrame(() => {
    if (anchor?.isConnected && Number.isFinite(anchorTop)) {
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    } else {
      window.scrollTo({ top: scrollY, left: scrollX, behavior: "auto" });
    }
    if (focusedElement?.isConnected && typeof focusedElement.focus === "function") {
      focusedElement.focus({ preventScroll: true });
    }
  });
}

function setCompletion(key, done, anchor = null) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const focusedElement = document.activeElement;
  saved.exercises[key] = done;
  syncAllDayCompletion();
  const effortDay = dayForExercise(key);
  if (effortDay) storeSessionEffort(effortDay);
  persist();
  updateProgressViews();
  if (effortDay) refreshSessionEffortView(effortDay);
  restoreViewport(anchor, anchorTop, scrollX, scrollY, focusedElement);
}

function setDayCompletion(day, done) {
  completionItems(day).forEach((item) => {
    saved.exercises[item.key] = done;
  });
  syncDayCompletion(day);
  storeSessionEffort(day);
  persist();
  if (done) offerActualWeightsAsPlan(day);
  render();
}

function offerActualWeightsAsPlan(day) {
  day.exercises.forEach((exercise) => {
    const actual = saved.weightData?.[exercise.id];
    const planned = currentPlan.exercises?.[exercise.id]?.currentWeightData;
    if (!actual || !planned || formatWeightData(actual) === formatWeightData(planned)) return;
    if (!window.confirm(`Сделать ${formatWeightData(actual)} новым рабочим весом для «${exercise.title}»?`)) return;
    currentPlan.exercises[exercise.id].previousWeightData = planned;
    currentPlan.exercises[exercise.id].currentWeightData = actual;
    currentPlan.exercises[exercise.id].recommendedNextWeightData = null;
    currentPlan.exercises[exercise.id].progressionState = "user-confirmed";
    currentPlan.exercises[exercise.id].nextStepText = "Оценить подтверждённый рабочий вес на следующей тренировке.";
    delete saved.weightData[exercise.id];
    delete saved.workingWeights[exercise.id];
  });
  persistCurrentPlan();
  persist();
}

function sessionEffortFor(day) {
  const entries = day.exercises.map((exercise) => {
    const strength = strengthForExercise(exercise);
    const completedWorkingSets = strength.setResults.filter((item) => Number(item.reps) > 0).length;
    const completionState = saved.exercises?.[exercise.id];
    return {
      exerciseId: exercise.id,
      effortRating: Number(saved.effortRatings?.[exercise.id]) || null,
      completedWorkingSets,
      completed: completionState === true || (completionState !== false && completedWorkingSets > 0),
      rir: strength.rir,
      techniqueStatus: strength.techniqueStatus,
    };
  }).filter((entry) => entry.completed);
  return { entries, summary: calculateSessionEffort(entries) };
}

function storeSessionEffort(day) {
  if (!day?.exercises?.length) return null;
  const { summary } = sessionEffortFor(day);
  saved.sessionEffort[day.id] = {
    ...summary,
    sessionEffortCalculatedExact: summary.exact,
    sessionEffortCalculated: summary.rounded,
    updatedAt: new Date().toISOString(),
  };
  return summary;
}

function refreshSessionEffortView(day) {
  const current = els.dayDetails.querySelector("#sessionEffortCard");
  if (current) current.outerHTML = sessionEffortMarkup(day);
  renderHistory();
}

function sessionEffortMarkup(day) {
  if (!day.exercises.length) return "";
  const { summary } = sessionEffortFor(day);
  const averageDisplay = summary.exact === null ? "" : formatNumber(Math.round(summary.exact * 10) / 10);
  return `
    <section class="session-effort-card" id="sessionEffortCard">
      <p class="eyebrow">ПОСЛЕ ТРЕНИРОВКИ</p>
      <h3>Итоговое усилие</h3>
      ${summary.exact === null ? `
        <div class="session-effort-empty">
          <strong>Пока недостаточно данных</strong>
          <span>Отмечайте Effort после упражнений — итог появится автоматически.</span>
        </div>
      ` : `
        <div class="session-effort-result">
          <strong class="session-effort-number">${summary.rounded}</strong>
          <span class="session-effort-category">${effortCategory(summary.rounded)}</span>
        </div>
        <div class="session-effort-track" aria-label="Итоговое усилие ${summary.rounded} из 10">
          ${effortLevels.map((level) => `<span class="${level.value <= summary.rounded ? "is-filled" : ""} ${level.value === summary.rounded ? "is-current" : ""}">${level.value}</span>`).join("")}
        </div>
        <p class="session-effort-average">Средняя оценка: <strong>${averageDisplay}</strong></p>
        <p>Оценено ${summary.ratedExercises} из ${summary.completedExercises} выполненных упражнений.</p>
        <p>Рассчитано по ${summary.completedExercises} ${plural(summary.completedExercises, "упражнению", "упражнениям", "упражнениям")} и ${summary.completedSets} рабочим подходам.</p>
        ${summary.complete ? "" : `<small class="session-effort-preliminary">Итог предварительный.</small>`}
        <p class="session-effort-watch">Для Apple Watch: <strong>${summary.rounded} — ${effortCategory(summary.rounded)}</strong></p>
      `}
    </section>
  `;
}

function workingWeightFor(exerciseId) {
  return formatWeightData(weightDataForExercise(exerciseId));
}

function weightDataForExercise(exerciseId) {
  const planWeight = currentPlan.exercises?.[exerciseId]?.currentWeightData;
  const fallback = saved.workingWeights?.[exerciseId] || formatWeightData(planWeight)
    || weightText(exerciseById(exerciseId)?.weight);
  return saved.weightData?.[exerciseId]
    || planWeight
    || normalizeWeightData(fallback);
}

function previousResultFor(exerciseId) {
  const result = resultForExercise(exerciseId);
  const history = result.history || [];
  const previous = [...history]
    .filter((entry) => entry.weekKey !== currentWeek.key)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return previous[0] || (
    result.latestFeedback
      ? { weight: result.workingWeight, feedback: result.latestFeedback }
      : null
  );
}

function recommendationFromFeedback(feedback) {
  if (feedback === "easy") return "Легко. Можно немного увеличить вес, если техника чистая.";
  if (feedback === "normal-light") return "Норма ближе к легко. Если так повторится ещё раз, можно немного увеличить вес.";
  if (feedback === "normal") return "Рабочий вес подходит. Оставляем.";
  if (feedback === "normal-hard") return "Хорошая нагрузка для роста. Вес пока оставить, следить за техникой.";
  if (feedback === "hard") return "Тяжело. Вес не повышать. Если техника ломалась или повторы не добраны, лучше снизить вес.";
  return "После упражнения отметь нагрузку, чтобы получить рекомендацию.";
}

function strengthRecommendation(exerciseId, feedback) {
  const exercise = exerciseById(exerciseId);
  const day = dayForExercise(exerciseId);
  const strength = exercise ? strengthForExercise(exercise) : {};
  const reps = strength.setResults.map((item) => Number(item.reps)).filter(Number.isFinite);
  const hitUpper = reps.length >= strength.targetSets && reps.every((value) => value >= strength.maxReps);
  const missedMinimum = reps.length > 0 && reps.some((value) => value < strength.minReps);
  const currentHistory = [...(resultForExercise(exerciseId).history || [])]
    .filter((entry) => entry.rir)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const eligibleRir = ["2", "3", "3plus"].includes(strength.rir);
  const effortRating = Number(saved.effortRatings?.[exerciseId] || 0);
  const eligibleTwice = eligibleRir
    && currentHistory.length >= 2
    && currentHistory.slice(0, 2).every((entry) => (
      ["2", "3", "3plus"].includes(entry.rir)
      && resultHitUpperReps(entry, exercise)
    ));
  if (strength.techniqueStatus === "pain") return "Отмечена боль. Нагрузку не повышать; остановить упражнение и разобраться с причиной.";
  if (strength.techniqueStatus === "unstable" || strength.techniqueStatus === "discomfort") {
    return "Нагрузку не повышать: сначала вернуть стабильную технику и движение без дискомфорта.";
  }
  if (isLightCoreDay(day)) {
    if (feedback === "easy" || feedback === "normal-light" || feedback === "normal") {
      return "Для четверга это хороший уровень: лёгкая активация корпуса без добивания перед йогой.";
    }
    if (feedback === "normal-hard") {
      return "Для четверга уже ближе к тяжело — вес и объём не повышать, лучше держать спокойнее.";
    }
    if (feedback === "hard") return "Для четверга тяжело — упростить, снизить вес или сократить объём.";
  }
  if (strength.rir === "0" || missedMinimum) return "Снизить нагрузку или проверить технику. Вес не повышать.";
  if (effortRating >= 9) return "Усилие 9–10: вес не повышать, сначала восстановиться и закрепить технику.";
  if (strength.rir === "1" || feedback === "normal-hard") return "Оставить текущую нагрузку и закрепить верхнюю границу повторений.";
  if (hitUpper && eligibleTwice) return "Можно попробовать следующую ступень веса. Первый подход выполнить как пробный. Если техника ухудшается или не получается нижняя граница повторений, вернуть предыдущий вес.";
  if (hitUpper && eligibleRir) return "Верх повторов выполнен с запасом. Повторить результат ещё на одной тренировке перед повышением веса.";
  if (eligibleRir) return "Запас достаточный, но верхняя граница повторений пока нестабильна. Оставить текущий вес.";
  return recommendationFromFeedback(feedback);
}

function saveExerciseResult(exerciseId, feedback) {
  const result = resultForExercise(exerciseId);
  const weight = workingWeightFor(exerciseId);
  const exercise = exerciseById(exerciseId);
  const day = dayForExercise(exerciseId);
  const strength = exercise ? strengthForExercise(exercise) : {};
  const existing = result.history.find((entry) => entry.weekKey === currentWeek.key);
  const resolvedFeedback = feedback || existing?.feedback || "";
  const entry = {
    date: new Date().toISOString(),
    weekKey: currentWeek.key,
    dayId: day?.id || "",
    weight,
    targetSets: strength.targetSets,
    targetReps: strength.targetReps,
    actualSets: strength.actualSets,
    actualReps: strength.actualReps,
    setResults: strength.setResults,
    rir: strength.rir,
    techniqueStatus: strength.techniqueStatus,
    feedback: resolvedFeedback,
    effortRating: Number(saved.effortRatings?.[exerciseId]) || null,
    weightData: weightDataForExercise(exerciseId),
  };
  if (existing) Object.assign(existing, entry);
  else result.history.push(entry);
  result.workingWeight = weight;
  if (resolvedFeedback) result.latestFeedback = resolvedFeedback;
  result.history.sort((a, b) => new Date(a.date) - new Date(b.date));
  persistExerciseResults();
}

function setExerciseWeight(exerciseId, value) {
  const currentData = weightDataForExercise(exerciseId);
  const number = parseLocaleNumber(value);
  if (value !== "" && number === null) return;
  const weightData = {
    ...currentData,
    value: number,
    unit: currentData.unit === "bodyweight" ? "kg" : currentData.unit,
    needsReview: false,
    reviewReason: "",
    verified: true,
    raw: "",
  };
  const normalizedWeight = formatWeightData(weightData);
  saved.weightData[exerciseId] = weightData;
  saved.workingWeights[exerciseId] = normalizedWeight;
  const result = resultForExercise(exerciseId);
  const currentEntry = result.history.find((entry) => entry.weekKey === currentWeek.key);
  if (currentEntry) {
    currentEntry.weight = normalizedWeight;
    currentEntry.weightData = weightData;
    currentEntry.date = new Date().toISOString();
  }
  persist();
  persistExerciseResults();
}

function setExerciseStrengthField(exerciseId, field, value) {
  const exercise = exerciseById(exerciseId);
  if (!exercise) return;
  const current = strengthForExercise(exercise);
  saved.strength[exerciseId] = {
    ...saved.strength[exerciseId],
    [field]: String(value).trim(),
  };
  const currentEntry = resultForExercise(exerciseId).history.find((entry) => entry.weekKey === currentWeek.key);
  if (currentEntry) {
    currentEntry[field] = String(value).trim();
    currentEntry.date = new Date().toISOString();
    persistExerciseResults();
  }
  persist();
}

function setExerciseSetRep(exerciseId, index, value) {
  const exercise = exerciseById(exerciseId);
  if (!exercise) return;
  const current = strengthForExercise(exercise);
  const setResults = Array.from({ length: current.targetSets }, (_, setIndex) => ({
    reps: setIndex === index ? (parseLocaleNumber(value) ?? "") : (current.setResults[setIndex]?.reps ?? ""),
  }));
  saved.strength[exerciseId] = { ...saved.strength[exerciseId], setResults };
  const existing = resultForExercise(exerciseId).history.find((entry) => entry.weekKey === currentWeek.key);
  if (existing) {
    existing.setResults = setResults;
    existing.date = new Date().toISOString();
    persistExerciseResults();
  }
  const day = dayForExercise(exerciseId);
  if (day) storeSessionEffort(day);
  persist();
  if (day) refreshSessionEffortView(day);
}

function isCardioRoutine(section, item) {
  const text = normalize(`${section.kind} ${section.title} ${item.title} ${item.amount} ${item.technique}`);
  return section.kind === "entry" || section.kind === "interval" || /кардио|эллипс|гребл|велотренаж|дорожк|велосипед/.test(text);
}

function cardioFieldsFor(key) {
  return normalizeCardioEntry(saved.cardio?.[key] || {});
}

function cardioDefaultMinutes(amount) {
  const text = String(amount || "");
  const range = /(\d+)\s*[-–]\s*(\d+)\s*мин/i.exec(text);
  if (range) return String(Math.round((Number(range[1]) + Number(range[2])) / 2));
  const exact = /(\d+)\s*мин/i.exec(text);
  return exact ? exact[1] : "";
}

function cardioDistanceFor(minutes) {
  return {
    10: 0.8,
    15: 1.2,
    20: 1.6,
    30: 2.4,
  }[String(minutes)] ?? "";
}

function cardioCaloriesFor(minutes) {
  return {
    10: "60",
    15: "90",
    20: "120",
    30: "180",
  }[String(minutes)] || "";
}

function cardioDefaultLevel(key, item) {
  const title = normalize(item.title);
  if (key.startsWith("mon-entry")) return "8";
  if (key.startsWith("thu-entry")) return "6";
  if (title.includes("эллипс")) return "7";
  if (title.includes("греб")) return "10";
  if (title.includes("велотренаж")) return "8";
  return "";
}

function cardioDefaultsFor(key, item) {
  const minutes = cardioDefaultMinutes(item.amount);
  if (key.startsWith("thu-entry")) {
    return {
      levelValue: 6,
      minutes: "30",
      distanceValue: 2.2,
      calories: 160,
    };
  }
  return {
    levelValue: cardioDefaultLevel(key, item),
    minutes,
    distanceValue: cardioDistanceFor(minutes),
    distanceUnit: "km",
    calories: cardioCaloriesFor(minutes),
  };
}

function cardioFieldValue(stored, defaults, field) {
  const value = stored?.[field];
  if (field === "calories" && value !== undefined && value !== null && value !== "" && Number(value) <= 1) return defaults[field] || "";
  return value !== undefined && value !== null && value !== "" ? value : defaults[field] || "";
}

function setRoutineCardioField(key, field, value) {
  const parsed = parseLocaleNumber(value);
  if (value !== "" && parsed === null) return;
  saved.cardio[key] = {
    ...cardioFieldsFor(key),
    version: 2,
    [field]: value === "" ? null : parsed,
    needsReview: false,
    reviewReason: "",
  };
  persist();
}

function setExerciseFeedback(exerciseId, value, anchor = null) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const focusedElement = document.activeElement;
  saved.feedback[exerciseId] = value;
  if (!saved.workingWeights[exerciseId]) saved.workingWeights[exerciseId] = workingWeightFor(exerciseId);
  saveExerciseResult(exerciseId, value);
  persist();
  renderLoadSummary();
  renderWeeklyReport();
  restoreViewport(anchor, anchorTop, scrollX, scrollY, focusedElement);
}

function setExerciseEffortRating(exerciseId, value, anchor = null) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) return;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const focusedElement = document.activeElement;
  saved.effortRatings[exerciseId] = rating;
  if (!saved.workingWeights[exerciseId]) saved.workingWeights[exerciseId] = workingWeightFor(exerciseId);
  saveExerciseResult(exerciseId, saved.feedback?.[exerciseId] || "");
  const day = dayForExercise(exerciseId);
  if (day) storeSessionEffort(day);
  persist();
  if (day) refreshSessionEffortView(day);
  restoreViewport(anchor, anchorTop, scrollX, scrollY, focusedElement);
}

function effortTargetText(exerciseId) {
  return "Effort — ощущение от упражнения целиком; RIR отмечается отдельно";
}

function effortDetailMarkup(value) {
  const level = effortLevelFor(value);
  if (!level) {
    return `
      <strong>Выбери усилие 1–10</strong>
      <span>1–3 легко · 4–6 умеренно · 7–8 тяжело · 9–10 на пределе.</span>
    `;
  }
  return `
    <strong>${level.score} · ${escapeHtml(level.label)}</strong>
    <span>Субъективное усилие упражнения в целом.</span>
  `;
}

function shouldIgnoreToggle(event) {
  if (window.getSelection?.().toString()) return true;
  if (!(event.target instanceof Element)) return false;
  return Boolean(event.target.closest("button, input, textarea, select, a, details, summary, label"));
}

function metricValue(value) {
  if (!value || typeof value !== "object") return value;
  return [
    value.start ? `<span><strong>Старт:</strong> ${value.start}</span>` : `<span><strong>Старт:</strong> уточнить</span>`,
    value.hint ? `<span><strong>Подсказка:</strong> ${value.hint}</span>` : "",
  ].filter(Boolean).join("");
}

function searchableValue(value) {
  if (!value || typeof value !== "object") return value || "";
  return [value.start, value.range, value.hint].filter(Boolean).join(" ");
}

function openTipSheet(title, text) {
  const sheet = document.querySelector("#tipSheet");
  if (!sheet) return;
  sheet.querySelector(".tip-sheet__title").textContent = title;
  sheet.querySelector(".tip-sheet__text").textContent = text;
  sheet.classList.add("is-open");
  sheet.setAttribute("aria-hidden", "false");
}

function closeTipSheet() {
  const sheet = document.querySelector("#tipSheet");
  if (!sheet) return;
  sheet.classList.remove("is-open");
  sheet.setAttribute("aria-hidden", "true");
}

els.hero?.style.setProperty("--hero-image", `url("${assetPath("assets/hero/workout-hero.png")}")`);

function updateScrollTopButton() {
  els.scrollTopButton?.classList.toggle("is-visible", window.scrollY > 420);
}

window.addEventListener("scroll", updateScrollTopButton, { passive: true });

els.scrollTopButton?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.addEventListener("click", (event) => {
  const tooltip = event.target instanceof Element ? event.target.closest(".tooltip") : null;
  if (tooltip && window.matchMedia("(max-width: 720px)").matches) {
    event.preventDefault();
    event.stopPropagation();
    openTipSheet(tooltip.dataset.tipTitle || "Подсказка", tooltip.dataset.tip || "");
    return;
  }

  if (event.target instanceof Element && event.target.closest("[data-tip-close]")) {
    closeTipSheet();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTipSheet();
});

function matchesFilter(day) {
  if (state.filter === "Все") return true;
  const dayMatch = day.tags.includes(state.filter) || day.type.includes(state.filter);
  const exerciseMatch = day.exercises.some((exercise) => exercise.tags.includes(state.filter));
  const sectionMatch = day.sections?.some((section) => section.tags.includes(state.filter));
  return dayMatch || exerciseMatch || sectionMatch;
}

function matchesQuery(day) {
  if (!state.query) return true;
  const haystack = [
    day.day,
    day.shortDay,
    day.title,
    day.type,
    day.summary,
    day.tags.join(" "),
    ...(day.sections || []).flatMap((section) => [
      section.title,
      section.summary,
      section.tags.join(" "),
      ...section.items.flatMap((item) => [
        item.title,
        item.amount,
        item.technique,
        item.goal,
        ...(item.program || []).flatMap((step) => [step.title, step.amount, step.note, ...(step.lines || [])]),
      ]),
    ]),
    ...day.exercises.flatMap((exercise) => [
      exercise.title,
      exercise.summary,
      exercise.muscles,
      searchableValue(exercise.weight),
      exercise.tags.join(" "),
    ]),
  ].join(" ");
  return normalize(haystack).includes(normalize(state.query));
}

function visibleWorkouts() {
  return workouts.filter((day) => matchesFilter(day) && matchesQuery(day));
}

function renderPills() {
  els.dayPills.innerHTML = "";
  workouts.forEach((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill ${state.activeDayId === day.id ? "is-active" : ""}`;
    button.textContent = day.shortDay;
    button.addEventListener("click", () => selectDay(day.id));
    els.dayPills.append(button);
  });
}

function renderFilters() {
  els.filters.innerHTML = "";
  filters.forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter ${state.filter === filter ? "is-active" : ""}`;
    button.textContent = filter;
    button.addEventListener("click", () => {
      state.filter = filter;
      ensureActiveDayVisible();
      render();
    });
    els.filters.append(button);
  });
}

function renderWeek() {
  const days = visibleWorkouts();
  els.week.innerHTML = "";

  if (!days.length) {
    els.week.innerHTML = `<div class="empty">Ничего не найдено. Попробуйте другой запрос или фильтр.</div>`;
    return;
  }

  days.forEach((day) => {
    const card = document.createElement("article");
    card.className = `day-card accent-${day.accent} ${day.id === state.activeDayId ? "is-active" : ""}`;
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="day-card__top">
        <div>
          <p>${day.day}</p>
          <h2>${day.title}</h2>
        </div>
        <label class="mini-check" title="Тренировка выполнена">
          <input type="checkbox" data-day-done="${day.id}" ${saved.days[day.id] ? "checked" : ""} />
        </label>
      </div>
      <p class="day-type">${day.type}</p>
      <p class="day-summary">${day.summary}</p>
      <p class="duration">${day.duration}</p>
      <div class="day-progress" data-day-progress="${day.id}">${progressMarkup(day, true)}</div>
      <div class="tags">${day.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    `;
    card.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".mini-check")) return;
      selectDay(day.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectDay(day.id);
    });
    card.querySelector("input").addEventListener("click", (event) => event.stopPropagation());
    card.querySelector("input").addEventListener("change", (event) => {
      setDayCompletion(day, event.target.checked);
    });
    els.week.append(card);
  });
}

function renderDayDetails() {
  const day = workouts.find((item) => item.id === state.activeDayId) || workouts[0];
  const filteredSections = (day.sections || []).filter((section) => sectionMatches(section, day));
  const filteredExercises = day.exercises.filter((exercise) => {
    const filterOk = state.filter === "Все" || exercise.tags.includes(state.filter) || day.tags.includes(state.filter);
    if (!state.query) return filterOk;
    const haystack = normalize([
      day.day,
      day.title,
      day.type,
      exercise.title,
      exercise.summary,
      exercise.muscles,
      searchableValue(exercise.weight),
      exercise.tags.join(" "),
    ].join(" "));
    return filterOk && haystack.includes(normalize(state.query));
  });
  const firstAfterMainIndex = filteredSections.findIndex((section) => ["cooldown", "yoga"].includes(section.kind));
  const preSections = firstAfterMainIndex === -1 ? filteredSections : filteredSections.slice(0, firstAfterMainIndex);
  const postSections = firstAfterMainIndex === -1 ? [] : filteredSections.slice(firstAfterMainIndex);
  const counts = [
    ...(day.exercises.length
      ? [`Основная часть: ${filteredExercises.length} ${plural(filteredExercises.length, "упражнение", "упражнения", "упражнений")}`]
      : []),
    ...filteredSections.map((section) => `${section.title}: ${section.items.length} ${plural(section.items.length, "пункт", "пункта", "пунктов")}`),
  ];

  els.dayDetails.innerHTML = `
    <div class="day-hero accent-${day.accent}">
      <div>
        <p class="eyebrow">${day.day}</p>
        <h2>${day.title}</h2>
        <p>${day.summary}</p>
      </div>
      <label class="complete-day">
        <input id="activeDayDone" type="checkbox" data-day-done="${day.id}" ${saved.days[day.id] ? "checked" : ""} />
        <span>Тренировка выполнена</span>
      </label>
    </div>

    <div class="day-meta">
      <article>
        <h3>Что сегодня делаем</h3>
        <ul>${day.quickPlan.map((item) => `<li>${item}</li>`).join("")}</ul>
      </article>
      <article>
        <h3>Интенсивность</h3>
        <p>${day.intensity}</p>
      </article>
      <article>
        <h3>Важно сегодня</h3>
        <p>${day.important}</p>
      </article>
    </div>

    <div class="day-counts">${counts.map((item) => `<span>${item}</span>`).join("")}</div>

    <section class="progress-card" id="trainingProgress" aria-label="Прогресс тренировки">
      ${progressMarkup(day)}
    </section>

    <div class="notes-box">
      <label for="dayNotes">Заметки после тренировки</label>
      <textarea id="dayNotes" placeholder="Вес, повторы, самочувствие, что было сложно...">${saved.notes[day.id] || ""}</textarea>
    </div>

    <div class="training-flow"></div>

    ${sessionEffortMarkup(day)}
  `;

  els.dayDetails.querySelector("#activeDayDone").addEventListener("change", (event) => {
    setDayCompletion(day, event.target.checked);
  });

  els.dayDetails.querySelector("#dayNotes").addEventListener("input", (event) => {
    saved.notes[day.id] = event.target.value;
    persistNotes();
  });
  els.dayDetails.querySelector("#dayNotes").addEventListener("click", (event) => event.stopPropagation());

  const flow = els.dayDetails.querySelector(".training-flow");
  preSections.forEach((section) => flow.append(renderRoutineSection(section)));
  if (day.exercises.length) {
    flow.append(renderMainSection(day, filteredExercises));
  }
  postSections.forEach((section) => flow.append(renderRoutineSection(section)));
}

function sectionMatches(section, day) {
  const filterOk = state.filter === "Все" || section.tags.includes(state.filter) || day.tags.includes(state.filter);
  if (!state.query) return filterOk;
  const haystack = normalize([
    day.day,
    day.title,
    day.type,
    section.title,
    section.summary,
    section.tags.join(" "),
    ...section.items.flatMap((item) => [
      item.title,
      item.amount,
      item.technique,
      item.goal,
      ...(item.program || []).flatMap((step) => [step.title, step.amount, step.note, ...(step.lines || [])]),
    ]),
  ].join(" "));
  return filterOk && haystack.includes(normalize(state.query));
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderMainSection(day, exercises) {
  const section = document.createElement("section");
  section.className = "flow-section main-flow";
  section.innerHTML = `
    <div class="exercise-heading">
      <div>
        <p class="eyebrow">${state.quickMode ? "Быстро в зале" : "Карточки с картинками"}</p>
        <h2>Основная часть</h2>
      </div>
      <span>${exercises.length} из ${day.exercises.length} ${plural(exercises.length, "упражнение", "упражнения", "упражнений")}</span>
    </div>
    <div class="exercise-grid"></div>
  `;

  const grid = section.querySelector(".exercise-grid");
  if (!exercises.length) {
    grid.innerHTML = `<div class="empty">Для этого дня нет упражнений основной части под текущий поиск или фильтр.</div>`;
    return section;
  }

  const defaultIds = day.exercises.map((item) => item.id);
  const storedOrder = saved.sessionOrder?.[day.id] || defaultIds;
  const order = [...storedOrder.filter((id) => defaultIds.includes(id)), ...defaultIds.filter((id) => !storedOrder.includes(id))];
  const orderedExercises = [...exercises].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  orderedExercises.forEach((item, index) => grid.append(renderExercise(item, index + 1, day.id)));
  return section;
}

function renderRoutineSection(section) {
  if (section.kind === "pool-session") return renderPoolSession(section);

  const node = document.createElement("section");
  node.className = `routine-section routine-${section.kind}`;
  node.innerHTML = `
    <details open>
      <summary>
        <span>
          <strong>${section.title}</strong>
          <small>${section.summary}</small>
        </span>
        <em>${section.items.length} ${plural(section.items.length, "пункт", "пункта", "пунктов")}</em>
      </summary>
      <div class="routine-list"></div>
    </details>
  `;

  const list = node.querySelector(".routine-list");
  section.items.forEach((item, index) => {
    const key = `${section.id}:${index}`;
    const isDone = Boolean(saved.exercises[key]);
    const cardioFields = cardioFieldsFor(key);
    const showCardioFields = isCardioRoutine(section, item);
    const cardioDefaults = showCardioFields ? cardioDefaultsFor(key, item) : {};
    const row = document.createElement("article");
    row.className = `routine-item ${isDone ? "is-done" : ""}`;
    row.role = "button";
    row.tabIndex = 0;
    row.innerHTML = `
      <button class="routine-check" type="button" aria-pressed="${isDone}">
        <span class="routine-check__icon" aria-hidden="true">${isDone ? "✓" : index + 1}</span>
        <span class="routine-check__text">${isDone ? "Готово" : "Отметить"}</span>
      </button>
      <div>
        <h3>${item.title}</h3>
        <p class="routine-amount">${item.amount}</p>
        ${
          state.quickMode
            ? ""
            : `<p><strong>Как:</strong> ${item.technique}</p><p><strong>Зачем:</strong> ${item.goal}</p>`
        }
        ${showCardioFields ? `
          <div class="routine-cardio-fields" aria-label="Результат кардио">
            <label><span>Уровень / мощность</span><input type="text" inputmode="decimal" pattern="^-?\\d*[.,]?\\d*$" value="${escapeHtml(cardioFieldValue(cardioFields, cardioDefaults, "levelValue"))}" data-cardio-field="levelValue" /></label>
            <label><span>Минуты</span><span class="number-with-unit"><input type="text" inputmode="decimal" pattern="^-?\\d*[.,]?\\d*$" value="${escapeHtml(cardioFieldValue(cardioFields, cardioDefaults, "minutes"))}" data-cardio-field="minutes" /><span>мин</span></span></label>
            <label><span>Дистанция</span><span class="number-with-unit"><input type="text" inputmode="decimal" pattern="^-?\\d*[.,]?\\d*$" value="${escapeHtml(cardioFieldValue(cardioFields, cardioDefaults, "distanceValue"))}" data-cardio-field="distanceValue" /><span>${escapeHtml(cardioFields.distanceUnit || cardioDefaults.distanceUnit || "km") === "m" ? "м" : "км"}</span></span></label>
            <label><span>Калории</span><span class="number-with-unit"><input type="text" inputmode="numeric" pattern="^\\d*$" value="${escapeHtml(cardioFieldValue(cardioFields, cardioDefaults, "calories"))}" data-cardio-field="calories" /><span>ккал</span></span></label>
          </div>
          ${cardioFields.needsReview ? `<p class="data-warning">Требует проверки: ${escapeHtml(cardioFields.reviewReason)}</p>` : ""}
        ` : ""}
      </div>
    `;
    const applyRoutineState = (done) => {
      const button = row.querySelector(".routine-check");
      row.classList.toggle("is-done", done);
      button.setAttribute("aria-pressed", String(done));
      button.querySelector(".routine-check__icon").textContent = done ? "✓" : index + 1;
      button.querySelector(".routine-check__text").textContent = done ? "Готово" : "Отметить";
    };
    const toggleRoutine = () => {
      const done = !saved.exercises[key];
      setCompletion(key, done, row);
      applyRoutineState(done);
    };
    row.addEventListener("click", (event) => {
      if (shouldIgnoreToggle(event)) return;
      toggleRoutine();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleRoutine();
    });
    row.querySelector(".routine-check").addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRoutine();
    });
    row.querySelectorAll("[data-cardio-field]").forEach((input) => {
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("keydown", (event) => event.stopPropagation());
      input.addEventListener("input", (event) => {
        event.stopPropagation();
        setRoutineCardioField(key, input.dataset.cardioField, event.target.value);
      });
    });
    list.append(row);
  });

  return node;
}

function renderPoolSession(section) {
  const item = section.items[0];
  const key = `${section.id}:0`;
  const node = document.createElement("section");
  const isDone = Boolean(saved.exercises[key]);
  node.className = "routine-section routine-pool-session";
  node.innerHTML = `
    <article class="pool-session ${isDone ? "is-done" : ""}">
      <header class="pool-session__header">
        <div>
          <p class="eyebrow">Пятничная тренировка</p>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.amount)}</p>
        </div>
        <span class="pool-session__status">${isDone ? "1/1" : "0/1"}</span>
      </header>
      <p class="pool-session__note">В бассейне не отмечаем каждый кусок отдельно. Программа идёт одним блоком, после выхода нажимаем «Готово».</p>
      <ol class="pool-program">
        ${(item.program || []).map((step) => `
          <li>
            <div class="pool-program__step">
              <strong>${escapeHtml(step.title)}</strong>
              ${step.amount ? `<span>${escapeHtml(step.amount)}</span>` : ""}
            </div>
            ${(step.lines || []).length ? `<ul>${step.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
            ${step.note ? `<p>${escapeHtml(step.note)}</p>` : ""}
          </li>
        `).join("")}
      </ol>
      <button class="pool-session__done" type="button" aria-pressed="${isDone}">
        <span aria-hidden="true">${isDone ? "✓" : ""}</span>
        <strong>${isDone ? "Выполнено" : "Готово"}</strong>
      </button>
    </article>
  `;

  const card = node.querySelector(".pool-session");
  const button = node.querySelector(".pool-session__done");
  button.addEventListener("click", () => {
    const done = !saved.exercises[key];
    setCompletion(key, done, card);
    card.classList.toggle("is-done", done);
    button.setAttribute("aria-pressed", String(done));
    button.querySelector("span").textContent = done ? "✓" : "";
    button.querySelector("strong").textContent = done ? "Выполнено" : "Готово";
    node.querySelector(".pool-session__status").textContent = done ? "1/1" : "0/1";
  });

  return node;
}

function renderExercise(item, order, dayId) {
  const template = document.querySelector("#exerciseTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.exerciseId = item.id;
  node.classList.toggle("is-quick", state.quickMode);
  node.role = "button";
  node.tabIndex = 0;
  const doneButton = node.querySelector(".exercise-done");
  const applyExerciseState = (done) => {
    node.classList.toggle("is-done", done);
    doneButton.setAttribute("aria-pressed", String(done));
    doneButton.querySelector(".done-text").textContent = done ? "Выполнено" : "Отметить выполненным";
  };
  const toggleExercise = () => {
    const done = !saved.exercises[item.id];
    setCompletion(item.id, done, node);
    applyExerciseState(done);
  };
  applyExerciseState(Boolean(saved.exercises[item.id]));
  const feedbackTitle = node.querySelector(".feedback-title");
  feedbackTitle.innerHTML = `
    <span>Насколько тяжело было это упражнение?</span>
    <small>${escapeHtml(effortTargetText(item.id))}</small>
  `;
  node.addEventListener("click", (event) => {
    if (shouldIgnoreToggle(event)) return;
    toggleExercise();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleExercise();
  });
  doneButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExercise();
  });

  const feedbackButtons = node.querySelector(".feedback-buttons");
  const feedbackDetail = document.createElement("div");
  feedbackDetail.className = "effort-detail";
  feedbackButtons.after(feedbackDetail);
  const resultPanel = document.createElement("div");
  resultPanel.className = "exercise-result-panel";
  node.querySelector(".exercise-card__actions").insertBefore(resultPanel, node.querySelector(".effort-feedback"));

  const renderResultPanel = () => {
    const previous = previousResultFor(item.id);
    const result = resultForExercise(item.id);
    const strength = strengthForExercise(item);
    const currentFeedback = saved.feedback?.[item.id] || "";
    const recommendationFeedback = currentFeedback || previous?.feedback || "";
    const history = [...(result.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
    const weightData = weightDataForExercise(item.id);
    const planEntry = currentPlan.exercises?.[item.id];
    const setInputs = Array.from({ length: strength.targetSets }, (_, index) => strength.setResults[index]?.reps ?? "");
    const legacyPerformance = !strength.setResults.length && strength.actualSets && strength.actualReps
      ? `${strength.actualSets} подхода × ${strength.actualReps} повторений (старый формат)`
      : "";
    resultPanel.innerHTML = `
      <div class="working-weight">
        <span>СЕГОДНЯ · фактический вес <button type="button" class="weight-edit" data-weight-edit aria-label="Изменить вес">✎</button></span>
        ${weightData.unit === "bodyweight" ? `<strong>Без веса</strong>` : `
          <label class="number-with-unit">
            <input
              type="text"
              inputmode="decimal"
              pattern="^-?\\d*[.,]?\\d*$"
              value="${escapeHtml(weightData.value ?? parseLocaleNumber(weightData.raw) ?? "")}"
              data-weight-value
              aria-label="Рабочий вес: ${escapeHtml(item.title)}"
            />
            <span>кг${weightData.perSide ? ` / ${escapeHtml(weightData.sideLabel || "рука")}` : ""}</span>
          </label>
        `}
        ${weightData.needsReview ? `<small class="data-warning">Требует проверки: ${escapeHtml(weightData.reviewReason)}</small>` : ""}
      </div>
      <div class="set-result-fields" aria-label="${strength.unit === "повт." ? "Повторы" : "Время"} по подходам">
        <span class="field-label">${strength.unit === "повт." ? "Повторы по подходам" : `Время по подходам, ${escapeHtml(strength.unit)}`}</span>
        <div>
          ${setInputs.map((value, index) => `
            <label>
              <span>Подход ${index + 1}</span>
              <input type="number" min="0" inputmode="numeric" value="${escapeHtml(value)}" data-set-reps="${index}" />
            </label>
          `).join("")}
        </div>
        ${legacyPerformance ? `<small>Прошлая запись: ${escapeHtml(legacyPerformance)}. Распределение по подходам не выдумываем.</small>` : ""}
      </div>
      <div class="strength-state-fields">
        <label>
          <span>RIR последнего подхода</span>
          <select data-strength-field="rir">
            <option value="">Не отмечено</option>
            ${Object.entries(rirOptions).map(([value, label]) => `<option value="${value}" ${strength.rir === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Техника / ощущения</span>
          <select data-strength-field="techniqueStatus">
            <option value="">Не отмечено</option>
            ${Object.entries(techniqueOptions).map(([value, label]) => `<option value="${value}" ${strength.techniqueStatus === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="previous-result">
        <strong>ПРОШЛАЯ ТРЕНИРОВКА:</strong>
        ${
          previous
            ? `${escapeHtml(previous.weight)} · ${escapeHtml(performanceText(previous) || "повторы не указаны")} · RIR ${escapeHtml(rirOptions[previous.rir] || "—")} · Техника: ${escapeHtml(techniqueOptions[previous.techniqueStatus] || "—")}${previous.effortRating ? ` · Усилие ${previous.effortRating}/10` : previous.feedback ? ` · Нагрузка: ${escapeHtml(effortReportLabels[previous.feedback])}` : ""}`
            : "пока нет данных"
        }
      </p>
      <div class="exercise-recommendation">
        <strong>СЛЕДУЮЩИЙ ШАГ</strong>
        <p>${escapeHtml(planEntry?.nextStepText || strengthRecommendation(item.id, recommendationFeedback))}</p>
        ${planEntry?.recommendedNextWeightData ? `<p>Предложение: <strong>${escapeHtml(formatWeightData(planEntry.recommendedNextWeightData))}</strong> на следующую тренировку.</p>` : ""}
        ${planEntry?.recommendedNextWeightData ? `<button type="button" data-accept-recommendation>Принять ${escapeHtml(formatWeightData(planEntry.recommendedNextWeightData))} как новый план</button>` : ""}
        <button type="button" class="is-secondary" data-set-recommendation>Задать вес следующего шага</button>
      </div>
      ${planEntry?.techniqueNote ? `<p class="exercise-guidance"><strong>Техника:</strong> ${escapeHtml(planEntry.techniqueNote)}</p>` : ""}
      <details class="exercise-history">
        <summary>История упражнения (${history.length})</summary>
        ${
          history.length
            ? `<ul>${history.map((entry) => `
                <li>
                  <time datetime="${escapeHtml(entry.date)}">${new Date(entry.date).toLocaleDateString("ru-RU")}</time>
                  <span>${escapeHtml(entry.weight)}</span>
                  <span>${escapeHtml(performanceText(entry) || "—")}</span>
                  <strong>RIR ${escapeHtml(rirOptions[entry.rir] || "—")} · ${entry.effortRating ? `Усилие ${entry.effortRating}/10` : `Нагрузка: ${escapeHtml(effortReportLabels[entry.feedback] || "не отмечено")}`}${entry.techniqueStatus ? ` · ${escapeHtml(techniqueOptions[entry.techniqueStatus] || entry.techniqueStatus)}` : ""}</strong>
                </li>
              `).join("")}</ul>`
            : `<p>История появится после первой оценки нагрузки.</p>`
        }
      </details>
    `;
    const weightInput = resultPanel.querySelector("[data-weight-value]");
    resultPanel.querySelector("[data-weight-edit]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      weightInput?.focus();
      weightInput?.select();
    });
    weightInput?.addEventListener("click", (event) => event.stopPropagation());
    weightInput?.addEventListener("keydown", (event) => event.stopPropagation());
    weightInput?.addEventListener("change", (event) => {
      event.stopPropagation();
      setExerciseWeight(item.id, event.target.value);
      renderResultPanel();
      renderDataReview();
    });
    resultPanel.querySelectorAll("[data-set-reps]").forEach((input) => {
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("keydown", (event) => event.stopPropagation());
      input.addEventListener("input", (event) => {
        event.stopPropagation();
        setExerciseSetRep(item.id, Number(input.dataset.setReps), event.target.value);
      });
    });
    resultPanel.querySelectorAll("[data-strength-field]").forEach((input) => {
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("keydown", (event) => event.stopPropagation());
      input.addEventListener("change", (event) => {
        event.stopPropagation();
        setExerciseStrengthField(item.id, input.dataset.strengthField, event.target.value);
        saveExerciseResult(item.id, saved.feedback?.[item.id] || "");
        renderResultPanel();
      });
    });
    resultPanel.querySelector("details").addEventListener("click", (event) => event.stopPropagation());
    resultPanel.querySelector("details").addEventListener("keydown", (event) => event.stopPropagation());
    resultPanel.querySelector("[data-accept-recommendation]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!acceptRecommendation(currentPlan, item.id)) return;
      delete saved.weightData[item.id];
      delete saved.workingWeights[item.id];
      persistCurrentPlan();
      persist();
      renderResultPanel();
    });
    resultPanel.querySelector("[data-set-recommendation]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const raw = window.prompt("Вес для следующей тренировки, кг", "");
      if (raw === null) return;
      const value = parseLocaleNumber(raw);
      if (value === null || value <= 0 || !planEntry) return;
      planEntry.recommendedNextWeightData = {
        ...planEntry.currentWeightData,
        value,
        unit: "kg",
        raw: "",
        needsReview: false,
        reviewReason: "",
        verified: true,
      };
      planEntry.nextStepText = "Потенциальное изменение сохранено для следующей тренировки. Текущий вес сегодня не изменён.";
      persistCurrentPlan();
      renderResultPanel();
    });
  };
  renderResultPanel();

  const renderFeedbackSelection = (value) => {
    feedbackButtons.querySelectorAll("[data-effort]").forEach((option) => {
      const selected = option.dataset.effort === String(value || "");
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    feedbackDetail.className = `effort-detail${value ? ` is-${value}` : ""}`;
    feedbackDetail.innerHTML = effortDetailMarkup(value);
  };

  feedbackButtons.innerHTML = effortLevels.map((level) => `
    <button
      class="effort-button is-${level.value}"
      type="button"
      data-effort="${level.value}"
      aria-pressed="false"
      aria-label="Оценка нагрузки ${level.score}: ${escapeHtml(level.label)}"
      title="${escapeHtml(level.label)}"
    >
      ${level.score}
    </button>
  `).join("");
  renderFeedbackSelection(saved.effortRatings?.[item.id] || "");
  feedbackButtons.querySelectorAll("[data-effort]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setExerciseEffortRating(item.id, button.dataset.effort, node);
      renderFeedbackSelection(button.dataset.effort);
      renderResultPanel();
    });
  });

  const media = node.querySelector(".media-wrap");
  const showPlaceholder = () => {
    media.classList.add("is-placeholder");
    media.innerHTML = `<div><strong>Картинка упражнения будет добавлена</strong><span>${item.title}</span></div>`;
  };

  if (item.image) {
    const image = document.createElement("img");
    image.src = assetPath(item.image);
    image.alt = item.title;
    image.loading = "lazy";
    image.addEventListener("error", showPlaceholder, { once: true });
    media.append(image);
  } else {
    showPlaceholder();
  }

  node.querySelector("h3").textContent = `${order}. ${item.title}`;
  const orderControls = document.createElement("div");
  orderControls.className = "session-order-controls";
  orderControls.innerHTML = `<span>Порядок сегодня</span><button type="button" data-order-move="up" aria-label="Переместить выше">↑</button><button type="button" data-order-move="down" aria-label="Переместить ниже">↓</button>`;
  node.querySelector("h3").after(orderControls);
  orderControls.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-order-move]");
    if (!button) return;
    const defaults = (workouts.find((day) => day.id === dayId)?.exercises || []).map((exercise) => exercise.id);
    const ids = [...(saved.sessionOrder?.[dayId] || defaults)];
    const index = ids.indexOf(item.id);
    const nextIndex = button.dataset.orderMove === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    saved.sessionOrder[dayId] = ids;
    persist();
    renderDayDetails();
  });
  node.querySelector(".summary").textContent = item.summary;
  const planEntry = currentPlan.exercises?.[item.id];
  node.querySelector(".metrics").innerHTML = [
    ["СЕГОДНЯ", planEntry ? `${formatWeightData(weightDataForExercise(item.id))} · ${planEntry.targetSets} × ${planEntry.targetReps}` : item.sets],
    ["RPE/RIR", item.rpe],
    ["Отдых", item.rest],
  ].map(([key, value]) => `
    <div>
      <dt>
        ${key}
        <button class="tooltip" type="button" aria-label="${metricHelp[key]}" data-tip-title="${key}" data-tip="${metricHelp[key]}">?</button>
      </dt>
      <dd class="${key === "СЕГОДНЯ" ? "metric-today" : ""}">${metricValue(value)}</dd>
    </div>
  `).join("");
  node.querySelector(".muscles").innerHTML = `<strong>Мышцы:</strong> ${item.muscles}`;

  const details = node.querySelector(".details-list");
  details.innerHTML = "";
  const detailRows = state.quickMode
    ? [["Техника", item.technique]]
    : [
      ["Техника", item.technique],
      ["Ошибки", item.mistakes],
      ["Прогрессия", item.progression],
    ];

  detailRows.forEach(([title, text], index) => {
    const detail = document.createElement("details");
    detail.open = !state.quickMode && index === 0;
    detail.innerHTML = `<summary>${title}</summary><p>${text}</p>`;
    detail.addEventListener("click", (event) => event.stopPropagation());
    detail.addEventListener("keydown", (event) => event.stopPropagation());
    details.append(detail);
  });

  return node;
}

function newestFirst(entries) {
  return [...entries].sort((a, b) => new Date(b.date || b.updatedAt || 0) - new Date(a.date || a.updatedAt || 0));
}

function latestBodyEntry() {
  return newestFirst(bodyMetrics.entries || [])[0] || { date: new Date().toISOString().slice(0, 10), ...bodyMetricDefaults };
}

function trendChartMarkup(label, field, unit) {
  const entries = [...(bodyMetrics.entries || [])]
    .filter((entry) => parseLocaleNumber(entry[field]) !== null)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-12);
  const change = fourWeekChange(entries, field);
  if (entries.length < 2) {
    return `<article class="trend-chart"><strong>${label}</strong><p>График появится после второго измерения.</p></article>`;
  }
  const values = entries.map((entry) => parseLocaleNumber(entry[field]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = entries.length === 1 ? 140 : 8 + (index * 264) / (entries.length - 1);
    const y = 70 - ((value - min) / span) * 54;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `
    <article class="trend-chart">
      <div><strong>${label}</strong><span>${change === null ? "—" : `${change > 0 ? "+" : ""}${formatNumber(change)} ${unit}`} за 4 недели</span></div>
      <svg viewBox="0 0 280 80" role="img" aria-label="Тренд: ${escapeHtml(label)}">
        <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
      <small>${formatNumber(values.at(-1))} ${unit} · ${new Date(entries.at(-1).date).toLocaleDateString("ru-RU")}</small>
    </article>
  `;
}

function duplicateDecisionKey(pair) {
  return `${pair.previous.date}|${pair.duplicate.date}`;
}

function renderBodyTracker() {
  if (!els.bodyTracker) return;
  const latest = latestBodyEntry();
  const duplicatePairs = duplicateBodyPairs(bodyMetrics.entries || [], bodyComparisonFields)
    .filter((pair) => !bodyMetrics.duplicateDecisions?.[duplicateDecisionKey(pair)]);
  els.bodyTracker.innerHTML = `
    <div class="tracker-header">
      <div>
        <p class="eyebrow">Показатели тела</p>
        <h2>Тело</h2>
        <p>Показатели биоимпедансных весов могут меняться из-за воды, еды, времени измерения и недавней тренировки. Оценивай тенденцию минимум за 3-4 недели.</p>
      </div>
    </div>
    <section class="current-goal">
      <p class="eyebrow">Текущая цель · 6-8 недель</p>
      <h3>Рекомпозиция тела</h3>
      <ul>
        <li>Удерживать средний вес в диапазоне ${currentPlan.currentGoal.weightMinKg}-${currentPlan.currentGoal.weightMaxKg} кг.</li>
        <li>Постепенно увеличивать силовые показатели без заметного роста талии.</li>
        <li>Ориентир по белку: 120-140 г в сутки.</li>
      </ul>
    </section>
    <div class="body-current">
      ${[
        ["weightKg", "Вес", "кг"],
        ["weeklyAverageWeightKg", "Средний вес", "кг"],
        ["bodyFatPercent", "Жир", "%"],
        ["muscleMassKg", "Мышцы", "кг"],
      ].map(([key, label, unit]) => `
        <article>
          <span>${label}</span>
          <strong>${latest[key] === "" || latest[key] === undefined || latest[key] === null ? "—" : `${escapeHtml(formatNumber(latest[key]))} ${unit}`}</strong>
        </article>
      `).join("")}
    </div>
    ${duplicatePairs.length ? `
      <div class="duplicate-warning">
        <strong>Похоже, эта запись дублирует предыдущее измерение.</strong>
        ${duplicatePairs.map((pair) => `
          <div data-duplicate="${escapeHtml(duplicateDecisionKey(pair))}">
            <span>${new Date(pair.previous.date).toLocaleDateString("ru-RU")} и ${new Date(pair.duplicate.date).toLocaleDateString("ru-RU")}</span>
            <button type="button" data-duplicate-action="keep">Оставить</button>
            <button type="button" data-duplicate-action="delete">Удалить запись</button>
            <button type="button" data-duplicate-action="merge">Объединить</button>
          </div>
        `).join("")}
      </div>
    ` : ""}
    <div class="body-trends">
      ${trendChartMarkup("Вес", "weightKg", "кг")}
      ${trendChartMarkup("Средний вес", "weeklyAverageWeightKg", "кг")}
      ${trendChartMarkup("Талия", "waistCm", "см")}
      ${trendChartMarkup("Жир", "bodyFatPercent", "%")}
      ${trendChartMarkup("Мышечная масса", "muscleMassKg", "кг")}
    </div>
    <form class="tracker-form body-form">
      <label><span>Дата</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
      ${bodyMetricFields.map(([key, label, unit]) => `
        <label class="${key === "waistCm" ? "waist-field" : ""}">
          <span>${label}${unit ? `, ${unit}` : ""}</span>
          <input name="${key}" type="text" inputmode="decimal" pattern="^-?\\d*[.,]?\\d*$" value="${escapeHtml(latest[key] ?? "")}" />
        </label>
      `).join("")}
      <p class="waist-reminder is-wide">Добавьте обхват талии — он помогает оценивать прогресс лучше, чем одиночное значение % жира. Поле необязательное.</p>
      <label><span>Общее восстановление</span><select name="recovery">${Object.entries(recoveryOptions).map(([value, label]) => `<option value="${value}" ${latest.recovery === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="is-wide"><span>Комментарий</span><textarea name="comments" placeholder="Сон, питание, тренировки, самочувствие">${escapeHtml(latest.comments || latest.notes || "")}</textarea></label>
      <p class="form-error is-wide" data-body-error role="alert"></p>
      <button type="submit">Сохранить показатели</button>
    </form>
    <details class="body-history">
      <summary>История измерений (${bodyMetrics.entries?.length || 0})</summary>
      <ul>${newestFirst(bodyMetrics.entries || []).map((entry) => `<li><time>${new Date(entry.date).toLocaleDateString("ru-RU")}</time><span>${formatNumber(entry.weightKg)} кг</span><span>талия ${entry.waistCm === "" || entry.waistCm === undefined ? "—" : `${formatNumber(entry.waistCm)} см`}</span><span>${escapeHtml(recoveryOptions[entry.recovery] || "—")}</span></li>`).join("")}</ul>
    </details>
  `;

  els.bodyTracker.querySelector(".body-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const entry = {
      date: form.elements.date.value || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
      comments: form.elements.comments.value.trim(),
      notes: form.elements.comments.value.trim(),
      recovery: form.elements.recovery.value,
    };
    const invalid = [];
    bodyMetricFields.forEach(([key]) => {
      const value = form.elements[key].value;
      const parsed = parseLocaleNumber(value);
      if (value !== "" && parsed === null) invalid.push(key);
      entry[key] = value === "" ? "" : parsed;
    });
    if (invalid.length) {
      form.querySelector("[data-body-error]").textContent = "Проверьте числовые поля: допустимы только числа с точкой или запятой.";
      return;
    }
    const existingIndex = bodyMetrics.entries.findIndex((item) => item.date === entry.date);
    if (existingIndex >= 0) bodyMetrics.entries[existingIndex] = { ...bodyMetrics.entries[existingIndex], ...entry };
    else bodyMetrics.entries.push(entry);
    persistBodyMetrics();
    renderBodyTracker();
    renderDataReview();
  });

  els.bodyTracker.querySelectorAll("[data-duplicate-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const container = button.closest("[data-duplicate]");
      const key = container.dataset.duplicate;
      const pair = duplicatePairs.find((item) => duplicateDecisionKey(item) === key);
      if (!pair) return;
      bodyMetrics.duplicateDecisions = bodyMetrics.duplicateDecisions || {};
      if (button.dataset.duplicateAction === "keep") bodyMetrics.duplicateDecisions[key] = "keep";
      if (button.dataset.duplicateAction === "delete") {
        bodyMetrics.entries = bodyMetrics.entries.filter((entry) => entry !== pair.duplicate);
      }
      if (button.dataset.duplicateAction === "merge") {
        pair.duplicate.comments = [pair.previous.comments || pair.previous.notes, pair.duplicate.comments || pair.duplicate.notes].filter(Boolean).join("; ");
        bodyMetrics.entries = bodyMetrics.entries.filter((entry) => entry !== pair.previous);
      }
      persistBodyMetrics();
      renderBodyTracker();
      renderDataReview();
    });
  });
}

function persistDataReview() {
  dataReviewState.updatedAt = new Date().toISOString();
  localStorage.setItem(dataReviewStorageKey, JSON.stringify(dataReviewState));
  cloudSync?.markLocalChange(dataReviewStorageKey, dataReviewState, dataReviewState.updatedAt);
}

function collectDataIssues() {
  const issues = [];
  Object.entries(exerciseResults.exercises || {}).forEach(([exerciseId, result]) => {
    if (result.workingWeightData?.needsReview) {
      issues.push({ id: `weight:${exerciseId}`, type: "weight", exerciseId, weightTarget: "working", weightData: result.workingWeightData, title: archivedExercises.find((item) => item.id === exerciseId)?.title || exerciseById(exerciseId)?.title || exerciseId, detail: result.workingWeightData.reviewReason, date: result.history?.at(-1)?.date || "" });
    }
    (result.history || []).forEach((entry, index) => {
      if (entry.weightData?.needsReview) issues.push({ id: `weight-history:${exerciseId}:${index}`, type: "weight", exerciseId, weightTarget: "history", historyIndex: index, weightData: entry.weightData, title: archivedExercises.find((item) => item.id === exerciseId)?.title || exerciseById(exerciseId)?.title || exerciseId, detail: `${entry.weightData.reviewReason} Исходное значение: ${entry.weightData.raw || entry.weight || "—"}`, date: entry.date });
    });
    if (result.workingWeight && !(result.history || []).length) {
      issues.push({ id: `no-history:${exerciseId}`, type: "history", exerciseId, title: archivedExercises.find((item) => item.id === exerciseId)?.title || exerciseById(exerciseId)?.title || exerciseId, detail: "Есть рабочий вес, но история упражнения пока отсутствует.", date: "" });
    }
  });

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    const match = /^workout-progress-(\d{4}-W\d{2})$/.exec(key || "");
    if (!match) continue;
    const progress = normalizeProgressV3(loadJson(key, emptyProgress()));
    Object.entries(progress.cardio || {}).forEach(([cardioKey, cardio]) => {
      if (cardio.needsReview) issues.push({ id: `cardio:${match[1]}:${cardioKey}`, type: "cardio", weekKey: match[1], cardioKey, cardio, dayId: cardioKey.slice(0, 3), title: `Кардио · ${match[1]}`, detail: cardio.reviewReason, date: match[1] });
    });
    workouts.forEach((day) => {
      const hasFilledExercise = day.exercises.some((exercise) => progress.exercises?.[exercise.id]);
      if (hasFilledExercise && progress.days?.[day.id] === false) issues.push({ id: `day:${match[1]}:${day.id}`, type: "day", dayId: day.id, title: `${day.day} · ${match[1]}`, detail: "Упражнения заполнены, но день отмечен как невыполненный.", date: match[1] });
    });
  }
  duplicateBodyPairs(bodyMetrics.entries || [], bodyComparisonFields).forEach((pair) => {
    const key = duplicateDecisionKey(pair);
    if (!bodyMetrics.duplicateDecisions?.[key]) issues.push({ id: `duplicate:${key}`, type: "body", title: "Возможный дубликат состава тела", detail: `${pair.previous.date} и ${pair.duplicate.date} полностью совпадают.`, date: pair.duplicate.date });
  });
  return issues.filter((issue) => !dataReviewState.dismissed?.[issue.id]);
}

function reviewEditorMarkup(issue) {
  if (issue.type === "weight") {
    const sourceValue = issue.weightData?.value ?? parseLocaleNumber(issue.weightData?.raw) ?? "";
    const selectedUnit = issue.weightData?.unit === "bodyweight"
      ? "bodyweight"
      : issue.weightData?.perSide ? `per-${issue.weightData.sideLabel || "рука"}` : "kg";
    return `
      <form class="data-review-editor" data-review-editor="weight" hidden>
        <label><span>Вес</span><input name="value" type="text" inputmode="decimal" pattern="^-?\\d*[.,]?\\d*$" value="${escapeHtml(sourceValue)}" /></label>
        <label><span>Единица</span><select name="unit">
          <option value="kg" ${selectedUnit === "kg" ? "selected" : ""}>кг</option>
          <option value="per-рука" ${selectedUnit === "per-рука" ? "selected" : ""}>кг / рука</option>
          <option value="per-сторона" ${selectedUnit === "per-сторона" ? "selected" : ""}>кг / сторона</option>
          <option value="bodyweight" ${selectedUnit === "bodyweight" ? "selected" : ""}>Без веса</option>
        </select></label>
        <button type="submit">Сохранить исправление</button>
        <p class="form-error" data-review-error role="alert"></p>
      </form>
    `;
  }
  if (issue.type === "cardio") {
    const cardio = issue.cardio || {};
    return `
      <form class="data-review-editor data-review-editor--cardio" data-review-editor="cardio" hidden>
        <label><span>Уровень / мощность</span><input name="levelValue" type="text" inputmode="decimal" value="${escapeHtml(cardio.levelValue ?? "")}" /></label>
        <label><span>Минуты</span><input name="minutes" type="text" inputmode="decimal" value="${escapeHtml(cardio.minutes ?? "")}" /></label>
        <label><span>Дистанция</span><input name="distanceValue" type="text" inputmode="decimal" value="${escapeHtml(cardio.distanceValue ?? "")}" /></label>
        <label><span>Единица</span><select name="distanceUnit"><option value="km" ${cardio.distanceUnit !== "m" ? "selected" : ""}>км</option><option value="m" ${cardio.distanceUnit === "m" ? "selected" : ""}>м</option></select></label>
        <label><span>Калории</span><input name="calories" type="text" inputmode="decimal" value="${escapeHtml(cardio.calories ?? "")}" /></label>
        <button type="submit">Сохранить исправление</button>
        <p class="form-error" data-review-error role="alert"></p>
      </form>
    `;
  }
  return "";
}

function saveReviewedWeight(issue, form) {
  const unit = form.elements.unit.value;
  const value = unit === "bodyweight" ? null : parseLocaleNumber(form.elements.value.value);
  if (unit !== "bodyweight" && value === null) throw new Error("Введите корректное числовое значение веса.");
  const weightData = {
    value,
    unit: unit === "bodyweight" ? "bodyweight" : "kg",
    perSide: unit.startsWith("per-"),
    sideLabel: unit.startsWith("per-") ? unit.slice(4) : "рука",
    raw: "",
    needsReview: false,
    reviewReason: "",
    verified: true,
  };
  const result = resultForExercise(issue.exerciseId);
  if (issue.weightTarget === "history") {
    const entry = result.history?.[issue.historyIndex];
    if (!entry) throw new Error("Историческая запись больше не найдена.");
    entry.weightData = weightData;
    entry.weight = formatWeightData(weightData);
  } else {
    result.workingWeightData = weightData;
    result.workingWeight = formatWeightData(weightData);
    if (exerciseById(issue.exerciseId)) {
      saved.weightData[issue.exerciseId] = weightData;
      saved.workingWeights[issue.exerciseId] = result.workingWeight;
      persist();
    }
  }
  persistExerciseResults();
}

function saveReviewedCardio(issue, form) {
  const numericFields = ["levelValue", "minutes", "distanceValue", "calories"];
  const values = Object.fromEntries(numericFields.map((field) => {
    const raw = form.elements[field].value.trim();
    const value = raw === "" ? null : parseLocaleNumber(raw);
    if (raw !== "" && value === null) throw new Error("В числовых полях допустимы только числа с точкой или запятой.");
    return [field, value];
  }));
  const storageKey = `workout-progress-${issue.weekKey}`;
  const progress = normalizeProgressV3(loadJson(storageKey, emptyProgress()));
  progress.cardio[issue.cardioKey] = {
    version: 2,
    ...values,
    distanceUnit: form.elements.distanceUnit.value,
    needsReview: false,
    reviewReason: "",
    legacy: issue.cardio?.legacy || {},
  };
  progress.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey, JSON.stringify(progress));
  cloudSync?.markLocalChange(storageKey, progress, progress.updatedAt);
  if (storageKey === progressStorageKey) replaceObject(saved, { ...progress, notes: saved.notes || {} });
}

function renderDataReview() {
  if (!els.dataReview) return;
  const issues = collectDataIssues();
  els.dataReview.innerHTML = `
    <details>
      <summary><span><strong>Проверка данных</strong><small>Некорректные значения, дубликаты и конфликты</small></span><em>${issues.length}</em></summary>
      <div class="data-review-list">
        ${issues.length ? issues.map((issue) => `
          <article data-issue-id="${escapeHtml(issue.id)}">
            <div><strong>${escapeHtml(issue.title)}</strong><span>${escapeHtml(issue.date || "Без даты")}</span><p>${escapeHtml(issue.detail)}</p></div>
            <div class="data-review-actions"><button type="button" data-review-fix>Исправить</button><button type="button" data-review-dismiss>Оставить как есть</button></div>
            ${reviewEditorMarkup(issue)}
          </article>
        `).join("") : `<p class="empty">Явных конфликтов не найдено.</p>`}
      </div>
      <details class="archive-list"><summary>Архивные упражнения</summary>${archivedExercises.map((item) => {
        const result = exerciseResults.exercises?.[item.id];
        const history = newestFirst(result?.history || []);
        return `<article><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(result?.workingWeight || item.lastWeight)}</span><p>${escapeHtml(item.note)}</p></div><details class="archive-history"><summary>История (${history.length})</summary>${history.length ? `<ul>${history.map((entry) => `<li><time>${new Date(entry.date).toLocaleDateString("ru-RU")}</time><span>${escapeHtml(entry.weight || "—")}</span><span>${escapeHtml(performanceText(entry) || "—")}</span><strong>${escapeHtml(effortReportLabels[entry.feedback] || "не отмечено")}</strong></li>`).join("")}</ul>` : `<p>История пока пуста.</p>`}</details></article>`;
      }).join("")}</details>
    </details>
  `;
  els.dataReview.querySelectorAll("[data-review-dismiss]").forEach((button) => {
    button.addEventListener("click", () => {
      const issueId = button.closest("[data-issue-id]").dataset.issueId;
      dataReviewState.dismissed = { ...(dataReviewState.dismissed || {}), [issueId]: true };
      persistDataReview();
      renderDataReview();
    });
  });
  els.dataReview.querySelectorAll("[data-review-fix]").forEach((button) => {
    button.addEventListener("click", () => {
      const issue = issues.find((item) => item.id === button.closest("[data-issue-id]").dataset.issueId);
      if (!issue) return;
      const editor = button.closest("[data-issue-id]").querySelector("[data-review-editor]");
      if (editor) {
        editor.hidden = !editor.hidden;
        if (!editor.hidden) editor.querySelector("input, select")?.focus({ preventScroll: true });
        return;
      }
      if (issue.type === "body") return els.bodyTracker.scrollIntoView({ behavior: "smooth", block: "start" });
      const day = issue.dayId ? workouts.find((item) => item.id === issue.dayId) : dayForExercise(issue.exerciseId);
      if (day) {
        state.activeDayId = day.id;
        renderDayDetails();
        document.querySelector(`[data-exercise-id="${issue.exerciseId || ""}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });
  els.dataReview.querySelectorAll("[data-review-editor]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const issue = issues.find((item) => item.id === form.closest("[data-issue-id]").dataset.issueId);
      if (!issue) return;
      try {
        if (form.dataset.reviewEditor === "weight") saveReviewedWeight(issue, form);
        if (form.dataset.reviewEditor === "cardio") saveReviewedCardio(issue, form);
        renderDataReview();
        renderDayDetails();
      } catch (error) {
        form.querySelector("[data-review-error]").textContent = error.message;
      }
    });
  });
}

function renderLists() {
  els.safetyList.innerHTML = safety.map((item) => `<li>${item}</li>`).join("");
  els.progressionList.innerHTML = progression.map((item) => `<li>${item}</li>`).join("");
}

function renderCloudSyncStatus({ configured, status, message, user, online, diagnostics, outboxCount = 0 }) {
  if (!els.cloudSync) return;
  lastCloudSyncPayload = { configured, status, message, user, online, diagnostics, outboxCount };
  const signedIn = Boolean(user);
  const cooldownSeconds = authLinkCooldownSeconds();
  const hasUnsynced = outboxCount > 0;
  const statusText = message || {
    unconfigured: "Нужно добавить настройки Supabase",
    "signed-out": "Войдите, чтобы синхронизировать устройства",
    ready: "Готово к синхронизации",
    syncing: "Синхронизация...",
    synced: "Данные синхронизированы",
    offline: "Офлайн: изменения сохраняются на устройстве",
    error: "Ошибка синхронизации",
    "email-sent": "Код отправлен на почту",
    "email-sending": "Отправляем код...",
    "otp-verifying": "Проверяем код...",
  }[status] || "";
  const authStatusText = authLinkSubmitting
    ? "Отправляем код..."
    : `Код отправлен. Проверьте почту. Повторно можно запросить через ${cooldownSeconds} сек.`;

  els.cloudSync.dataset.status = status;
  els.cloudSync.querySelector(".cloud-sync__status").textContent =
    signedIn && hasUnsynced && status !== "syncing" && status !== "error"
      ? "Есть несинхронизированные изменения"
      : !signedIn && configured && cooldownSeconds > 0 && status !== "error" ? authStatusText : statusText;
  els.cloudSync.querySelector(".cloud-sync__account").textContent = signedIn ? user.email : "";
  els.cloudSync.querySelector(".cloud-sync__login").hidden = signedIn || !configured;
  els.cloudSync.querySelector(".cloud-sync__session").hidden = !signedIn;
  els.cloudSync.querySelector(".cloud-sync__setup").hidden = configured;
  els.cloudSync.querySelector("[data-sync-now]").disabled = !online || status === "syncing";
  const loginButton = els.cloudSync.querySelector("[data-send-otp]");
  const verifyButton = els.cloudSync.querySelector("[data-verify-otp]");
  if (loginButton) {
    const disabled = authLinkSubmitting || cooldownSeconds > 0 || !online;
    loginButton.disabled = disabled;
    loginButton.textContent = cooldownSeconds > 0 ? `Повтор через ${cooldownSeconds} сек` : "Получить код";
  }
  if (verifyButton) {
    verifyButton.disabled = authOtpSubmitting || !online;
    verifyButton.textContent = authOtpSubmitting ? "Проверяем..." : "Войти по коду";
  }
  const diagnosticsNode = els.cloudSync.querySelector(".cloud-sync__diagnostics");
  const showDiagnostics = Boolean(diagnostics?.requestUrl || diagnostics?.response);
  diagnosticsNode.hidden = !showDiagnostics;
  if (showDiagnostics) {
    const values = {
      "supabase-url": diagnostics.supabaseUrl || "—",
      "request-url": diagnostics.requestUrl || "—",
      status: diagnostics.status || "—",
      code: diagnostics.code || "—",
      response: diagnostics.response || "—",
    };
    Object.entries(values).forEach(([key, value]) => {
      diagnosticsNode.querySelector(`[data-diagnostic="${key}"]`).textContent = value;
    });
  }
  scheduleAuthLinkCooldownRender();
}

function authLinkCooldownSeconds() {
  const cooldownUntil = Number(localStorage.getItem(authLinkCooldownStorageKey) || 0);
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

function startAuthLinkCooldown() {
  localStorage.setItem(authLinkCooldownStorageKey, String(Date.now() + authLinkCooldownMs));
  scheduleAuthLinkCooldownRender();
}

function scheduleAuthLinkCooldownRender() {
  window.clearTimeout(authLinkCooldownTimer);
  if (authLinkCooldownSeconds() <= 0 || !lastCloudSyncPayload) return;
  authLinkCooldownTimer = window.setTimeout(() => renderCloudSyncStatus(lastCloudSyncPayload), 1000);
}

function cloudAuthErrorMessage(error) {
  const responseCode = error?.code || error?.error_code || error?.diagnostics?.code || "";
  if (responseCode === "over_email_send_rate_limit") {
    return "Слишком много запросов. Подождите 10–20 минут и попробуйте снова.";
  }
  if (responseCode === "email_address_invalid") {
    return "Проверьте адрес почты и попробуйте ещё раз.";
  }
  if (responseCode === "otp_expired" || responseCode === "otp_disabled") {
    return "Код устарел или недействителен. Запросите новый код и попробуйте снова.";
  }
  if (["bad_code_verifier", "validation_failed", "invalid_grant"].includes(responseCode)) {
    return "Проверьте код из письма и попробуйте ещё раз.";
  }
  return "Не удалось выполнить вход. Попробуйте позже.";
}

function transferStatus(message, isError = false) {
  const node = els.cloudSync?.querySelector(".cloud-sync__transfer-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function backupTextarea() {
  return els.cloudSync?.querySelector("[data-backup-json]");
}

function exportBackupText() {
  const backup = createWorkoutBackup();
  const text = JSON.stringify(backup, null, 2);
  backupTextarea().value = text;
  transferStatus(`Экспорт готов: ${backup.records.length} записей. Скачайте файл или скопируйте JSON.`);
  return text;
}

function downloadBackup() {
  const text = exportBackupText();
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyBackup() {
  const text = exportBackupText();
  try {
    await navigator.clipboard.writeText(text);
    transferStatus("JSON скопирован в буфер обмена.");
  } catch {
    transferStatus("JSON показан в поле. Если копирование не сработало, выделите и скопируйте его вручную.");
    backupTextarea().focus({ preventScroll: true });
    backupTextarea().select();
  }
}

async function readImportFile(file) {
  if (!file) return;
  const text = await file.text();
  backupTextarea().value = text;
  transferStatus("Файл загружен в поле импорта. Проверьте и нажмите «Импорт данных».");
}

function importBackupFromTextarea() {
  const text = backupTextarea().value.trim();
  if (!text) {
    transferStatus("Вставьте JSON или выберите файл импорта.", true);
    return;
  }
  let records;
  try {
    records = normalizeBackupRecords(text);
  } catch (error) {
    transferStatus(error.message || "Не удалось прочитать JSON импорта.", true);
    return;
  }

  const approved = window.confirm(
    "Будут добавлены или обновлены данные методички. Существующие более новые записи сохранятся.",
  );
  if (!approved) {
    transferStatus("Импорт отменён.");
    return;
  }

  try {
    const result = importWorkoutBackup(records);
    transferStatus(`Импорт завершён: обновлено ${result.updated}, сохранено более новых ${result.skipped}.`);
    if (result.updated) cloudSync?.syncNow();
  } catch (error) {
    transferStatus(error.message || "Не удалось импортировать данные.", true);
  }
}

function initBackupTransfer() {
  const root = els.cloudSync;
  if (!root) return;
  root.querySelector("[data-export-backup]").addEventListener("click", downloadBackup);
  root.querySelector("[data-copy-backup]").addEventListener("click", copyBackup);
  root.querySelector("[data-import-file]").addEventListener("change", (event) => {
    readImportFile(event.target.files?.[0]).catch((error) => {
      transferStatus(error.message || "Не удалось прочитать файл.", true);
    });
  });
  root.querySelector("[data-import-backup]").addEventListener("click", importBackupFromTextarea);
  backupTextarea().addEventListener("click", (event) => event.stopPropagation());
  backupTextarea().addEventListener("keydown", (event) => event.stopPropagation());
}

function initCloudSync() {
  if (!els.cloudSync) return;
  cloudSync = createWorkoutCloudSync({
    onStatus: renderCloudSyncStatus,
    onRemoteApplied: applyRemoteData,
  });
  initBackupTransfer();

  els.cloudSync.querySelector(".cloud-sync__login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    if (!email || authLinkSubmitting || authLinkCooldownSeconds() > 0) return;
    authLinkSubmitting = true;
    renderCloudSyncStatus({
      configured: cloudSync.configured,
      status: "email-sending",
      user: null,
      online: navigator.onLine,
    });
    try {
      await cloudSync.signIn(email);
      startAuthLinkCooldown();
    } catch (error) {
      if ((error?.code || error?.diagnostics?.code) === "over_email_send_rate_limit") {
        startAuthLinkCooldown();
      }
      renderCloudSyncStatus({
        configured: cloudSync.configured,
        status: "error",
        message: cloudAuthErrorMessage(error),
        user: null,
        online: navigator.onLine,
        diagnostics: error.diagnostics,
      });
    } finally {
      authLinkSubmitting = false;
      if (lastCloudSyncPayload) renderCloudSyncStatus(lastCloudSyncPayload);
    }
  });

  els.cloudSync.querySelector("[data-verify-otp]").addEventListener("click", async (event) => {
    event.preventDefault();
    const form = els.cloudSync.querySelector(".cloud-sync__login");
    const email = form.elements.email.value.trim();
    const token = form.elements.otp.value.trim().replace(/\s+/g, "");
    if (!email || !token || authOtpSubmitting) return;
    authOtpSubmitting = true;
    renderCloudSyncStatus({
      configured: cloudSync.configured,
      status: "otp-verifying",
      user: null,
      online: navigator.onLine,
    });
    try {
      await cloudSync.verifyOtp(email, token);
    } catch (error) {
      renderCloudSyncStatus({
        configured: cloudSync.configured,
        status: "error",
        message: cloudAuthErrorMessage(error),
        user: null,
        online: navigator.onLine,
        diagnostics: error.diagnostics,
      });
    } finally {
      authOtpSubmitting = false;
      if (lastCloudSyncPayload) renderCloudSyncStatus(lastCloudSyncPayload);
    }
  });

  els.cloudSync.querySelector("[data-sync-now]").addEventListener("click", () => cloudSync.syncNow());
  els.cloudSync.querySelector("[data-sign-out]").addEventListener("click", async () => {
    try {
      await cloudSync.signOut();
    } catch (error) {
      renderCloudSyncStatus({
        configured: cloudSync.configured,
        status: "error",
        message: error.message,
        user: null,
        online: navigator.onLine,
        diagnostics: error.diagnostics,
      });
    }
  });
  cloudSync.init();
}

function selectDay(dayId) {
  state.activeDayId = dayId;
  render();
  document.querySelector("#dayDetails").scrollIntoView({ behavior: "smooth", block: "start" });
}

function ensureActiveDayVisible() {
  const days = visibleWorkouts();
  if (days.length && !days.some((day) => day.id === state.activeDayId)) {
    state.activeDayId = days[0].id;
  }
}

function render() {
  renderPills();
  renderFilters();
  renderWeek();
  renderDayDetails();
  renderHistory();
  renderLoadSummary();
  renderWeeklyReport();
  renderBodyTracker();
  renderDataReview();
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  ensureActiveDayVisible();
  render();
});

els.quickMode.addEventListener("change", (event) => {
  state.quickMode = event.target.checked;
  renderDayDetails();
});

els.todayButton.addEventListener("click", () => selectDay(todayWorkoutId()));

renderLists();
migrateWeeklyDataV3();
migrateFridayPoolCompletion();
syncAllDayCompletion();
persist({ sync: false, touch: false });
if (!localStorage.getItem(bodyMetricsStorageKey)) {
  persistBodyMetrics({ sync: false, touch: false });
}
render();
initCloudSync();
