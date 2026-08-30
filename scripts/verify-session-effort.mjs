import assert from "node:assert/strict";
import { calculateSessionEffort } from "../src/data/current-plan.js";

const calculated = (entries) => calculateSessionEffort(entries.map((entry) => ({ completed: true, ...entry })));

// 1. Взвешивание по фактически выполненным подходам и обычное округление.
const weighted = calculated([
  { effortRating: 6, completedWorkingSets: 3 },
  { effortRating: 8, completedWorkingSets: 3 },
  { effortRating: 5, completedWorkingSets: 2 },
]);
assert.equal(weighted.exact, 6.5);
assert.equal(weighted.rounded, 7);
assert.equal(weighted.completedSets, 8);
assert.equal(weighted.complete, true);

// 2. Неуказанный Effort не превращается в 0 и делает итог предварительным.
const missingRating = calculated([
  { effortRating: 6, completedWorkingSets: 3 },
  { effortRating: null, completedWorkingSets: 3 },
]);
assert.equal(missingRating.exact, 6);
assert.equal(missingRating.ratedExercises, 1);
assert.equal(missingRating.completedExercises, 2);
assert.equal(missingRating.complete, false);

// 3. Пропущенное упражнение не участвует ни в числителе, ни в знаменателе.
const skipped = calculateSessionEffort([
  { completed: true, effortRating: 6, completedWorkingSets: 3 },
  { completed: false, effortRating: 10, completedWorkingSets: 3 },
]);
assert.equal(skipped.exact, 6);
assert.equal(skipped.completedExercises, 1);

// 4. Изменение Effort немедленно меняет чистый результат функции.
const beforeChange = calculated([{ effortRating: 5, completedWorkingSets: 3 }]);
const afterChange = calculated([{ effortRating: 8, completedWorkingSets: 3 }]);
assert.equal(beforeChange.rounded, 5);
assert.equal(afterChange.rounded, 8);

// 5. При двух фактических подходах множитель равен 2, а не плановым 3.
const actualSets = calculated([
  { effortRating: 8, completedWorkingSets: 2 },
  { effortRating: 4, completedWorkingSets: 3 },
]);
assert.equal(actualSets.exact, 5.6);
assert.equal(actualSets.completedSets, 5);

// Особые старые данные без числа подходов получают ровно один голос.
const fallback = calculated([
  { effortRating: 9, completedWorkingSets: 0 },
  { effortRating: 5, completedWorkingSets: 3 },
]);
assert.equal(fallback.exact, 6);
assert.equal(fallback.completedSets, 4);

// Без оценок не показывается нулевой результат.
const empty = calculateSessionEffort([]);
assert.equal(empty.exact, null);
assert.equal(empty.rounded, null);

console.log("Session Effort OK: 6 сценариев, включая weighted 6.5 → 7, пропуски и fallback.");

