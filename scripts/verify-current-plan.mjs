import { workouts, archivedExercises } from "../src/data/workouts.js";
import {
  createCurrentPlan,
  planRows,
  validateCurrentPlan,
} from "../src/data/current-plan.js";
import { formatWeightData } from "../src/scripts/data-model.js";
import assert from "node:assert/strict";
import { calculateSessionEffort } from "../src/data/current-plan.js";

const plan = createCurrentPlan();
const activeIds = workouts.flatMap((day) => day.exercises.map((exercise) => exercise.id));
const errors = validateCurrentPlan(plan, activeIds);
const rows = planRows(plan).map((entry) => ({
  exerciseId: entry.exerciseId,
  day: entry.day.toUpperCase(),
  currentWeight: formatWeightData(entry.currentWeightData),
  sets: entry.targetSets,
  reps: entry.targetReps,
  recommendedNextWeight: entry.recommendedNextWeightData ? formatWeightData(entry.recommendedNextWeightData) : "—",
}));

const rowIds = new Set(rows.map((row) => row.exerciseId));
const expected = {
  "leg-press": [65, 3, "10-12"], "leg-extension": [30, 3, "12-15"], "lying-leg-curl": [25, 3, "10-12"],
  "hip-thrust": [10, 3, "10-12"], "romanian-deadlift": [16, 3, "8-10"], "pallof-press": [10, 3, "10-12"],
  "lat-pulldown": [45, 3, "10-12"], "seated-row": [40, 3, "10-12"], "chest-press": [40, 3, "10-12"],
  "straight-arm-pulldown": [15, 3, "12-15"], "reverse-fly": [15, 3, "12-15"], "face-pull-wed": [15, 3, "12-15"],
  "sat-leg-press": [60, 2, "10-12"], "sat-chest-press": [40, 3, "10-12"], "sat-seated-row": [40, 3, "10-12"],
  "shoulder-press": [9, 3, "8-10"], "lateral-raise": [5, 3, "12-15"], "face-pull-sat": [15, 3, "12-15"],
  "biceps-curl": [8, 3, "10-12"], "hammer-curl": [8, 3, "10-12"], "triceps-pushdown": [17.5, 3, "10-12"],
  "close-grip-push-up": [null, 3, "6-12"],
};
Object.entries(expected).forEach(([exerciseId, [weight, sets, reps]]) => {
  const entry = plan.exercises[exerciseId];
  assert.ok(entry, `${exerciseId}: отсутствует`);
  assert.equal(entry.currentWeightData.value, weight, `${exerciseId}: неверный вес`);
  assert.equal(entry.targetSets, sets, `${exerciseId}: неверные подходы`);
  assert.equal(entry.targetReps, reps, `${exerciseId}: неверные повторы`);
});
archivedExercises.forEach((exercise) => {
  if (rowIds.has(exercise.id)) errors.push(`${exercise.id}: архивное упражнение попало в currentPlan`);
});

for (const [left, right] of [["leg-press", "sat-leg-press"], ["chest-press", "sat-chest-press"], ["seated-row", "sat-seated-row"]]) {
  if (!rowIds.has(left) || !rowIds.has(right)) errors.push(`Не найдена независимая пара ${left} / ${right}`);
}

const effort = calculateSessionEffort([
  { effortRating: 7, completedWorkingSets: 3 },
  { effortRating: 6, completedWorkingSets: 3 },
  { effortRating: 4, completedWorkingSets: 2 },
]);
assert.equal(effort.exact, 5.88);
assert.equal(effort.rounded, 6);

console.table(rows);
if (errors.length) throw new Error(`Ошибки currentPlan:\n${errors.join("\n")}`);
console.log(`currentPlan OK: ${rows.length} активных силовых/кор-упражнений, архив не смешан.`);
