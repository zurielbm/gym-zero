import type { EquipmentModelRecord } from './db'
import { db } from './db'
import { normalizeQrUrl } from './qr'
import type { Exercise, Routine, SavedMeal, Settings } from '../types'

const exercises: Exercise[] = [
  { id: 'ex-chest-press', name: 'Chest Press', muscleGroups: ['chest', 'triceps'], equipment: 'machine' },
  { id: 'ex-incline-press', name: 'Incline Press', muscleGroups: ['chest', 'shoulders'], equipment: 'machine' },
  { id: 'ex-shoulder-press', name: 'Shoulder Press', muscleGroups: ['shoulders', 'triceps'], equipment: 'machine' },
  { id: 'ex-pec-fly', name: 'Pec Fly', muscleGroups: ['chest'], equipment: 'machine' },
  { id: 'ex-triceps-pressdown', name: 'Triceps Pressdown', muscleGroups: ['triceps'], equipment: 'cable' },
  { id: 'ex-lat-pulldown', name: 'Lat Pulldown', muscleGroups: ['back', 'biceps'], equipment: 'cable' },
  { id: 'ex-seated-row', name: 'Seated Row', muscleGroups: ['back'], equipment: 'cable' },
  { id: 'ex-rear-delt-fly', name: 'Rear Delt Fly', muscleGroups: ['shoulders', 'back'], equipment: 'machine' },
  { id: 'ex-cable-curl', name: 'Cable Curl', muscleGroups: ['biceps'], equipment: 'cable' },
  { id: 'ex-assisted-pullup', name: 'Assisted Pull-up', muscleGroups: ['back', 'biceps'], equipment: 'machine' },
  { id: 'ex-leg-press', name: 'Leg Press', muscleGroups: ['quads', 'glutes'], equipment: 'machine' },
  { id: 'ex-leg-extension', name: 'Leg Extension', muscleGroups: ['quads'], equipment: 'machine' },
  { id: 'ex-leg-curl', name: 'Leg Curl', muscleGroups: ['hamstrings'], equipment: 'machine' },
  { id: 'ex-hip-abductor', name: 'Hip Abductor', muscleGroups: ['glutes', 'hips'], equipment: 'machine' },
  { id: 'ex-calf-raise', name: 'Calf Raise', muscleGroups: ['calves'], equipment: 'machine' },
  { id: 'ex-hack-squat', name: 'Hack Squat', muscleGroups: ['quads', 'glutes'], equipment: 'machine' },
  { id: 'ex-smith-machine-squat', name: 'Smith Machine Squat', muscleGroups: ['quads', 'glutes'], equipment: 'free' },
  { id: 'ex-biceps-curl-machine', name: 'Biceps Curl Machine', muscleGroups: ['biceps'], equipment: 'machine' },
  { id: 'ex-triceps-press-machine', name: 'Triceps Press Machine', muscleGroups: ['triceps'], equipment: 'machine' },
  { id: 'ex-cable-lateral-raise', name: 'Cable Lateral Raise', muscleGroups: ['shoulders'], equipment: 'cable' },
  { id: 'ex-seated-calf-raise', name: 'Seated Calf Raise', muscleGroups: ['calves'], equipment: 'machine' },
  { id: 'ex-back-extension', name: 'Back Extension', muscleGroups: ['back', 'glutes'], equipment: 'machine' },
  { id: 'ex-ab-crunch-machine', name: 'Ab Crunch Machine', muscleGroups: ['core'], equipment: 'machine' },
]

const model = (id: string, modelName: string, exerciseId: string, muscleGroups: EquipmentModelRecord['muscleGroups'], qrUrls: string[] = []): EquipmentModelRecord => ({
  id, manufacturer: 'Life Fitness', modelName, qrUrls, qrKeys: qrUrls.map(normalizeQrUrl),
  videoUrl: qrUrls[0] ?? 'https://www.youtube.com/@LifeFitnessTraining', muscleGroups, exerciseIds: [exerciseId],
})

const models: EquipmentModelRecord[] = [
  model('em-lf-seated-leg-press', 'Seated Leg Press', 'ex-leg-press', ['quads', 'glutes', 'hamstrings'], ['https://www.youtube.com/watch?v=4s3rkgBX5So']),
  model('em-lf-chest-press', 'Chest Press', 'ex-chest-press', ['chest', 'triceps']),
  model('em-lf-shoulder-press', 'Shoulder Press', 'ex-shoulder-press', ['shoulders', 'triceps']),
  model('em-lf-lat-pulldown', 'Lat Pulldown', 'ex-lat-pulldown', ['back', 'biceps']),
  model('em-lf-seated-row', 'Seated Row', 'ex-seated-row', ['back']),
  model('em-lf-leg-extension', 'Leg Extension', 'ex-leg-extension', ['quads']),
  model('em-lf-leg-curl', 'Leg Curl', 'ex-leg-curl', ['hamstrings']),
  model('em-lf-pec-fly', 'Pec Fly', 'ex-pec-fly', ['chest']),
]

const routines: Routine[] = [
  { id: 'rt-push', name: 'Push', emoji: '🫸', items: [{ exerciseId: 'ex-chest-press', targetSets: 3 }, { exerciseId: 'ex-incline-press', targetSets: 3 }, { exerciseId: 'ex-shoulder-press', targetSets: 3 }, { exerciseId: 'ex-pec-fly', targetSets: 3 }, { exerciseId: 'ex-triceps-pressdown', targetSets: 3 }] },
  { id: 'rt-pull', name: 'Pull', emoji: '🫷', items: [{ exerciseId: 'ex-lat-pulldown', targetSets: 3 }, { exerciseId: 'ex-seated-row', targetSets: 3 }, { exerciseId: 'ex-rear-delt-fly', targetSets: 3 }, { exerciseId: 'ex-cable-curl', targetSets: 3 }, { exerciseId: 'ex-assisted-pullup', targetSets: 3 }] },
  { id: 'rt-legs', name: 'Legs', emoji: '🦵', items: [{ exerciseId: 'ex-leg-press', targetSets: 4 }, { exerciseId: 'ex-leg-extension', targetSets: 3 }, { exerciseId: 'ex-leg-curl', targetSets: 3 }, { exerciseId: 'ex-hip-abductor', targetSets: 3 }, { exerciseId: 'ex-calf-raise', targetSets: 4 }] },
]

const savedMeals: SavedMeal[] = [
  { id: 'sm-shake', name: 'Protein shake', emoji: '🥤', calories: 340, protein: 48 },
  { id: 'sm-chipotle', name: 'Chipotle bowl', emoji: '🌯', calories: 780, protein: 54 },
  { id: 'sm-eggs', name: 'Eggs + toast', emoji: '🍳', calories: 420, protein: 28 },
]
const settings: Settings = { calorieTarget: 2200, proteinTarget: 180, restSeconds: 90 }

let ready: Promise<void> | undefined

/** Opens the local database and writes seed data only to a completely fresh catalog. */
export function ensureSeeded(): Promise<void> {
  ready ??= db.open().then(async () => {
    if (await db.exercises.count() !== 0) return
    await db.transaction('rw', db.exercises, db.equipmentModels, db.routines, db.savedMeals, db.settings, async () => {
      await db.exercises.bulkAdd(exercises)
      await db.equipmentModels.bulkAdd(models)
      await db.routines.bulkAdd(routines)
      await db.savedMeals.bulkAdd(savedMeals)
      await db.settings.add({ id: 'settings', ...settings })
    })
  })
  return ready
}
