# Gym Zero redesign plan

Date: 2026-09-18
Scope: mobile-first visual redesign of the five main screens plus the shared design tokens. No data-layer or behaviour changes. All screenshots are at iPhone 12 Pro size (390 × 844).

Images in this doc: `current/` are screenshots of the app as it is today, `inspiration/` are Mobbin screens (links point at the Mobbin page for each).

## Direction

Today the app is a brutalist "IGNITE" system: pure black, square corners, hairline dividers, everything uppercase and letter-spaced, one lime accent. It reads like a poster. The problems in practice:

- **Everything has the same weight.** Labels, section titles, buttons and metadata are all uppercase 0.7rem, so nothing on the screen tells the eye where to start.
- **No containment.** Sections are only separated by 1px lines, so on long screens (Fuel, Stats, Workout) it is hard to tell where one thing stops and the next starts.
- **Zeros and empty states dominate.** With no data the home screen is three bars of "0 / target" and a paragraph of copy.
- **The set logger looks like a spreadsheet.** No "previous" column, no highlighted current set, no context for the exercise.

The redesign keeps what's distinctive (dark, lime accent, Anton for big numbers) and moves the layout to a **card and tile system** like Apple Fitness, Hevy and Any Distance: rounded surfaces on a near-black background, rings for goals, stat tiles for numbers, sentence-case buttons, uppercase reserved for small tile captions only.

Design tokens that change in `app/src/styles.css`:

| Token | Now | Proposed |
| --- | --- | --- |
| Corner radius | 0–2px | `--r-sm: 10px`, `--r: 16px`, `--r-lg: 22px` |
| Surface | transparent + hairline | `--surface: #141416` cards, `--surface-2: #1c1c1f` inner tiles |
| Section titles | uppercase 0.72rem | Sentence case, 1.05rem, weight 700 |
| Buttons | uppercase, square | Sentence case, 999px pill for primary, 12px radius for secondary |
| Labels | uppercase 0.72rem, 0.14em tracking | Keep, but only inside tiles and table heads |
| Goal progress | 6px flat bar | Ring (SVG) on Home and Fuel, bar elsewhere |
| Display font | Anton for all numbers | Anton only for hero numbers (rings, timer, tile values) |

---

## 1. Home → `app/src/screens/Home.tsx`

### Current

![Current home](current/home.png)

### Inspiration

Apple Fitness home tile grid: [mobbin.com/screens/c1fe70c1…](https://mobbin.com/screens/c1fe70c1-c102-41c8-9352-15f5897055f5)

![Apple Fitness](inspiration/home-apple-fitness.png)

Any Distance stat tiles with caption above value: [mobbin.com/screens/47e2e83b…](https://mobbin.com/screens/47e2e83b-6b36-420d-8ec8-b3682c555b2e)

![Any Distance](inspiration/home-any-distance.png)

### What changes

1. **Header row**: date on the left, streak pill and gear on the right, greeting as a normal 1.6rem bold heading (drop the lime full stop).
2. **Goals card** (top, full width, `--r-lg`): three rings side by side for Calories, Protein, Water. Number in Anton under each ring, caption below. Rings replace the three MacroBar rows. Carbs and fat note stays as a small line under the rings when present.
3. **Start workout hero card** (lime, `--r-lg`): routine name and exercise count on the left, big "Start" or "Resume" pill on the right. Absorbs the "Legs is up next" line. When a workout is active it shows the elapsed timer.
4. **2-column tile row**: "Last workout" tile (sets, lb, min as small stat triplet, PR chips) and "Log food" tile with a plus icon. Both are `--surface` cards at `--r`.
5. **Strength Check onboarding card** moves to the bottom and gets a dismissible style (icon, one-line title, two-line body, secondary button).
6. Desktop (`min-width: 900px`): same cards in the existing `.home-grid` two-column layout, rings card spans the left column.

---

## 2. Train (routine list) → `app/src/screens/Routines.tsx`

### Current

![Current routines](current/routines.png)

### Inspiration

Hevy workout tab, quick start plus routine cards with a start button: [mobbin.com/screens/bf009e87…](https://mobbin.com/screens/bf009e87-390d-49da-9899-a1e32a1e9d5f)

![Hevy routines](inspiration/routines-hevy.png)

### What changes

1. **Title "Train"** as a plain heading, no back link (this is a tab).
2. **Quick start row**: two pill buttons, "Start empty workout" and "New routine", at the top instead of buried at the bottom.
3. **Workout in progress banner** (when `activeWorkout` exists): a `--surface` card with "Resume" primary and "Discard" text button, replacing the lime block and paragraph.
4. **Routine cards** (`--surface`, `--r`): emoji plus name on the first line, exercise names as muted body text, meta line "5 exercises · last never", full-width lime "Start routine" pill inside the card. The "Up next" chip stays on the first card. Edit becomes a "⋯" icon button top-right that opens the edit screen.

---

## 3. Workout logger → `app/src/screens/Workout.tsx` (+ `SetEditor.tsx`, rest toast in `App.tsx`)

### Current

![Current workout with rest timer](current/workout-rest.png)

### Inspiration

Hevy set table with SET / PREVIOUS / KG / REPS / ✓ columns and per-exercise cards: [mobbin.com/screens/84d786e6…](https://mobbin.com/screens/84d786e6-f113-40e0-af52-c30dc8404b2d)

![Hevy logger](inspiration/workout-hevy.png)

Bevel: sticky timer header, highlighted current set row, rest timer as a bottom pill: [mobbin.com/screens/104617a3…](https://mobbin.com/screens/104617a3-8dd2-4cd9-ba85-7189c3a0e5c8)

![Bevel logger](inspiration/workout-bevel.png)

Gymshark: dark theme reference for filled set rows: [mobbin.com/screens/25eebc84…](https://mobbin.com/screens/25eebc84-2d43-4fdd-8474-2f05dea50098)

![Gymshark logger](inspiration/workout-gymshark.png)

### What changes

1. **Sticky header**: back chevron, routine name and progress ("Legs · 1/5") on the left, elapsed timer in Anton on the right, and a "Finish" pill. Replaces the loose top row.
2. **Exercise card** (`--surface`, `--r-lg`): exercise name as heading, muscle groups as a muted line, "Muscles & movement" becomes a small link-style button instead of a hairline `<details>` row.
3. **Set table inside the card**: columns SET · PREVIOUS · LB · REPS · ✓. Previous column shows the last performance (`prev` data already loaded) or the program suggestion in muted text. Logged rows get a faint lime tint; the current editable row gets a lime left edge; future rows are dimmed. Inputs become `--surface-2` pills at 44px. Done button becomes a round lime check.
4. **"Edit set"** stays but moves inline as a small text button on the logged row.
5. **Exercise list** at the bottom becomes horizontal chips (name plus "1/4") that scroll sideways, with the current one filled lime. "Add an exercise" becomes a pill button that opens the existing select.
6. **Rest timer** (`.rest-toast` in `App.tsx`): floating pill above the tab bar, `--r-lg`, ring or bar on the left, time in Anton, "+30s" and "Skip" as small pills. Same behaviour.

---

## 4. Fuel → `app/src/screens/Food.tsx` (+ `HydrationCard.tsx`)

### Current

![Current fuel](current/food.png)

### Inspiration

MyFitnessPal diary: calorie card with bar and "left", macro triad card, meal slots with a Log button each: [mobbin.com/screens/32b82d20…](https://mobbin.com/screens/32b82d20-deb0-493f-a643-c170d9e46b8b)

![MyFitnessPal](inspiration/food-myfitnesspal.png)

Lifesum: ring with consumed / remaining / burned around it, meals logged as cards with a plus: [mobbin.com/screens/ba02a832…](https://mobbin.com/screens/ba02a832-1a7e-4717-8dae-e96cb104ad78)

![Lifesum](inspiration/food-lifesum.png)

### What changes

1. **Summary card** at the top: large calorie ring in the centre with "remaining" as the hero number, "eaten" and "target" either side. Below it a three-column macro row (Protein, Carbs, Fat) with tiny bars. Replaces the two MacroBar rows and the "kcal to target" line.
2. **Actions**: "Log food" and "Scan barcode" become two pills directly under the summary. AI describe stays as it is inside the log flow.
3. **Meals by slot**: each slot (breakfast, lunch, dinner, snack, the existing grouping in `Food.tsx` line 406) becomes a `--surface` card with a slot title, calorie total on the right, entries as rows, and a round plus button that opens the log form pre-filled for that slot.
4. **Hydration** (`HydrationCard.tsx`) becomes a tile with a small water ring, "0 / 64 oz", and the container buttons as pill chips. The two explainer paragraphs collapse into one short line.
5. **Quick add and recents** stay, restyled as horizontal chip rows under a sentence-case heading.

---

## 5. Stats → `app/src/screens/History.tsx` (+ `Body.tsx` entry point)

### Current

![Current stats](current/stats.png)

### Inspiration

Hevy: month calendar with filled days, volume bar chart card, summary stat card: [mobbin.com/screens/cccc44e1…](https://mobbin.com/screens/cccc44e1-40c4-4699-9e6a-542a4212b7e7)

![Hevy stats](inspiration/stats-hevy.png)

Runna: dark week strip with the current day highlighted and workout list cards: [mobbin.com/screens/8c89f937…](https://mobbin.com/screens/8c89f937-c894-4a5f-92a3-59d9e196d762)

![Runna stats](inspiration/stats-runna.png)

### What changes

1. **Week strip** at the top as a card: seven day circles, filled lime on workout days, today outlined. "This week · 0 workouts" becomes the card subtitle.
2. **Stat tile row** (2 × 2): Workouts this week, Volume this week with the % trend, Cardio minutes, Latest weight. Anton values, caption above (Any Distance style).
3. **Volume chart card**: the existing `WeekBars` spark chart inside a `--surface` card with a sentence-case title and the "lb lifted per week" caption. Same for the cardio chart and the fuel week chart (calories with target line, protein hits, water hits).
4. **Fuel empty state** becomes a compact card: one line of copy and a "Log food" pill, not a full section.
5. **Body card**: latest weight, delta, quick weigh-in input and "Log" pill in one card. "Open" chevron in the card header goes to `Body.tsx`.
6. **Recent workouts** list as cards (date, routine, sets · lb · min, PR chips), tappable to the summary screen.

---

## 6. Scan → `app/src/screens/Scan.tsx` (light touch)

![Current scan](current/scan.png)

Keep the layout. Round the viewfinder to `--r-lg`, make the corner marks thinner, turn the "Photo / Describe it" toggle into a segmented pill (`Seg.tsx` restyle), and put "Take photo" and "Upload photo" in a card. No inspiration screen needed, this one is mostly token changes.

---

## 7. Shell: tab bar and top nav → `app/src/components/TabBar.tsx`, `app/src/styles.css`

- Tab bar keeps the five slots. Remove the top-edge lime marker; active tab is lime icon and label. Scan key becomes a 52px lime circle that overhangs the bar, label hidden.
- Desktop top nav: unchanged structure, sentence-case links.
- Feedback toast: `--r` card floating at the top with a small margin instead of a full-width bar.

---

## Implementation order

Each step is shippable on its own and the app should typecheck and pass the e2e flow after each.

1. **Tokens and primitives** in `styles.css`: radii, surfaces, `.card` becomes a real card, `.tile`, `.ring` (new `Ring.tsx` component in `components/`), pill buttons, sentence-case section titles. Rest toast, feedback toast and tab bar restyle. Everything else keeps working because class names don't change.
2. **Home** (`Home.tsx`).
3. **Train** (`Routines.tsx`).
4. **Workout logger** (`Workout.tsx`, `SetEditor.tsx`). Biggest step, has the most existing e2e coverage (`e2e/flow.mjs`, `rest-edits.mjs`).
5. **Fuel** (`Food.tsx`, `HydrationCard.tsx`).
6. **Stats** (`History.tsx`).
7. **Scan and secondary screens** (`Scan.tsx`, `Machine.tsx`, `Summary.tsx`, `Settings.tsx`, `RoutineEdit.tsx`, `Body.tsx`) inherit the tokens; touch up anything that looks off.

## Verification

- `npm run typecheck` and `npm run build` after each step.
- `npm run e2e`, `e2e:rest-edits`, `e2e:food`, `e2e:qol` after steps 4 to 6, since they click by visible text.
- Re-run the screenshot pass at 390 × 844 and 1280 × 800 and drop the results in `artifacts/redesign/after/` for side-by-side comparison.
- Manual check on a phone over the LAN URL for safe-area insets, keyboard behaviour on the set inputs, and the 16px input floor that stops iOS zoom.

## Open decisions for you

1. **Rings vs bars on Home.** Rings are the bigger visual change and cost some vertical space; bars in cards is the safer option.
2. **Sentence-case buttons.** This drops the uppercase "shout" that the current brand leans on. I recommend it, but it is a taste call.
3. **Scope of step 7.** Secondary screens can be left on the old look for a first pass if you want to ship Home, Train and Workout sooner.

Note: your global instructions say to plan with the subir skill. It is not installed on this machine (not in `~/.claude/skills`, plugins, or the project), so this plan is a plain markdown file instead.
