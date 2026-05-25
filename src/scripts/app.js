import { filters, progression, safety, workouts } from "../data/workouts.js";

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
const saved = loadSaved();
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
  safetyList: document.querySelector("#safetyList"),
  progressionList: document.querySelector("#progressionList"),
};

const metricHelp = {
  "Подходы/повторы": "Например, 3x10-12 означает: 3 подхода по 10-12 повторений.",
  Вес: "Рабочий стартовый вес на эту неделю. Выполни упражнение по плану и отметь, как прошло: легко, норма или тяжело. В конце недели по отметкам скорректируем вес.",
  "RPE/RIR": "RPE — насколько тяжело по ощущениям. RIR — сколько повторов осталось в запасе.",
  Отдых: "Пауза между подходами перед следующим рабочим подходом.",
};

const groupLabels = {
  prep: "Подготовка",
  main: "Основная часть",
  finish: "Завершение",
};

const effortOptions = {
  easy: "Легко",
  normal: "Норма",
  hard: "Тяжело",
};

const fatigueOptions = {
  light: "Лёгкая",
  normal: "Нормальная",
  strong: "Сильная",
};

const effortReportLabels = {
  easy: "легко",
  normal: "нормально",
  hard: "тяжело",
};

const fatigueReportLabels = {
  light: "лёгкая",
  normal: "нормальная",
  strong: "сильная",
};

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
    days: {},
    exercises: {},
    feedback: {},
    fatigue: {},
  };
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function savedForWeek(weekKey) {
  if (weekKey === currentWeek.key) return saved;
  const progress = loadJson(`workout-progress-${weekKey}`, emptyProgress());
  const notes = loadJson(`workout-notes-${weekKey}`, {});
  return {
    ...emptyProgress(),
    ...progress,
    notes,
  };
}

function loadSaved() {
  const progress = loadJson(progressStorageKey, null);
  const notes = loadJson(notesStorageKey, null);

  if (progress || notes) {
    return {
      ...emptyProgress(),
      ...(progress || {}),
      notes: notes || {},
    };
  }

  return {
    ...emptyProgress(),
    notes: {},
  };
}

function persist() {
  localStorage.setItem(progressStorageKey, JSON.stringify({
    days: saved.days,
    exercises: saved.exercises,
    feedback: saved.feedback || {},
    fatigue: saved.fatigue || {},
    updatedAt: new Date().toISOString(),
  }));
  localStorage.setItem(notesStorageKey, JSON.stringify(saved.notes || {}));
}

function todayWorkoutId() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

function normalize(value) {
  return String(value).toLowerCase().replaceAll("ё", "е");
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
  const counts = { easy: 0, normal: 0, hard: 0 };
  const easy = [];
  const hard = [];
  const feedback = source.feedback || {};

  workouts.forEach((day) => {
    day.exercises.forEach((exercise) => {
      const value = feedback[exercise.id];
      if (!value || !counts.hasOwnProperty(value)) return;
      counts[value] += 1;
      if (value === "easy") easy.push(exercise.title);
      if (value === "hard") hard.push(exercise.title);
    });
  });

  return { counts, easy, hard };
}

function fatigueStatsForSaved(source) {
  const counts = { light: 0, normal: 0, strong: 0 };
  Object.values(source.fatigue || {}).forEach((value) => {
    if (counts.hasOwnProperty(value)) counts[value] += 1;
  });
  return counts;
}

function weightText(weight) {
  if (!weight || typeof weight !== "object") return weight || "не указан";
  return weight.start || "уточнить";
}

function mainExerciseEntries(source) {
  return workouts.flatMap((day) =>
    day.exercises.map((exercise) => ({
      day,
      exercise,
      weight: weightText(exercise.weight),
      feedback: source.feedback?.[exercise.id] || "",
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
  const entries = mainExerciseEntries(source);
  const grouped = {
    easy: entries.filter((entry) => entry.feedback === "easy"),
    normal: entries.filter((entry) => entry.feedback === "normal"),
    hard: entries.filter((entry) => entry.feedback === "hard"),
    unrated: entries.filter((entry) => !entry.feedback),
  };
  const fatigue = fatigueStatsForSaved(source);
  const hasData = hasStoredProgress(source);

  return {
    week,
    source,
    stats,
    entries,
    grouped,
    fatigue,
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
      Object.values(source.fatigue || {}).some(Boolean),
  );
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

function reportEntryLine(entry) {
  return `${entry.day.day} · ${entry.exercise.title} · ${entry.weight}`;
}

function recommendationFor(entry) {
  if (entry.feedback === "easy") {
    return `${entry.exercise.title} — ${entry.weight} → можно рассмотреть повышение на минимальный шаг, если техника чистая и усталость дня не высокая`;
  }
  if (entry.feedback === "normal") {
    return `${entry.exercise.title} — ${entry.weight} → вес подходит, оставить без изменений`;
  }
  if (entry.feedback === "hard") {
    return `${entry.exercise.title} — ${entry.weight} → оставить или снизить на один шаг, если снова тяжело или техника ломается`;
  }
  return "";
}

function reportList(items, emptyText, mapper = reportEntryLine) {
  if (!items.length) return `<p class="weekly-report__empty">${emptyText}</p>`;
  return `<ul>${items.map((item) => `<li>${mapper(item)}</li>`).join("")}</ul>`;
}

function reportConclusions(model) {
  const lines = [];
  const { easy, normal, hard } = model.grouped;
  const strongFatigueDays = Object.entries(model.source.fatigue || {})
    .filter(([, value]) => value === "strong")
    .map(([dayId]) => workouts.find((day) => day.id === dayId)?.day)
    .filter(Boolean);

  if (!model.hasData) {
    return ["На этой неделе пока нет отмеченных упражнений."];
  }
  if (normal.length >= easy.length && normal.length >= hard.length) {
    lines.push("Большая часть весов подобрана нормально, базовые веса можно оставить.");
  }
  if (easy.length) {
    lines.push("Упражнения с отметкой «Легко» можно рассмотреть для аккуратного повышения, если техника была чистой.");
  }
  if (hard.length) {
    lines.push("Упражнения с отметкой «Тяжело» лучше не повышать: проверить технику, повторы и восстановление.");
  }
  if (strongFatigueDays.length) {
    lines.push(`В дни с сильной усталостью (${strongFatigueDays.join(", ")}) веса лучше не повышать, даже если отдельные упражнения были лёгкими.`);
  }
  workouts.forEach((day) => {
    const dayEasy = easy.filter((entry) => entry.day.id === day.id).length;
    const dayHard = hard.filter((entry) => entry.day.id === day.id).length;
    const dayFatigue = model.source.fatigue?.[day.id];
    if (dayEasy >= 3 && dayFatigue === "light") {
      lines.push(`${day.day}: много лёгких упражнений и лёгкая усталость — нагрузку можно аккуратно повышать.`);
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
    lines.push(`Общая усталость: ${fatigueReportLabels[model.source.fatigue?.[day.id]] || "не отмечено"}`);
    lines.push("", "Основная часть:");
    dayEntries.forEach((exercise) => {
      lines.push(`— ${exercise.title} — ${weightText(exercise.weight)} — ${effortReportLabels[model.source.feedback?.[exercise.id]] || "не отмечено"}`);
    });
  });

  lines.push(
    "",
    "Сводка по нагрузке:",
    `— Легко: ${model.grouped.easy.length}`,
    `— Нормально: ${model.grouped.normal.length}`,
    `— Тяжело: ${model.grouped.hard.length}`,
    `— Не отмечено: ${model.grouped.unrated.length}`,
    "",
    "Предварительные выводы:",
    ...reportConclusions(model).map((line) => `— ${line}`),
    "",
    "Кандидаты на повышение:",
    ...(model.grouped.easy.length ? model.grouped.easy.map((entry) => `— ${recommendationFor(entry)}`) : ["— нет"]),
    "",
    "Оставить как есть:",
    ...(model.grouped.normal.length ? model.grouped.normal.map((entry) => `— ${recommendationFor(entry)}`) : ["— нет"]),
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
  const fatigue = fatigueStatsForSaved(saved);
  const repeatedEasy = repeatedFeedback("easy");
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
          <span class="is-normal">Норма: <strong>${feedback.counts.normal}</strong></span>
          <span class="is-hard">Тяжело: <strong>${feedback.counts.hard}</strong></span>
        </div>
        <div class="load-summary__stats">
          <span>Усталость лёгкая: <strong>${fatigue.light}</strong></span>
          <span>нормальная: <strong>${fatigue.normal}</strong></span>
          <span>сильная: <strong>${fatigue.strong}</strong></span>
        </div>
        <div class="load-summary__grid">
          <article>
            <h3>Возможное повышение веса</h3>
            ${listMarkup(feedback.easy, "Пока нет упражнений с оценкой «Легко».")}
          </article>
          <article>
            <h3>Проверить нагрузку</h3>
            ${listMarkup(feedback.hard, "Пока нет упражнений с оценкой «Тяжело».")}
          </article>
          <article>
            <h3>Повторяется 2 недели</h3>
            ${listMarkup(
              [
                ...repeatedEasy.map((item) => `${item} — легко 2 недели подряд`),
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
          <span class="is-normal">Нормально: <strong>${model.grouped.normal.length}</strong></span>
          <span class="is-hard">Тяжело: <strong>${model.grouped.hard.length}</strong></span>
          <span>Не отмечено: <strong>${model.grouped.unrated.length}</strong></span>
        </div>
        <div class="weekly-report__lists">
          <article>
            <h4>Легко</h4>
            ${reportList(model.grouped.easy, "Пока нет лёгких упражнений.")}
          </article>
          <article>
            <h4>Нормально</h4>
            ${reportList(model.grouped.normal, "Пока нет упражнений с нормальной нагрузкой.")}
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
            ${reportList(model.grouped.easy, "Пока нет кандидатов.", recommendationFor)}
          </article>
          <article>
            <h4>Оставить как есть</h4>
            ${reportList(model.grouped.normal, "Пока нет упражнений.", recommendationFor)}
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

function setCompletion(key, done) {
  saved.exercises[key] = done;
  syncAllDayCompletion();
  persist();
  updateProgressViews();
}

function setDayCompletion(day, done) {
  completionItems(day).forEach((item) => {
    saved.exercises[item.key] = done;
  });
  syncDayCompletion(day);
  persist();
  render();
}

function setExerciseFeedback(exerciseId, value) {
  saved.feedback[exerciseId] = value;
  persist();
  renderLoadSummary();
}

function setDayFatigue(dayId, value) {
  saved.fatigue[dayId] = value;
  persist();
  renderLoadSummary();
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
      ...section.items.flatMap((item) => [item.title, item.amount, item.technique, item.goal]),
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

    <section class="fatigue-card" id="fatigueCard">
      <div>
        <p class="eyebrow">После тренировки</p>
        <h3>Общая усталость</h3>
        <p>Отметка относится ко всему дню и помогает понять, стоит ли повышать веса.</p>
      </div>
      <div class="fatigue-buttons" role="group" aria-label="Общая усталость после тренировки">
        ${Object.entries(fatigueOptions).map(([value, label]) => `
          <button
            class="fatigue-button is-${value} ${saved.fatigue?.[day.id] === value ? "is-selected" : ""}"
            type="button"
            data-fatigue="${value}"
            aria-pressed="${saved.fatigue?.[day.id] === value}"
          >
            ${label}
          </button>
        `).join("")}
      </div>
    </section>
  `;

  els.dayDetails.querySelector("#activeDayDone").addEventListener("change", (event) => {
    setDayCompletion(day, event.target.checked);
  });

  els.dayDetails.querySelector("#dayNotes").addEventListener("input", (event) => {
    saved.notes[day.id] = event.target.value;
    persist();
  });
  els.dayDetails.querySelector("#dayNotes").addEventListener("click", (event) => event.stopPropagation());

  els.dayDetails.querySelectorAll("[data-fatigue]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setDayFatigue(day.id, button.dataset.fatigue);
      els.dayDetails.querySelectorAll("[data-fatigue]").forEach((item) => {
        const selected = item.dataset.fatigue === button.dataset.fatigue;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
    });
  });

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
    ...section.items.flatMap((item) => [item.title, item.amount, item.technique, item.goal]),
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

  exercises.forEach((item, index) => grid.append(renderExercise(item, index + 1)));
  return section;
}

function renderRoutineSection(section) {
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
      setCompletion(key, done);
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
    list.append(row);
  });

  return node;
}

function renderExercise(item, order) {
  const template = document.querySelector("#exerciseTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
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
    setCompletion(item.id, done);
    applyExerciseState(done);
  };
  applyExerciseState(Boolean(saved.exercises[item.id]));
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
  feedbackButtons.innerHTML = Object.entries(effortOptions).map(([value, label]) => `
    <button
      class="effort-button is-${value} ${saved.feedback?.[item.id] === value ? "is-selected" : ""}"
      type="button"
      data-effort="${value}"
      aria-pressed="${saved.feedback?.[item.id] === value}"
    >
      ${label}
    </button>
  `).join("");
  feedbackButtons.querySelectorAll("[data-effort]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setExerciseFeedback(item.id, button.dataset.effort);
      feedbackButtons.querySelectorAll("[data-effort]").forEach((option) => {
        const selected = option.dataset.effort === button.dataset.effort;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
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
  node.querySelector(".summary").textContent = item.summary;
  node.querySelector(".metrics").innerHTML = [
    ["Подходы/повторы", item.sets],
    ["Вес", item.weight],
    ["RPE/RIR", item.rpe],
    ["Отдых", item.rest],
  ].map(([key, value]) => `
    <div>
      <dt>
        ${key}
        <button class="tooltip" type="button" aria-label="${metricHelp[key]}" data-tip-title="${key}" data-tip="${metricHelp[key]}">?</button>
      </dt>
      <dd class="${key === "Вес" && typeof value === "object" ? "metric-weight" : ""}">${metricValue(value)}</dd>
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

function renderLists() {
  els.safetyList.innerHTML = safety.map((item) => `<li>${item}</li>`).join("");
  els.progressionList.innerHTML = progression.map((item) => `<li>${item}</li>`).join("");
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
syncAllDayCompletion();
persist();
render();
