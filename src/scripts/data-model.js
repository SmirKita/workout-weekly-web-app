export function parseLocaleNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumber(value) {
  const number = parseLocaleNumber(value);
  if (number === null) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(number);
}

export function normalizeWeightData(value, { perSide = false, sideLabel = "рука" } = {}) {
  if (value && typeof value === "object" && "unit" in value) {
    return {
      value: parseLocaleNumber(value.value),
      unit: value.unit || "kg",
      perSide: Boolean(value.perSide),
      sideLabel: value.sideLabel || sideLabel,
      raw: value.raw || "",
      needsReview: Boolean(value.needsReview),
      reviewReason: value.reviewReason || "",
      verified: Boolean(value.verified),
    };
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return { value: null, unit: "kg", perSide, sideLabel, raw, needsReview: false, reviewReason: "", verified: false };
  }
  if (/без\s*веса|вес\s*тела/i.test(raw)) {
    return { value: null, unit: "bodyweight", perSide: false, sideLabel, raw, needsReview: false, reviewReason: "", verified: true };
  }

  const match = /^(\d+(?:[.,]\d+)?)\s*(кг)?(?:\s*\/\s*(рука|сторона))?$/i.exec(raw);
  if (!match) {
    return {
      value: null,
      unit: "kg",
      perSide,
      sideLabel,
      raw,
      needsReview: true,
      reviewReason: "Не удалось однозначно распознать вес.",
      verified: false,
    };
  }

  const explicitSide = match[3];
  const hasUnit = Boolean(match[2]);
  return {
    value: parseLocaleNumber(match[1]),
    unit: "kg",
    perSide: Boolean(explicitSide) || perSide,
    sideLabel: explicitSide || sideLabel,
    raw,
    needsReview: !hasUnit,
    reviewReason: hasUnit ? "" : "В старой записи не указана единица измерения.",
    verified: hasUnit,
  };
}

export function formatWeightData(data) {
  if (!data) return "";
  if (data.unit === "bodyweight") return "Без веса";
  if (data.value === null || data.value === undefined) return data.raw || "Требует проверки";
  const suffix = data.perSide ? ` / ${data.sideLabel || "рука"}` : "";
  return `${formatNumber(data.value)} кг${suffix}`;
}

function normalizedNumericField(value, { max = Infinity, missingUnit = false } = {}) {
  const parsed = parseLocaleNumber(value);
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, raw, needsReview: false, reviewReason: "" };
  if (parsed === null) return { value: null, raw, needsReview: true, reviewReason: "Некорректное числовое значение." };
  if (Math.abs(parsed) > max) return { value: parsed, raw, needsReview: true, reviewReason: "Значение выходит за ожидаемый диапазон." };
  return {
    value: parsed,
    raw,
    needsReview: missingUnit,
    reviewReason: missingUnit ? "В старой записи не указана единица измерения." : "",
  };
}

export function normalizeCardioEntry(entry = {}) {
  if (entry.version === 2 && "distanceValue" in entry) return { ...entry };
  const level = normalizedNumericField(entry.level ?? entry.levelValue, { max: 100 });
  const minutes = normalizedNumericField(entry.minutes, { max: 300 });
  const calories = normalizedNumericField(entry.calories, { max: 3000 });
  const distanceRaw = String(entry.distance ?? "").trim();
  const distanceMatch = /^(\d+(?:[.,]\d+)?)\s*(км|km|м|m)?$/i.exec(distanceRaw);
  const distanceValue = distanceMatch ? parseLocaleNumber(distanceMatch[1]) : null;
  const explicitDistanceUnit = distanceMatch?.[2];
  const distanceUnit = explicitDistanceUnit && /^(м|m)$/i.test(explicitDistanceUnit) ? "m" : "km";
  const distanceNeedsReview = Boolean(distanceRaw) && (!distanceMatch || !explicitDistanceUnit);
  const issues = [
    level.needsReview && `Уровень/мощность: ${level.reviewReason}`,
    minutes.needsReview && `Минуты: ${minutes.reviewReason}`,
    calories.needsReview && `Калории: ${calories.reviewReason}`,
    distanceNeedsReview && (distanceMatch ? "Дистанция: в старой записи не указана единица." : "Дистанция: некорректное числовое значение."),
  ].filter(Boolean);

  return {
    version: 2,
    levelValue: level.value,
    minutes: minutes.value,
    distanceValue,
    distanceUnit,
    calories: calories.value,
    needsReview: issues.length > 0,
    reviewReason: issues.join(" "),
    legacy: { ...entry },
  };
}

export function setResultsFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ reps: parseLocaleNumber(item?.reps) ?? "" }));
}

export function performanceTextFrom(entry) {
  if (!entry) return "";
  const setResults = setResultsFrom(entry.setResults || entry.actualSets);
  if (setResults.length) {
    const values = setResults.map((item) => item.reps).filter((value) => value !== "");
    return values.length ? values.join(" / ") : "";
  }
  const sets = Array.isArray(entry.actualSets) ? "" : entry.actualSets || "";
  const reps = entry.actualReps || "";
  return sets && reps ? `${sets} подхода × ${reps}` : "";
}

export const bodyTrendFields = ["weightKg", "weeklyAverageWeightKg", "waistCm", "bodyFatPercent", "muscleMassKg"];

export function bodyMeasurementsEqual(left, right, fields) {
  if (!left || !right) return false;
  return fields.every((field) => String(left[field] ?? "") === String(right[field] ?? ""));
}

export function duplicateBodyPairs(entries = [], fields = []) {
  const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
  const pairs = [];
  for (let index = 1; index < sorted.length; index += 1) {
    if (bodyMeasurementsEqual(sorted[index - 1], sorted[index], fields)) {
      pairs.push({ previous: sorted[index - 1], duplicate: sorted[index] });
    }
  }
  return pairs;
}

export function fourWeekChange(entries, field) {
  const values = [...entries]
    .filter((entry) => parseLocaleNumber(entry[field]) !== null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (values.length < 2) return null;
  const latest = values.at(-1);
  const cutoff = new Date(latest.date);
  cutoff.setDate(cutoff.getDate() - 28);
  const baseline = values.find((entry) => new Date(entry.date) >= cutoff) || values[0];
  return parseLocaleNumber(latest[field]) - parseLocaleNumber(baseline[field]);
}
