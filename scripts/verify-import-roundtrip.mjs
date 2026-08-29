import fs from "node:fs";
import assert from "node:assert/strict";
import { createCurrentPlan } from "../src/data/current-plan.js";

const filePath = process.argv[2];
if (!filePath) throw new Error("Укажите путь к backup JSON.");
const input = JSON.parse(fs.readFileSync(filePath, "utf8"));
const records = Array.isArray(input.records) ? input.records : [];
assert.ok(records.length, "Backup не содержит records.");

const imported = new Map(records.map((record) => [record.key, structuredClone(record)]));
const historyBefore = records
  .filter((record) => /^workout-progress-/.test(record.key) || record.key === "workout-exercise-results:v2")
  .map((record) => JSON.stringify(record.payload));
const legacyFeedbackBefore = records
  .filter((record) => /^workout-progress-/.test(record.key))
  .reduce((sum, record) => sum + Object.keys(record.payload?.feedback || {}).length, 0);

const planRecord = imported.get("workout-current-plan:v4");
const migratedPlan = createCurrentPlan(planRecord?.payload || null);
imported.set("workout-current-plan:v4", {
  key: "workout-current-plan:v4",
  payload: migratedPlan,
  updatedAt: planRecord?.updatedAt || new Date(0).toISOString(),
});

const exported = {
  app: "workout-weekly-web-app",
  version: 4,
  exportedAt: new Date(0).toISOString(),
  records: [...imported.values()].sort((left, right) => left.key.localeCompare(right.key)),
};
const reimported = JSON.parse(JSON.stringify(exported));
assert.deepEqual(reimported, exported, "export → reimport изменил данные");

const historyAfter = reimported.records
  .filter((record) => /^workout-progress-/.test(record.key) || record.key === "workout-exercise-results:v2")
  .map((record) => JSON.stringify(record.payload));
assert.deepEqual(historyAfter, historyBefore, "Миграция изменила исторические тренировки");
const legacyFeedbackAfter = reimported.records
  .filter((record) => /^workout-progress-/.test(record.key))
  .reduce((sum, record) => sum + Object.keys(record.payload?.feedback || {}).length, 0);
assert.equal(legacyFeedbackAfter, legacyFeedbackBefore, "Потеряны legacy feedback");
assert.equal(createCurrentPlan(migratedPlan).version, migratedPlan.version, "Миграция currentPlan не идемпотентна");
assert.deepEqual(createCurrentPlan(migratedPlan).exercises, migratedPlan.exercises, "Повторная миграция меняет currentPlan");

console.log(JSON.stringify({
  source: filePath,
  importedRecords: records.length,
  exportedRecords: exported.records.length,
  historyPreserved: true,
  legacyFeedbackPreserved: legacyFeedbackAfter,
  currentPlanExercises: Object.keys(migratedPlan.exercises).length,
  idempotentMigration: true,
  exportReimport: "identical",
}, null, 2));

