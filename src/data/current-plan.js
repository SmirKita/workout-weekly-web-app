const kg = (value, perSide = false) => ({
  value,
  unit: "kg",
  perSide,
  sideLabel: "рука",
  raw: "",
  needsReview: false,
  reviewReason: "",
  verified: true,
});

const bodyweight = () => ({
  value: null,
  unit: "bodyweight",
  perSide: false,
  sideLabel: "рука",
  raw: "Без веса",
  needsReview: false,
  reviewReason: "",
  verified: true,
});

const plan = (day, weight, targetSets, targetReps, options = {}) => ({
  day,
  currentWeightData: weight,
  targetSets,
  targetReps,
  recommendedNextWeightData: null,
  previousWeightData: options.previousWeightData || null,
  techniqueNote: options.techniqueNote || "",
  progressionState: options.progressionState || "hold",
  nextStepText: options.nextStepText || "",
});

export const CURRENT_PLAN_VERSION = 4;
export const currentPlanStorageKey = "workout-current-plan:v4";

// Единственный seed актуального плана. Недельные workout-progress-* сюда не
// подмешиваются: они являются снимками фактически выполненных тренировок.
export const currentPlanDefaults = {
  "leg-press": plan("mon", kg(65), 3, "10-12", {
    previousWeightData: kg(60),
    progressionState: "trial-accepted",
    nextStepText: "Если на тренажёре после 60 кг доступно только 70 кг, вес можно быстро изменить перед подходом.",
  }),
  "leg-extension": plan("mon", kg(30), 3, "12-15", {
    progressionState: "technique-first",
    nextStepText: "Оставить 30 кг и сначала добиться стабильной техники.",
  }),
  "lying-leg-curl": plan("mon", kg(25), 3, "10-12", {
    progressionState: "technique-first",
    nextStepText: "Вес пока не повышать: последние подходы были с RIR 1 и нестабильной техникой.",
  }),
  "hip-thrust": plan("mon", kg(10), 3, "10-12", { nextStepText: "Оставить текущую нагрузку." }),
  "romanian-deadlift": plan("mon", kg(16, true), 3, "8-10", {
    previousWeightData: kg(14, true),
    progressionState: "trial-accepted",
    nextStepText: "Оценить новый вес. Если техника нестабильна, вручную вернуться к 14 кг / рука.",
  }),
  "pallof-press": plan("mon", kg(10), 3, "10-12", { nextStepText: "Оставить текущую нагрузку." }),

  "lat-pulldown": plan("wed", kg(45), 3, "10-12", {
    previousWeightData: kg(40),
    progressionState: "trial-accepted",
    nextStepText: "Если 45 кг нет, выбрать следующую доступную ступень после 40 кг.",
  }),
  "seated-row": plan("wed", kg(40), 3, "10-12", { previousWeightData: kg(35), progressionState: "accepted" }),
  "chest-press": plan("wed", kg(40), 3, "10-12", { previousWeightData: kg(35), progressionState: "accepted" }),
  "straight-arm-pulldown": plan("wed", kg(15), 3, "12-15"),
  "reverse-fly": plan("wed", kg(15), 3, "12-15", { nextStepText: "Вес не повышать, сохранять контроль движения." }),
  "face-pull-wed": plan("wed", kg(15), 3, "12-15", { nextStepText: "Вес не повышать, сохранять контроль движения." }),

  plank: plan("thu", bodyweight(), 2, "20-30 сек"),
  "side-plank": plan("thu", bodyweight(), 2, "15-20 сек"),
  crunches: plan("thu", bodyweight(), 2, "10-12"),
  "leg-raise": plan("thu", bodyweight(), 2, "8-10"),
  "russian-twist": plan("thu", kg(5), 2, "10-12"),
  "dead-bug": plan("thu", bodyweight(), 2, "8-10"),
  superman: plan("thu", bodyweight(), 2, "8-10"),
  "bird-dog": plan("thu", bodyweight(), 2, "8-10"),

  "sat-leg-press": plan("sat", kg(60), 2, "10-12", {
    progressionState: "light-secondary",
    nextStepText: "Оставить лёгким вторым стимулом; не повышать вместе с понедельничным жимом ногами.",
  }),
  "sat-chest-press": plan("sat", kg(40), 3, "10-12", { previousWeightData: kg(35), progressionState: "accepted" }),
  "sat-seated-row": plan("sat", kg(40), 3, "10-12", { previousWeightData: kg(35), progressionState: "accepted" }),
  "shoulder-press": plan("sat", kg(9, true), 3, "8-10", {
    previousWeightData: kg(8, true),
    progressionState: "trial-accepted",
    nextStepText: "Если нет 9 кг — первый пробный подход 10 кг × 8. Если техника хорошая, продолжить; если нет — вернуться к 8 кг.",
  }),
  "lateral-raise": plan("sat", kg(5, true), 3, "12-15", { nextStepText: "Не повышать: сначала стабильная техника." }),
  "face-pull-sat": plan("sat", kg(15), 3, "12-15", { nextStepText: "Не повышать; акцент на контроле движения." }),
  "biceps-curl": plan("sat", kg(8, true), 3, "10-12"),
  "hammer-curl": plan("sat", kg(8, true), 3, "10-12", { previousWeightData: kg(7, true), progressionState: "accepted" }),
  "triceps-pushdown": plan("sat", kg(17.5), 3, "10-12", {
    previousWeightData: kg(15),
    progressionState: "trial-accepted",
    nextStepText: "Если 17,5 кг нет и следующая ступень 20 кг, начать с 10 повторений.",
  }),
  "close-grip-push-up": plan("sat", bodyweight(), 3, "6-12", {
    techniqueNote: "Опускание 2–3 секунды.",
    nextStepText: "Сохранять медленное контролируемое опускание.",
  }),
};

export const currentGoal = {
  type: "recomposition",
  weightMinKg: 76,
  weightMaxKg: 77,
  priority: "strength-up-waist-stable",
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createCurrentPlan(stored = null) {
  const source = stored?.exercises || {};
  const exercises = {};
  Object.entries(currentPlanDefaults).forEach(([exerciseId, defaults]) => {
    const existing = source[exerciseId] || {};
    exercises[exerciseId] = {
      ...clone(defaults),
      ...existing,
      // Значения этого задания уже приняты и применяются один раз при переходе
      // на v4. После миграции ручные правки пользователя сохраняются.
      ...(stored?.version === CURRENT_PLAN_VERSION ? {} : clone(defaults)),
      recommendedNextWeightData: stored?.version === CURRENT_PLAN_VERSION
        ? (existing.recommendedNextWeightData || null)
        : null,
    };
  });
  return {
    version: CURRENT_PLAN_VERSION,
    exercises,
    currentGoal: stored?.version === CURRENT_PLAN_VERSION ? { ...currentGoal, ...(stored.currentGoal || {}) } : clone(currentGoal),
    migrations: { ...(stored?.migrations || {}), "accepted-plan-2026-08-29": true },
    updatedAt: stored?.updatedAt || "",
  };
}

export function acceptRecommendation(planState, exerciseId) {
  const entry = planState.exercises?.[exerciseId];
  if (!entry?.recommendedNextWeightData) return false;
  entry.previousWeightData = entry.currentWeightData;
  entry.currentWeightData = entry.recommendedNextWeightData;
  entry.recommendedNextWeightData = null;
  entry.progressionState = "evaluate-new-weight";
  entry.nextStepText = "Оценить новый вес после выполнения.";
  return true;
}

export function effortCategory(value) {
  const score = Number(value);
  if (score >= 9) return "На пределе";
  if (score >= 7) return "Тяжело";
  if (score >= 4) return "Умеренно";
  if (score >= 1) return "Легко";
  return "Не оценено";
}

export function calculateSessionEffort(entries = []) {
  const completed = entries.filter((entry) => Number.isInteger(entry.effortRating) && entry.effortRating >= 1 && entry.effortRating <= 10 && entry.completedWorkingSets > 0);
  const totalSets = completed.reduce((sum, entry) => sum + entry.completedWorkingSets, 0);
  const exact = totalSets
    ? completed.reduce((sum, entry) => sum + entry.effortRating * entry.completedWorkingSets, 0) / totalSets
    : null;
  return {
    exact: exact === null ? null : Math.round(exact * 10) / 10,
    recommended: exact === null ? null : Math.round(exact),
    ratedExercises: completed.length,
    totalExercises: entries.length,
    completedWorkingSets: entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.completedWorkingSets) || 0), 0),
  };
}

export function planRows(planState) {
  return Object.entries(planState.exercises).map(([exerciseId, entry]) => ({ exerciseId, ...entry }));
}

export function validateCurrentPlan(planState, activeIds) {
  const errors = [];
  const ids = new Set(activeIds);
  Object.entries(planState.exercises || {}).forEach(([exerciseId, entry]) => {
    if (!ids.has(exerciseId)) errors.push(`${exerciseId}: отсутствует в активной программе`);
    if (!entry.currentWeightData) errors.push(`${exerciseId}: нет currentWeightData`);
    if (!Number.isInteger(entry.targetSets) || entry.targetSets < 1) errors.push(`${exerciseId}: некорректные подходы`);
    if (!entry.targetReps) errors.push(`${exerciseId}: нет диапазона повторов`);
    if (entry.recommendedNextWeightData && JSON.stringify(entry.recommendedNextWeightData) === JSON.stringify(entry.currentWeightData)) {
      errors.push(`${exerciseId}: текущий и рекомендуемый следующий вес совпадают`);
    }
  });
  ["biceps-curl-machine", "front-raise"].forEach((id) => {
    if (ids.has(id)) errors.push(`${id}: архивное упражнение попало в активный план`);
  });
  return errors;
}
