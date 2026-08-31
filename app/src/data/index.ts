import type { BodyStatEntry, Container, DataAPI, DayDrinkStats, DayFoodStats, DrinkEntry, EquipmentModel, FoodEntry, GymMachine, PrevPerformance, QrResolution, SavedMeal, StrengthBaseline, TapeEntry, WeekActivity, WeekFoodStats, Workout, WorkoutSet, WorkoutSummary } from '../types'
import { epleyMaxLb, toDayKey } from '../types'
import { db, type EquipmentModelRecord, type MachineRecord } from './db'
import { normalizeQrUrl } from './qr'
import { ensureSeeded } from './seed'

export { normalizeQrUrl } from './qr'

const uid = () => crypto.randomUUID()
const ready = () => ensureSeeded()
const publicMachine = ({ qrKey: _qrKey, ...machine }: MachineRecord): GymMachine => machine
const publicModel = ({ qrKeys: _qrKeys, ...model }: EquipmentModelRecord): EquipmentModel => model

async function workoutSummary(workout: Workout): Promise<WorkoutSummary> {
  const workoutSets = await db.sets.where('workoutId').equals(workout.id).toArray()
  const totalVolumeLb = workoutSets.reduce((total, set) => total + set.weightLb * set.reps, 0)
  const prs: WorkoutSummary['prs'] = []
  for (const set of workoutSets) {
    const history = (await db.sets.where('exerciseId').equals(set.exerciseId).toArray()).filter((other) => other.workoutId !== workout.id && other.loggedAt < workout.startedAt)
    if (!history.length) continue
    const bestWeight = Math.max(...history.map((other) => other.weightLb))
    const bestReps = Math.max(...history.filter((other) => other.weightLb === bestWeight).map((other) => other.reps))
    if ((set.weightLb > bestWeight || (set.weightLb === bestWeight && set.reps > bestReps)) && !prs.some((pr) => pr.exerciseId === set.exerciseId)) prs.push({ exerciseId: set.exerciseId, weightLb: set.weightLb, reps: set.reps })
  }
  return { workout, durationSec: Math.round(((workout.finishedAt ?? Date.now()) - workout.startedAt) / 1000), totalVolumeLb, setCount: workoutSets.length, prs }
}

export const api: DataAPI = {
  async listExercises() { await ready(); return db.exercises.toArray() },
  async getExercise(id) { await ready(); return db.exercises.get(id) },
  async listMachines() { await ready(); return (await db.machines.toArray()).map(publicMachine) },
  async getMachine(id) { await ready(); const machine = await db.machines.get(id); return machine && publicMachine(machine) },
  async saveMachine(machine) { await ready(); const qrKey = machine.qrUrl ? normalizeQrUrl(machine.qrUrl) : undefined; await db.machines.put({ ...machine, ...(qrKey ? { qrKey } : {}) }) },
  async resolveQr(url) { await ready(); const key = normalizeQrUrl(url); const [machine, model] = await Promise.all([db.machines.where('qrKey').equals(key).first(), db.equipmentModels.where('qrKeys').equals(key).first()]); const result: QrResolution = {}; if (machine) result.machine = publicMachine(machine); if (model) result.model = publicModel(model); return result },
  async getEquipmentModel(id) { await ready(); const model = await db.equipmentModels.get(id); return model && publicModel(model) },
  async getMachineAiInfo(qrUrl) { await ready(); return db.machineAi.get(normalizeQrUrl(qrUrl)) },
  async saveMachineAiInfo(info) { await ready(); await db.machineAi.put(info) },
  async getAiProgram(machineId) { await ready(); return db.aiPrograms.get(machineId) },
  async saveAiProgram(program) { await ready(); await db.aiPrograms.put(program) },
  async listRoutines() { await ready(); return db.routines.toArray() },
  async saveRoutine(routine) { await ready(); await db.routines.put(routine) },
  async deleteRoutine(id) { await ready(); await db.routines.delete(id) },
  async getActiveWorkout() { await ready(); return db.workouts.filter((workout) => !workout.finishedAt).first() },
  async startWorkout(routineId) { await ready(); const workout: Workout = { id: uid(), date: toDayKey(new Date()), routineId, startedAt: Date.now() }; await db.transaction('rw', db.workouts, db.routines, async () => { await db.workouts.add(workout); if (routineId) await db.routines.update(routineId, { lastUsedAt: workout.startedAt }) }); return workout },
  async cancelWorkout(workoutId) { await ready(); await db.transaction('rw', db.workouts, db.sets, async () => { await db.workouts.delete(workoutId); await db.sets.where('workoutId').equals(workoutId).delete() }) },
  async finishWorkout(workoutId, notes) { await ready(); const workout = await db.workouts.get(workoutId); if (!workout) throw new Error('workout not found'); const finished: Workout = { ...workout, finishedAt: Date.now(), ...(notes ? { notes } : {}) }; await db.workouts.put(finished); return workoutSummary(finished) },
  async listSets(workoutId) { await ready(); return (await db.sets.where('workoutId').equals(workoutId).toArray()).sort((a, b) => a.loggedAt - b.loggedAt) },
  async logSet(set) {
    await ready()
    const full: WorkoutSet = { ...set, id: uid(), loggedAt: Date.now() }
    await db.sets.add(full)
    // a logged set that beats the baseline becomes the new baseline, so
    // "My strength" keeps tracking the user as they get stronger
    if (full.weightLb > 0 && full.reps > 0) {
      const baseline = await db.baselines.get(full.exerciseId)
      if (baseline && epleyMaxLb(full.weightLb, full.reps) > epleyMaxLb(baseline.weightLb, baseline.reps)) {
        await db.baselines.put({ id: full.exerciseId, weightLb: full.weightLb, reps: full.reps, at: full.loggedAt })
      }
    }
    return full
  },
  async deleteSet(id) {
    await ready()
    const set = await db.sets.get(id)
    if (!set) return
    await db.transaction('rw', db.sets, db.baselines, async () => {
      await db.sets.delete(id)
      // logSet may have promoted this set to the strength baseline; if it did,
      // re-derive from the remaining sets so a mistyped set can't keep
      // inflating weight suggestions after it's removed
      const baseline = await db.baselines.get(set.exerciseId)
      if (!baseline || baseline.weightLb !== set.weightLb || baseline.reps !== set.reps || baseline.at !== set.loggedAt) return
      const remaining = (await db.sets.where('exerciseId').equals(set.exerciseId).toArray()).filter((other) => other.weightLb > 0 && other.reps > 0)
      const best = remaining.sort((a, b) => epleyMaxLb(b.weightLb, b.reps) - epleyMaxLb(a.weightLb, a.reps))[0]
      if (best) await db.baselines.put({ id: set.exerciseId, weightLb: best.weightLb, reps: best.reps, at: best.loggedAt })
      else await db.baselines.delete(set.exerciseId)
    })
  },
  async getPrevPerformance(exerciseId, beforeWorkoutId) { await ready(); const before = beforeWorkoutId ? await db.workouts.get(beforeWorkoutId) : undefined; const candidates = (await db.workouts.toArray()).filter((workout) => Boolean(workout.finishedAt) && (!before || workout.startedAt < before.startedAt)).sort((a, b) => b.startedAt - a.startedAt); for (const workout of candidates) { const sets = (await db.sets.where('workoutId').equals(workout.id).toArray()).filter((set) => set.exerciseId === exerciseId).sort((a, b) => a.setNumber - b.setNumber); if (sets.length) { const performance: PrevPerformance = { workoutDate: workout.date, sets: sets.map(({ weightLb, reps }) => ({ weightLb, reps })) }; return performance } } return undefined },
  async listBaselines() { await ready(); return (await db.baselines.toArray()).sort((a, b) => b.at - a.at) },
  async getBaseline(exerciseId) { await ready(); return db.baselines.get(exerciseId) },
  async saveBaseline(baseline) { await ready(); const full: StrengthBaseline = { ...baseline, at: Date.now() }; await db.baselines.put(full); return full },
  async deleteBaseline(exerciseId) { await ready(); await db.baselines.delete(exerciseId) },
  async listRecentWorkouts(limit) { await ready(); const workouts = (await db.workouts.toArray()).filter((workout) => Boolean(workout.finishedAt)).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit); return Promise.all(workouts.map(workoutSummary)) },
  async getWorkoutSummary(workoutId) { await ready(); const workout = await db.workouts.get(workoutId); return workout ? workoutSummary(workout) : undefined },
  async listFood(date) { await ready(); return db.food.where('date').equals(date).toArray() },
  async addFood(entry) { await ready(); const full: FoodEntry = { ...entry, id: uid() }; await db.food.add(full); return full },
  async updateFood(entry) { await ready(); await db.food.put(entry) },
  async deleteFood(id) {
    await ready()
    const entry = await db.food.get(id)
    await db.transaction('rw', db.food, db.drinks, async () => {
      await db.food.delete(id)
      // a drink-logged shake/soda pairs with its food entry; removing one half
      // silently keeping the other would double- or under-count the day
      if (entry) await db.drinks.where('date').equals(entry.date).filter((d) => d.foodEntryId === id).delete()
    })
  },
  async listRecentFood(limit) {
    await ready()
    const seen = new Set<string>()
    const recent: FoodEntry[] = []
    // newest day first; within a day order is insertion order, good enough here
    const all = await db.food.orderBy('date').reverse().toArray()
    for (const entry of all) {
      const key = entry.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      recent.push(entry)
      if (recent.length >= limit) break
    }
    return recent
  },
  async getDayFoodStats(date) { await ready(); const food = await db.food.where('date').equals(date).toArray(); return { calories: food.reduce((total, entry) => total + entry.calories, 0), protein: food.reduce((total, entry) => total + entry.protein, 0), carbs: food.reduce((total, entry) => total + (entry.carbs ?? 0), 0), fat: food.reduce((total, entry) => total + (entry.fat ?? 0), 0) } },
  async getWeekFoodStats() {
    await ready()
    const dayKeyAgo = (offset: number) => { const day = new Date(); day.setDate(day.getDate() - offset); return toDayKey(day) }
    // 28 days of food (the 4-week trend), 7 days of drinks; date keys sort lexicographically
    const [food, drinks] = await Promise.all([
      db.food.where('date').between(dayKeyAgo(27), dayKeyAgo(0), true, true).toArray(),
      db.drinks.where('date').between(dayKeyAgo(6), dayKeyAgo(0), true, true).toArray(),
    ])
    const foodByDate = new Map<string, DayFoodStats>()
    for (const entry of food) {
      const stats = foodByDate.get(entry.date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }
      stats.calories += entry.calories
      stats.protein += entry.protein
      stats.carbs += entry.carbs ?? 0
      stats.fat += entry.fat ?? 0
      foodByDate.set(entry.date, stats)
    }
    const waterByDate = new Map<string, number>()
    for (const drink of drinks) waterByDate.set(drink.date, (waterByDate.get(drink.date) ?? 0) + drink.volumeOz)
    // averages count logged days only, so a forgotten day can't drag the week down
    const windowAvg = (fromOffset: number, toOffset: number) => {
      const sum = { calories: 0, protein: 0, carbs: 0, fat: 0 }
      let loggedDays = 0
      for (let offset = fromOffset; offset >= toOffset; offset -= 1) {
        const stats = foodByDate.get(dayKeyAgo(offset))
        if (!stats) continue
        loggedDays += 1
        sum.calories += stats.calories
        sum.protein += stats.protein
        sum.carbs += stats.carbs
        sum.fat += stats.fat
      }
      const per = (total: number) => (loggedDays ? Math.round(total / loggedDays) : 0)
      return { calories: per(sum.calories), protein: per(sum.protein), carbs: per(sum.carbs), fat: per(sum.fat) }
    }
    const days: WeekFoodStats['days'] = []
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = dayKeyAgo(offset)
      const stats = foodByDate.get(date)
      days.push({ date, calories: stats?.calories ?? 0, protein: stats?.protein ?? 0, carbs: stats?.carbs ?? 0, fat: stats?.fat ?? 0, waterOz: Math.round(waterByDate.get(date) ?? 0), logged: Boolean(stats) })
    }
    const drinkDays = days.filter((day) => day.waterOz > 0)
    const avgWaterOz = drinkDays.length ? Math.round(drinkDays.reduce((total, day) => total + day.waterOz, 0) / drinkDays.length) : 0
    const prev = windowAvg(13, 7)
    const weeklyAvgCalories = [windowAvg(27, 21), windowAvg(20, 14), prev, windowAvg(6, 0)].map((week) => week.calories)
    return { days, avg: windowAvg(6, 0), avgWaterOz, prevAvg: { calories: prev.calories, protein: prev.protein }, weeklyAvgCalories }
  },
  async listSavedMeals() { await ready(); return db.savedMeals.toArray() },
  async saveSavedMeal(meal) { await ready(); const full: SavedMeal = { ...meal, id: meal.id ?? uid() }; await db.savedMeals.put(full); return full },
  async getCachedProduct(barcode) { await ready(); return db.products.get(barcode) },
  async cacheProduct(product) { await ready(); await db.products.put(product) },
  async listContainers() { await ready(); return (await db.containers.toArray()).sort((a, b) => a.sortOrder - b.sortOrder) },
  async saveContainer(container) { await ready(); const full: Container = { ...container, id: container.id ?? uid() }; await db.containers.put(full); return full },
  async deleteContainer(id) { await ready(); await db.containers.delete(id) },
  async listDrinks(date) { await ready(); return (await db.drinks.where('date').equals(date).toArray()).sort((a, b) => a.at - b.at) },
  async addDrink(entry) { await ready(); const full: DrinkEntry = { ...entry, id: uid() }; await db.drinks.add(full); return full },
  async deleteDrink(id) {
    await ready()
    const drink = await db.drinks.get(id)
    await db.transaction('rw', db.drinks, db.food, async () => {
      await db.drinks.delete(id)
      if (drink?.foodEntryId) await db.food.delete(drink.foodEntryId)
    })
  },
  async getDayDrinkStats(date) { await ready(); const drinks = await db.drinks.where('date').equals(date).toArray(); const stats: DayDrinkStats = { totalOz: 0, kinds: {} }; for (const drink of drinks) { stats.totalOz += drink.volumeOz; stats.kinds[drink.kind] = (stats.kinds[drink.kind] ?? 0) + drink.volumeOz } stats.totalOz = Math.round(stats.totalOz); return stats },
  async listBodyStats(limit) { await ready(); const q = db.bodyStats.orderBy('at').reverse(); return limit ? q.limit(limit).toArray() : q.toArray() },
  async addBodyStat(entry) { await ready(); const full: BodyStatEntry = { ...entry, id: uid() }; const settings = await db.settings.get('settings'); if (full.weightLb && full.bmi === undefined && settings?.heightIn) full.bmi = Math.round(((703 * full.weightLb) / settings.heightIn ** 2) * 10) / 10; await db.transaction('rw', db.bodyStats, db.settings, async () => { await db.bodyStats.add(full); const newest = await db.bodyStats.orderBy('at').reverse().first(); if (settings && full.weightLb && newest?.id === full.id) await db.settings.put({ ...settings, bodyWeightLb: full.weightLb }) }); return full },
  async deleteBodyStat(id) { await ready(); await db.bodyStats.delete(id) },
  async getLatestBodyStat() { await ready(); return db.bodyStats.orderBy('at').reverse().first() },
  async getBodyTrend(metric, days) { await ready(); const since = Date.now() - days * 86400_000; return (await db.bodyStats.where('at').above(since).toArray()).filter((entry) => entry[metric] !== undefined).sort((a, b) => a.at - b.at).map((entry) => ({ at: entry.at, value: entry[metric] as number })) },
  async listTape(limit) { await ready(); const q = db.tape.orderBy('at').reverse(); return limit ? q.limit(limit).toArray() : q.toArray() },
  async addTape(entry) { await ready(); const full: TapeEntry = { ...entry, id: uid() }; await db.tape.add(full); return full },
  async deleteTape(id) { await ready(); await db.tape.delete(id) },
  async getWeekActivity() { await ready(); const [workouts, routines, sets] = await Promise.all([db.workouts.toArray(), db.routines.toArray(), db.sets.toArray()]); const names = new Map(routines.map((routine) => [routine.id, routine.name])); const days: WeekActivity['days'] = []; for (let offset = 6; offset >= 0; offset -= 1) { const day = new Date(); day.setDate(day.getDate() - offset); const date = toDayKey(day); const workout = workouts.find((candidate) => candidate.date === date && Boolean(candidate.finishedAt)); days.push(workout ? { date, workoutId: workout.id, routineName: workout.routineId ? names.get(workout.routineId) : undefined } : { date }) } const weeklyVolumeLb: number[] = []; for (let week = 5; week >= 0; week -= 1) { const end = Date.now() - week * 7 * 86400_000; const start = end - 7 * 86400_000; weeklyVolumeLb.push(sets.filter((set) => set.loggedAt > start && set.loggedAt <= end).reduce((total, set) => total + set.weightLb * set.reps, 0)) } return { days, weeklyVolumeLb } },
  async getSettings() { await ready(); const settings = await db.settings.get('settings'); if (!settings) throw new Error('settings not found'); const { id: _id, ...publicSettings } = settings; return publicSettings },
  async saveSettings(settings) { await ready(); await db.settings.put({ id: 'settings', ...settings }) },
}

export default api
