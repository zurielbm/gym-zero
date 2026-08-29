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

export type ExperienceLevel = 'new' | 'returning' | 'experienced'
export type TrainingGoal = 'muscle' | 'recomp' | 'fat-loss' | 'strength' | 'general'

export interface Settings {
  calorieTarget: number
  proteinTarget: number
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

  // workouts
  getActiveWorkout(): Promise<Workout | undefined>
  startWorkout(routineId?: string): Promise<Workout>
  cancelWorkout(workoutId: string): Promise<void>
  finishWorkout(workoutId: string, notes?: string): Promise<WorkoutSummary>
  listSets(workoutId: string): Promise<WorkoutSet[]>
  logSet(s: Omit<WorkoutSet, 'id' | 'loggedAt'>): Promise<WorkoutSet>
  deleteSet(id: string): Promise<void>
  getPrevPerformance(exerciseId: string, beforeWorkoutId?: string): Promise<PrevPerformance | undefined>
  listRecentWorkouts(limit: number): Promise<WorkoutSummary[]>
  getWorkoutSummary(workoutId: string): Promise<WorkoutSummary | undefined>

  // food
  listFood(date: DayKey): Promise<FoodEntry[]>
  addFood(e: Omit<FoodEntry, 'id'>): Promise<FoodEntry>
  deleteFood(id: string): Promise<void>
  getDayFoodStats(date: DayKey): Promise<DayFoodStats>
  listSavedMeals(): Promise<SavedMeal[]>
  saveSavedMeal(m: Omit<SavedMeal, 'id'> & { id?: string }): Promise<SavedMeal>

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

/** Local YYYY-MM-DD for a Date (never UTC — gym sessions belong to the local day). */
export function toDayKey(d: Date): DayKey {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
