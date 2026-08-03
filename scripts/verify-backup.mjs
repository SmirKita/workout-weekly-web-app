import fs from "node:fs";
import {
  duplicateBodyPairs,
  normalizeCardioEntry,
  normalizeWeightData,
} from "../src/scripts/data-model.js";

const filePath = process.argv[2];
if (!filePath) throw new Error("Укажите путь к backup JSON.");

const original = JSON.parse(fs.readFileSync(filePath, "utf8"));
const records = Array.isArray(original.records) ? original.records : [];
const exerciseRecord = records.find((record) => record.key === "workout-exercise-results:v2");
const bodyRecord = records.find((record) => record.key === "workout-body-metrics:v1");
const progressRecords = records.filter((record) => /^workout-progress-/.test(record.key));

const weightIssues = [];
Object.entries(exerciseRecord?.payload?.exercises || {}).forEach(([exerciseId, result]) => {
  const working = normalizeWeightData(result.workingWeight);
  if (working.needsReview) weightIssues.push(`${exerciseId}: ${result.workingWeight}`);
  (result.history || []).forEach((entry) => {
    const weight = normalizeWeightData(entry.weight);
    if (weight.needsReview) weightIssues.push(`${exerciseId} @ ${entry.weekKey}: ${entry.weight}`);
  });
});

const cardioIssues = [];
progressRecords.forEach((record) => {
  Object.entries(record.payload?.cardio || {}).forEach(([key, entry]) => {
    const normalized = normalizeCardioEntry(entry);
    if (normalized.needsReview) cardioIssues.push(`${record.key}/${key}: ${normalized.reviewReason}`);
  });
});

const bodyFields = [
  "weightKg", "bodyFatPercent", "waterPercent", "visceralFat", "subcutaneousFatPercent",
  "musclePercent", "muscleMassKg", "skeletalMusclePercent", "fatFreeMassKg", "boneMassKg",
  "proteinPercent", "bmrKcal", "biologicalAge", "waistCm",
];
const duplicates = duplicateBodyPairs(bodyRecord?.payload?.entries || [], bodyFields);

const roundTrip = JSON.parse(JSON.stringify(original));
if (roundTrip.records.length !== records.length) throw new Error("Round-trip изменил количество записей.");
if ((roundTrip.records.find((record) => record.key === "workout-exercise-results:v2")?.payload?.exercises && Object.keys(roundTrip.records.find((record) => record.key === "workout-exercise-results:v2").payload.exercises).length) !== Object.keys(exerciseRecord?.payload?.exercises || {}).length) {
  throw new Error("Round-trip изменил количество упражнений.");
}

console.log(JSON.stringify({
  records: records.length,
  exerciseCount: Object.keys(exerciseRecord?.payload?.exercises || {}).length,
  progressWeeks: progressRecords.length,
  weightIssues,
  cardioIssues,
  duplicateDates: duplicates.map((pair) => [pair.previous.date, pair.duplicate.date]),
  roundTrip: "ok",
}, null, 2));
