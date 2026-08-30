// Shared data contract between the UI and the data layer (src/data).
// The UI imports only from this file and from src/data/index.ts.

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'hips'

export type EquipmentKind = 'machine' | 'cable' | 'free' | 'bodyweight'

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/** ISO date, local time, YYYY-MM-DD */
export type DayKey = string

export interface Exercise {
  id: string
  name: string
  muscleGroups: MuscleGroup[]
  equipment: EquipmentKind
}

/** Shared knowledge about a manufacturer machine model (e.g. Life Fitness Seated Leg Press). */
export interface EquipmentModel {
  id: string
  manufacturer: string
  modelName: string
  /** QR destination URLs known to identify this model (e.g. YouTube video URLs). */
  qrUrls: string[]
  videoUrl?: string
  muscleGroups: MuscleGroup[]
  exerciseIds: string[]
}

/** The user's record of one physical machine at their club. */
export interface GymMachine {
  id: string
  nickname: string
  exerciseId: string
  equipmentModelId?: string
  /** Raw QR URL scanned on this machine (may be unknown to the catalog). */
  qrUrl?: string
  seatSetting?: string
  setupNotes?: string
  favorite: boolean
}

export interface RoutineItem {
  exerciseId: string
  targetSets: number
  targetReps?: number
}

export interface Routine {
  id: string
  name: string
  emoji?: string
  items: RoutineItem[]
  /** epoch ms of last workout started from this routine */
  lastUsedAt?: number
}

export interface Workout {
  id: string
  date: DayKey
  routineId?: string
  startedAt: number
  finishedAt?: number
  notes?: string
}

export interface WorkoutSet {
  id: string
  workoutId: string
  exerciseId: string
  machineId?: string
  weightLb: number
  reps: number
  setNumber: number
  loggedAt: number
}

export interface FoodEntry {
  id: string
  date: DayKey
  meal: MealSlot
  name: string
  detail?: string
  calories: number
  protein: number
  carbs?: number
  fat?: number
  /** total grams eaten, when known (barcode logs) — keeps the entry re-scalable */
  grams?: number
  /** declared servings eaten, when logged that way */
  servings?: number
}

export interface SavedMeal {
  id: string
  name: string
  emoji?: string
  calories: number
  protein: number
  carbs?: number
  fat?: number
}

/**
 * Nutrition for one packaged product, cached from the food database by
 * barcode. Cached rows are raw individual lookups (Open Food Facts, ODbL) —
 * kept separate from the user's own food log on purpose.
 */
export interface FoodProduct {
  /** EAN/UPC digits */
  barcode: string
  name: string
  brand?: string
  /** macros per 100 g (or 100 ml for drinks) */
  per100g: { calories: number; protein: number; carbs: number; fat: number }
  /** grams in one declared serving, when the label states one */
  servingG?: number
  /** label text for one serving, e.g. "45 g" or "2 crackers (30 g)" */
  servingLabel?: string
  fetchedAt: number
}

export type DrinkKind = 'water' | 'electrolyte' | 'coffee' | 'shake' | 'other'

/**
 * A real-life vessel the user drinks from (their bottle, a glass, the shaker).
 * Registered once; every hydration log is then "I finished that one" — nobody
 * knows their milliliters, everybody knows their bottle.
 */
export interface Container {
  id: string
  name: string
  emoji?: string
  /** fl oz when full */
  volumeOz: number
  /** what's usually in it; a tap logs this kind */
  kind: DrinkKind
  /** kcal in a full container; a tap then also writes a food entry (shakes, soda) */
  calories?: number
  /** grams of protein in a full container */
  protein?: number
  sortOrder: number
}

export interface DrinkEntry {
  id: string
  date: DayKey
  /** epoch ms */
  at: number
  kind: DrinkKind
  volumeOz: number
  /** container tapped to log this, when there was one */
  containerId?: string
  /** display name, e.g. "Bottle" — kept on the entry so it survives container deletion */
  name?: string
  /** food entry holding this drink's calories; the pair deletes together */
  foodEntryId?: string
}

export type ExperienceLevel = 'new' | 'returning' | 'experienced'
export type TrainingGoal = 'muscle' | 'recomp' | 'fat-loss' | 'strength' | 'general'

export interface Settings {
  calorieTarget: number
  proteinTarget: number
  /** daily water target override, fl oz; unset = auto from body weight + training (see lib/hydration) */
  waterTargetOz?: number
  /** default rest between sets, seconds */
  restSeconds: number
  bodyWeightLb?: number
  bodyWeightGoalLb?: number
  /** entered once; lets quick weigh-ins auto-compute BMI */
  heightIn?: number
  bodyFatGoalPct?: number
  /** CLIProxyAPI base URL (tailnet HTTPS); AI features are off when unset */
  aiEndpoint?: string
  aiApiKey?: string
  aiModel?: string
  /** self-hosted food-database (off-db sidecar) base URL; barcode scans use the public OFF API when unset */
  foodDbEndpoint?: string
  // ---- training profile (feeds AI starter programs; all optional) ----
  experience?: ExperienceLevel
  goal?: TrainingGoal
  daysPerWeek?: number
  sessionMinutes?: number
  birthYear?: number
  sex?: 'male' | 'female'
  /** injuries or things to work around, free text (e.g. "lower back pain") */
  limitations?: string
}

/** AI-generated starter program for one machine; cached until recalculated. */
export interface AiProgram {
  /** machine id */
  id: string
  exerciseId: string
  sets: number
  reps: number
  /** rough guess — machine stacks vary; always shown with the effort check */
  startWeightLb?: number
  /** plain-words check for whether the weight is right */
  effortCheck: string
  restSeconds: number
  /** when/how to add weight, in plain words */
  progression: string
  warmup?: string
  /** safety note derived from the user's limitations */
  cautions?: string
  createdAt: number
}

/** Cached AI identification of a machine QR code; asked once per sticker. */
export interface MachineAiInfo {
  /** normalized QR key (see normalizeQrUrl) — stable across devices */
  id: string
  qrUrl: string
  identified: boolean
  manufacturer?: string
  modelName?: string
  confidence: 'high' | 'medium' | 'low'
  muscleGroups: MuscleGroup[]
  /** best match from the app's exercise catalog */
  exerciseId?: string
  setupTips?: string
  howTo: string[]
  createdAt: number
}

/** Self-reported "weight I can do" for one exercise. One per exercise: id = exercise id. */
export interface StrengthBaseline {
  /** exercise id */
  id: string
  weightLb: number
  /** reps the user can do at that weight */
  reps: number
  /** epoch ms of when the user reported or updated it */
  at: number
}

/**
 * Estimated max from one hard set (Epley). Never a weight to lift — only used
 * to scale starting weights and show progress in plain words.
 */
export const epleyMaxLb = (weightLb: number, reps: number): number =>
  Math.round(weightLb * (1 + reps / 30))

/** One body-composition reading (e.g. a smart-scale weigh-in). All metrics optional. */
export interface BodyStatEntry {
  id: string
  date: DayKey
  /** epoch ms of the reading */
  at: number
  weightLb?: number
  bmi?: number
  bodyFatPct?: number
  fatFreeWeightLb?: number
  subcutaneousFatPct?: number
  /** unitless index (scales report 1–59) */
  visceralFat?: number
  bodyWaterPct?: number
  skeletalMusclePct?: number
  muscleMassLb?: number
  boneMassLb?: number
  proteinPct?: number
  bmrKcal?: number
}

/** Numeric metrics of a reading, for trend queries. */
export type BodyMetricKey = Exclude<keyof BodyStatEntry, 'id' | 'date' | 'at'>

export type TapeSite =
  | 'neck' | 'shoulder' | 'chest' | 'waist' | 'abdomen' | 'hip'
  | 'bicepL' | 'bicepR' | 'forearmL' | 'forearmR'
  | 'thighL' | 'thighR' | 'calfL' | 'calfR'

/** One tape-measurement session; inches per site, any subset. Waist–hip ratio is derived. */
export interface TapeEntry {
  id: string
  date: DayKey
  /** epoch ms of the session */
  at: number
  sites: Partial<Record<TapeSite, number>>
}

// ---------- derived / query results ----------

/** The sets from the most recent finished workout containing this exercise. */
export interface PrevPerformance {
  workoutDate: DayKey
  sets: Array<{ weightLb: number; reps: number }>
}

export interface WorkoutSummary {
  workout: Workout
  durationSec: number
  totalVolumeLb: number
  setCount: number
  /** exercise ids where max weight (or reps at same weight) beat all history */
  prs: Array<{ exerciseId: string; weightLb: number; reps: number }>
}

export interface DayFoodStats {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface DayDrinkStats {
  totalOz: number
  /** oz per drink kind, only for kinds logged that day */
  kinds: Partial<Record<DrinkKind, number>>
}

export interface WeekActivity {
  /** last 7 day keys, oldest first */
  days: Array<{ date: DayKey; workoutId?: string; routineName?: string }>
  /** total volume per ISO week, oldest first, up to 6 weeks */
  weeklyVolumeLb: number[]
}

/** Result of resolving a scanned QR url. */
export interface QrResolution {
  /** the user's machine record if this exact URL was mapped before */
  machine?: GymMachine
  /** catalog match when the URL is known community knowledge */
  model?: EquipmentModel
}

// ---------- the API the UI consumes ----------

export interface DataAPI {
  // exercises & machines
  listExercises(): Promise<Exercise[]>
  getExercise(id: string): Promise<Exercise | undefined>
  listMachines(): Promise<GymMachine[]>
  getMachine(id: string): Promise<GymMachine | undefined>
  saveMachine(m: GymMachine): Promise<void>
  resolveQr(url: string): Promise<QrResolution>
  getEquipmentModel(id: string): Promise<EquipmentModel | undefined>
  getMachineAiInfo(qrUrl: string): Promise<MachineAiInfo | undefined>
  saveMachineAiInfo(info: MachineAiInfo): Promise<void>
  getAiProgram(machineId: string): Promise<AiProgram | undefined>
  saveAiProgram(program: AiProgram): Promise<void>

  // routines
  listRoutines(): Promise<Routine[]>
  saveRoutine(r: Routine): Promise<void>
  deleteRoutine(id: string): Promise<void>

  // workouts
  getActiveWorkout(): Promise<Workout | undefined>
  startWorkout(routineId?: string): Promise<Workout>
  cancelWorkout(workoutId: string): Promise<void>
  finishWorkout(workoutId: string, notes?: string): Promise<WorkoutSummary>
  listSets(workoutId: string): Promise<WorkoutSet[]>
  logSet(s: Omit<WorkoutSet, 'id' | 'loggedAt'>): Promise<WorkoutSet>
  deleteSet(id: string): Promise<void>
  getPrevPerformance(exerciseId: string, beforeWorkoutId?: string): Promise<PrevPerformance | undefined>
  listBaselines(): Promise<StrengthBaseline[]>
  getBaseline(exerciseId: string): Promise<StrengthBaseline | undefined>
  saveBaseline(b: Omit<StrengthBaseline, 'at'>): Promise<StrengthBaseline>
  deleteBaseline(exerciseId: string): Promise<void>
  listRecentWorkouts(limit: number): Promise<WorkoutSummary[]>
  getWorkoutSummary(workoutId: string): Promise<WorkoutSummary | undefined>

  // food
  listFood(date: DayKey): Promise<FoodEntry[]>
  addFood(e: Omit<FoodEntry, 'id'>): Promise<FoodEntry>
  updateFood(e: FoodEntry): Promise<void>
  deleteFood(id: string): Promise<void>
  /** most recent food entries, one per distinct name, newest first */
  listRecentFood(limit: number): Promise<FoodEntry[]>
  getDayFoodStats(date: DayKey): Promise<DayFoodStats>
  listSavedMeals(): Promise<SavedMeal[]>
  saveSavedMeal(m: Omit<SavedMeal, 'id'> & { id?: string }): Promise<SavedMeal>
  // barcode product cache (device-local, not synced — it's public data)
  getCachedProduct(barcode: string): Promise<FoodProduct | undefined>
  cacheProduct(p: FoodProduct): Promise<void>

  // drinks & hydration
  listContainers(): Promise<Container[]>
  saveContainer(c: Omit<Container, 'id'> & { id?: string }): Promise<Container>
  deleteContainer(id: string): Promise<void>
  listDrinks(date: DayKey): Promise<DrinkEntry[]>
  addDrink(e: Omit<DrinkEntry, 'id'>): Promise<DrinkEntry>
  deleteDrink(id: string): Promise<void>
  getDayDrinkStats(date: DayKey): Promise<DayDrinkStats>

  // body records
  listBodyStats(limit?: number): Promise<BodyStatEntry[]>
  addBodyStat(e: Omit<BodyStatEntry, 'id'>): Promise<BodyStatEntry>
  deleteBodyStat(id: string): Promise<void>
  getLatestBodyStat(): Promise<BodyStatEntry | undefined>
  getBodyTrend(metric: BodyMetricKey, days: number): Promise<Array<{ at: number; value: number }>>
  listTape(limit?: number): Promise<TapeEntry[]>
  addTape(e: Omit<TapeEntry, 'id'>): Promise<TapeEntry>
  deleteTape(id: string): Promise<void>

  // history / settings
  getWeekActivity(): Promise<WeekActivity>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
}

/** Sensible default meal slot from the current hour. */
export function currentMealSlot(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

/** Local YYYY-MM-DD for a Date (never UTC — gym sessions belong to the local day). */
export function toDayKey(d: Date): DayKey {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
