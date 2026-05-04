import { filters, progression, safety, workouts } from "../data/workouts.js";

const state = {
  activeDayId: workouts[0].id,
  query: "",
  filter: "Все",
  quickMode: false,
};

const storageKey = "workout-weekly-app:v1";
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
  safetyList: document.querySelector("#safetyList"),
  progressionList: document.querySelector("#progressionList"),
};

const metricHelp = {
  "Подходы/повторы": "Например, 3x10-12 означает: 3 подхода по 10-12 повторений.",
  Вес: "Ориентир нагрузки. Если техника разваливается, вес нужно снизить.",
  "RPE/RIR": "RPE — насколько тяжело по ощущениям. RIR — сколько повторов осталось в запасе.",
  Отдых: "Пауза между подходами перед следующим рабочим подходом.",
};

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {
      days: {},
      exercises: {},
      notes: {},
    };
  } catch {
    return { days: {}, exercises: {}, notes: {} };
  }
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(saved));
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

els.hero?.style.setProperty("--hero-image", `url("${assetPath("assets/hero/workout-hero.png")}")`);

function updateScrollTopButton() {
  els.scrollTopButton?.classList.toggle("is-visible", window.scrollY > 420);
}

window.addEventListener("scroll", updateScrollTopButton, { passive: true });

els.scrollTopButton?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
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
          <input type="checkbox" ${saved.days[day.id] ? "checked" : ""} />
        </label>
      </div>
      <p class="day-type">${day.type}</p>
      <p class="day-summary">${day.summary}</p>
      <p class="duration">${day.duration}</p>
      <div class="tags">${day.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    `;
    card.addEventListener("click", (event) => {
      if (event.target.matches("input")) return;
      selectDay(day.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectDay(day.id);
    });
    card.querySelector("input").addEventListener("change", (event) => {
      saved.days[day.id] = event.target.checked;
      persist();
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
        <input id="activeDayDone" type="checkbox" ${saved.days[day.id] ? "checked" : ""} />
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

    <div class="notes-box">
      <label for="dayNotes">Заметки после тренировки</label>
      <textarea id="dayNotes" placeholder="Вес, повторы, самочувствие, что было сложно...">${saved.notes[day.id] || ""}</textarea>
    </div>

    <div class="training-flow"></div>
  `;

  els.dayDetails.querySelector("#activeDayDone").addEventListener("change", (event) => {
    saved.days[day.id] = event.target.checked;
    persist();
    renderWeek();
  });

  els.dayDetails.querySelector("#dayNotes").addEventListener("input", (event) => {
    saved.notes[day.id] = event.target.value;
    persist();
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
    const row = document.createElement("article");
    row.className = "routine-item";
    row.innerHTML = `
      <label class="routine-check">
        <input type="checkbox" ${saved.exercises[key] ? "checked" : ""} />
        <span>${index + 1}</span>
      </label>
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
    row.querySelector("input").addEventListener("change", (event) => {
      saved.exercises[key] = event.target.checked;
      persist();
    });
    list.append(row);
  });

  return node;
}

function renderExercise(item, order) {
  const template = document.querySelector("#exerciseTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  node.classList.toggle("is-quick", state.quickMode);
  const checkbox = node.querySelector(".exercise-done");
  checkbox.checked = Boolean(saved.exercises[item.id]);
  checkbox.addEventListener("change", (event) => {
    saved.exercises[item.id] = event.target.checked;
    persist();
  });

  const media = node.querySelector(".media-wrap");
  const image = document.createElement("img");
  image.src = assetPath(item.image);
  image.alt = item.title;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    media.classList.add("is-placeholder");
    media.innerHTML = `<div><strong>Картинка упражнения будет добавлена</strong><span>${item.title}</span></div>`;
  }, { once: true });
  media.append(image);

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
        <button class="tooltip" type="button" aria-label="${metricHelp[key]}" data-tip="${metricHelp[key]}">?</button>
      </dt>
      <dd>${value}</dd>
    </div>
  `).join("");
  node.querySelector(".muscles").innerHTML = `<strong>Мышцы:</strong> ${item.muscles}`;

  const details = node.querySelector(".details-list");
  details.innerHTML = "";
  if (!state.quickMode) {
    [
      ["Техника", item.technique],
      ["Ошибки", item.mistakes],
      ["Прогрессия", item.progression],
    ].forEach(([title, text], index) => {
      const detail = document.createElement("details");
      detail.open = index === 0;
      detail.innerHTML = `<summary>${title}</summary><p>${text}</p>`;
      details.append(detail);
    });
  }

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
render();
