# Workout Weekly Web App

Интерактивная веб-версия PDF-методички с недельным планом тренировок: быстрый выбор дня, поиск, фильтры, карточки упражнений, подробная техника, режим «Быстро в зале», заметки, отметки выполнения и необязательная синхронизация через Supabase.

Публичный адрес после публикации:

```text
https://smirkita.github.io/workout-weekly-web-app/
```

## Как запустить локально

Установите зависимости:

```bash
npm install
```

Запустите dev-сервер:

```bash
npm run dev
```

Vite использует base path `/workout-weekly-web-app/`, поэтому локальный адрес обычно будет выглядеть так:

```text
http://localhost:5173/workout-weekly-web-app/
```

## Как собрать

```bash
npm run build
```

Проверить production-сборку:

```bash
npm run preview
```

## Где лежит PDF

Рабочая копия PDF для GitHub Pages лежит здесь:

```text
public/source/Методичка_недельный_план_тренировок.pdf
```

Исходная копия также сохранена здесь:

```text
source/Методичка_недельный_план_тренировок.pdf
```

## Куда добавлять картинки упражнений

Для публикации на GitHub Pages картинки должны лежать в:

```text
public/assets/exercises/
```

В проекте также оставлена исходная папка:

```text
assets/exercises/
```

Если добавляете или обновляете картинку, положите её в `public/assets/exercises/`. Желательный формат имени:

```text
public/assets/exercises/hip-thrust.jpg
```

У каждого упражнения в данных есть поле `image`. Если файла пока нет, приложение покажет placeholder «Картинка упражнения будет добавлена».

## Где менять данные тренировок

Все основные данные вынесены в:

```text
src/data/workouts.js
```

Там можно менять:

- расписание;
- секции дня: кардио, разминку, бассейн, заминку и восстановление;
- названия упражнений;
- веса;
- подходы и повторы;
- порядок упражнений;
- тексты техники, ошибок и прогрессии;
- теги;
- пути к картинкам.

Пути к картинкам задаются относительно `public/`, например:

```js
image: img("hip-thrust")
```

Это превращается в:

```text
assets/exercises/hip-thrust.jpg
```

В приложении путь автоматически дополняется через `import.meta.env.BASE_URL`, поэтому он корректно работает на GitHub Pages.

## Как добавить новое упражнение

1. Откройте `src/data/workouts.js`.
2. Найдите нужный день в массиве `workouts`.
3. Добавьте новый объект через helper `exercise({ ... })` в массив `exercises`.
4. Укажите `id`, `title`, `image`, `sets`, `weight`, `rpe`, `rest`, `summary`, `muscles`, `technique`, `mistakes`, `progression`, `tags`.
5. Если нужна картинка, добавьте файл в `public/assets/exercises/`.

Пример:

```js
exercise({
  id: "new-exercise",
  title: "Новое упражнение",
  image: img("new-exercise"),
  sets: "3 x 10-12",
  weight: "Лёгкий-средний",
  rpe: "RPE 6",
  rest: "60 сек",
  summary: "Кратко что это.",
  muscles: "Основные мышцы.",
  technique: "Как выполнять.",
  mistakes: "Чего избегать.",
  progression: "Как усложнять.",
  tags: ["Силовая"],
})
```

## Как заменить placeholder на настоящую картинку

1. Подготовьте изображение в формате `.jpg`.
2. Положите его в `public/assets/exercises/`.
3. Назовите файл так же, как указан путь в `image`.

Например, если в данных:

```js
image: img("plank")
```

то файл должен быть:

```text
public/assets/exercises/plank.jpg
```

После этого картинка появится автоматически.

## Как менять разминку, заминку или бассейн

Разминка, заминка, кардио и бассейн оформлены как секции дня в `src/data/workouts.js`, а не как большие карточки упражнений.

Ищите объект `routineSections`. Каждый пункт секции содержит:

- `title` - название действия;
- `amount` - сколько делать;
- `technique` - как выполнять;
- `goal` - зачем это нужно.

## GitHub Pages

Проект настроен для автоматической публикации через GitHub Actions.

Репозиторий:

```text
workout-weekly-web-app
```

В `vite.config.js` указан base path:

```js
base: "/workout-weekly-web-app/"
```

Workflow деплоя лежит здесь:

```text
.github/workflows/deploy.yml
```

Он запускается при push в `main`, выполняет:

```bash
npm install
npm run build
```

и публикует папку `dist` через GitHub Pages. В настройках репозитория нужно выбрать:

```text
Settings -> Pages -> Source -> GitHub Actions
```

Не используйте папку `docs`, если деплой идёт через GitHub Actions.

## Синхронизация через Supabase

Без настройки Supabase приложение продолжает полноценно работать через `localStorage`.
После настройки пользователь входит по magic link из электронной почты, а данные синхронизируются между устройствами.

Облачные записи повторяют текущую локальную структуру:

- `workout-progress-YYYY-WW` — выполнение, недельный прогресс, усталость и оценки недели;
- `workout-notes-YYYY-WW` — заметки недели;
- `workout-exercise-results:v2` — рабочие веса и история упражнений.

Конфликты разрешаются по `client_updated_at`: сохраняется запись с более поздним временем изменения.
Неотправленные изменения находятся в локальном outbox и автоматически отправляются после восстановления соединения.
Старые локальные данные при первом входе добавляются в облако и не удаляются.

### 1. Создать проект

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard).
2. Создайте проект на бесплатном тарифе.
3. Дождитесь завершения настройки базы.

### 2. Создать таблицу и RLS

1. Откройте `SQL Editor` в проекте Supabase.
2. Скопируйте весь файл `supabase/schema.sql`.
3. Выполните SQL.

Скрипт создаёт таблицу `workout_sync_records`, включает Row Level Security и политики,
по которым авторизованный пользователь видит и изменяет только строки со своим `user_id`.

### 3. Настроить адреса Auth

Откройте `Authentication -> URL Configuration` и укажите:

```text
Site URL:
https://smirkita.github.io/workout-weekly-web-app/

Redirect URLs:
https://smirkita.github.io/workout-weekly-web-app/
http://localhost:5173/workout-weekly-web-app/
http://localhost:4173/workout-weekly-web-app/
```

В `Authentication -> Providers -> Email` оставьте Email provider включённым.
Стандартный шаблон с `ConfirmationURL` отправляет magic link.

### 4. Получить URL и anon key

Откройте `Project Settings -> API` и скопируйте:

- `Project URL`;
- публичный `anon` / `publishable` key.

Никогда не добавляйте `service_role` key в приложение или GitHub.

Для локальной разработки создайте `.env.local` по примеру `.env.example`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

### 5. Добавить переменные в GitHub

В репозитории откройте:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Добавьте два секрета:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Workflow передаёт их только в Vite-сборку. Публичный anon key попадёт в клиентский JavaScript,
что является штатным режимом Supabase; доступ к данным ограничивает RLS.

После добавления секретов сделайте новый push в `main` или запустите workflow вручную.

## Как обновить сайт после правок

1. Внести правки в проект.
2. Проверить `npm run build`.
3. Сделать commit.
4. Push в `main`.
5. Подождать завершения GitHub Actions.
6. Проверить сайт: `https://smirkita.github.io/workout-weekly-web-app/`.

## Что улучшено по сравнению с PDF

- День недели открывается одним нажатием.
- Есть кнопка «Сегодня».
- Работают поиск и фильтры по типу нагрузки.
- Упражнения показаны карточками с техникой, ошибками и прогрессией.
- Разминка, заминка, бассейн и восстановление вынесены в отдельные компактные секции.
- Есть режим «Быстро в зале» без длинных объяснений.
- Отметки выполнения и заметки сохраняются в `localStorage`.
- Добавлен блок «Условные обозначения / Как читать план».
- Расписание адаптировано под йогу во вторник 20:00, йогу в четверг 20:30 и бассейн в пятницу.
