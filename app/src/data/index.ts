import type { BodyStatEntry, DataAPI, EquipmentModel, FoodEntry, GymMachine, PrevPerformance, QrResolution, SavedMeal, TapeEntry, WeekActivity, Workout, WorkoutSet, WorkoutSummary } from '../types'
import { toDayKey } from '../types'
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
  async getActiveWorkout() { await ready(); return db.workouts.filter((workout) => !workout.finishedAt).first() },
  async startWorkout(routineId) { await ready(); const workout: Workout = { id: uid(), date: toDayKey(new Date()), routineId, startedAt: Date.now() }; await db.transaction('rw', db.workouts, db.routines, async () => { await db.workouts.add(workout); if (routineId) await db.routines.update(routineId, { lastUsedAt: workout.startedAt }) }); return workout },
  async cancelWorkout(workoutId) { await ready(); await db.transaction('rw', db.workouts, db.sets, async () => { await db.workouts.delete(workoutId); await db.sets.where('workoutId').equals(workoutId).delete() }) },
  async finishWorkout(workoutId, notes) { await ready(); const workout = await db.workouts.get(workoutId); if (!workout) throw new Error('workout not found'); const finished: Workout = { ...workout, finishedAt: Date.now(), ...(notes ? { notes } : {}) }; await db.workouts.put(finished); return workoutSummary(finished) },
  async listSets(workoutId) { await ready(); return (await db.sets.where('workoutId').equals(workoutId).toArray()).sort((a, b) => a.loggedAt - b.loggedAt) },
  async logSet(set) { await ready(); const full: WorkoutSet = { ...set, id: uid(), loggedAt: Date.now() }; await db.sets.add(full); return full },
  async deleteSet(id) { await ready(); await db.sets.delete(id) },
  async getPrevPerformance(exerciseId, beforeWorkoutId) { await ready(); const before = beforeWorkoutId ? await db.workouts.get(beforeWorkoutId) : undefined; const candidates = (await db.workouts.toArray()).filter((workout) => Boolean(workout.finishedAt) && (!before || workout.startedAt < before.startedAt)).sort((a, b) => b.startedAt - a.startedAt); for (const workout of candidates) { const sets = (await db.sets.where('workoutId').equals(workout.id).toArray()).filter((set) => set.exerciseId === exerciseId).sort((a, b) => a.setNumber - b.setNumber); if (sets.length) { const performance: PrevPerformance = { workoutDate: workout.date, sets: sets.map(({ weightLb, reps }) => ({ weightLb, reps })) }; return performance } } return undefined },
  async listRecentWorkouts(limit) { await ready(); const workouts = (await db.workouts.toArray()).filter((workout) => Boolean(workout.finishedAt)).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit); return Promise.all(workouts.map(workoutSummary)) },
  async getWorkoutSummary(workoutId) { await ready(); const workout = await db.workouts.get(workoutId); return workout ? workoutSummary(workout) : undefined },
  async listFood(date) { await ready(); return db.food.where('date').equals(date).toArray() },
  async addFood(entry) { await ready(); const full: FoodEntry = { ...entry, id: uid() }; await db.food.add(full); return full },
  async deleteFood(id) { await ready(); await db.food.delete(id) },
  async getDayFoodStats(date) { await ready(); const food = await db.food.where('date').equals(date).toArray(); return { calories: food.reduce((total, entry) => total + entry.calories, 0), protein: food.reduce((total, entry) => total + entry.protein, 0) } },
  async listSavedMeals() { await ready(); return db.savedMeals.toArray() },
  async saveSavedMeal(meal) { await ready(); const full: SavedMeal = { ...meal, id: meal.id ?? uid() }; await db.savedMeals.put(full); return full },
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
