import Dexie from 'dexie'
import type { EquipmentModelRecord } from './db'
import { db, syncFlags, LEGACY_DB_NAME } from './db'
import { normalizeQrUrl } from './qr'
import type { BodyStatEntry, Container, Exercise, Routine, SavedMeal, Settings, TapeEntry } from '../types'

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

/**
 * Guided assessment: one session across the six machines that cover every
 * major movement pattern. Added if-absent (not only on fresh installs) so
 * existing databases get it too; there is no routine delete, so this never
 * resurrects anything.
 */
export const STRENGTH_CHECK_ROUTINE_ID = 'rt-strength-check'
const strengthCheckRoutine: Routine = {
  id: STRENGTH_CHECK_ROUTINE_ID,
  name: 'Strength Check',
  emoji: '🎯',
  items: [
    { exerciseId: 'ex-chest-press', targetSets: 2 },
    { exerciseId: 'ex-lat-pulldown', targetSets: 2 },
    { exerciseId: 'ex-seated-row', targetSets: 2 },
    { exerciseId: 'ex-shoulder-press', targetSets: 2 },
    { exerciseId: 'ex-leg-press', targetSets: 2 },
    { exerciseId: 'ex-leg-curl', targetSets: 2 },
  ],
}

const savedMeals: SavedMeal[] = [
  { id: 'sm-shake', name: 'Protein shake', emoji: '🥤', calories: 340, protein: 48 },
  { id: 'sm-chipotle', name: 'Chipotle bowl', emoji: '🌯', calories: 780, protein: 54 },
  { id: 'sm-eggs', name: 'Eggs + toast', emoji: '🍳', calories: 420, protein: 28 },
]
const settings: Settings = { calorieTarget: 2200, proteinTarget: 180, restSeconds: 90 }

/**
 * Starter drink containers so hydration is tappable on day one. Seeded whenever
 * the user has no containers AND has never logged a drink — never re-added once
 * drink logging is in use, so deliberate deletions stay deleted.
 */
const containers: Container[] = [
  { id: 'ct-bottle', name: 'Bottle', emoji: '🚰', volumeOz: 24, kind: 'water', sortOrder: 0 },
  { id: 'ct-glass', name: 'Glass', emoji: '🥛', volumeOz: 8, kind: 'water', sortOrder: 1 },
  { id: 'ct-electrolyte', name: 'Electrolytes', emoji: '⚡', volumeOz: 20, kind: 'electrolyte', sortOrder: 2 },
]

/**
 * Optional personal seed. `src/data/seed.local.ts` is gitignored, so private
 * records (body readings, tape sessions) stay out of the repo; a fresh clone
 * simply has no such module and this glob is empty. Rows use fixed ids and are
 * only added when absent — an edit or delete synced from another device wins.
 */
type LocalSeed = { bodyStats?: BodyStatEntry[]; tape?: TapeEntry[] }
const localSeedModules = import.meta.glob<LocalSeed>('./seed.local.ts')

async function seedLocal(): Promise<void> {
  for (const load of Object.values(localSeedModules)) {
    const mod = await load()
    syncFlags.seeding = true
    try {
      await db.transaction('rw', db.bodyStats, db.tape, async () => {
        for (const entry of mod.bodyStats ?? []) if (!(await db.bodyStats.get(entry.id))) await db.bodyStats.add(entry)
        for (const entry of mod.tape ?? []) if (!(await db.tape.get(entry.id))) await db.tape.add(entry)
      })
    } finally {
      syncFlags.seeding = false
    }
  }
}

const ADOPTED_LS = 'gym.legacy.adopted'

/**
 * One-time copy of the pre-auth local database into a fresh account database,
 * so anything recorded before accounts existed (possibly never synced) isn't
 * stranded. Only the first account to sign in on a device adopts; the legacy
 * database itself is left untouched as a safety net. The copied rows reach the
 * server through the first sync's pull-then-diff merge, not through the outbox,
 * so a stale device can never clobber newer server data (see sync.ts).
 */
async function adoptLegacyDb(): Promise<boolean> {
  if (db.name === LEGACY_DB_NAME) return false
  if (localStorage.getItem(ADOPTED_LS)) return false
  if (!('databases' in indexedDB)) return false
  const names = (await indexedDB.databases()).map((d) => d.name)
  if (!names.includes(LEGACY_DB_NAME)) return false
  const legacy = new Dexie(LEGACY_DB_NAME)
  try {
    await legacy.open() // no schema declared: opens whatever versions exist
    if ((await legacy.table('exercises').count()) === 0) return false
    syncFlags.adopting = true
    try {
      for (const table of legacy.tables) {
        if (table.name === 'outbox') continue
        if (!db.tables.some((t) => t.name === table.name)) continue
        await db.table(table.name).bulkPut(await table.toArray())
      }
    } finally {
      syncFlags.adopting = false
    }
    localStorage.setItem(ADOPTED_LS, db.name)
    return true
  } catch {
    return false
  } finally {
    legacy.close()
  }
}

let ready: Promise<void> | undefined

/** Opens the local database and writes seed data only to a completely fresh catalog. */
export function ensureSeeded(): Promise<void> {
  ready ??= db.open().then(async () => {
    if (await db.exercises.count() === 0 && !(await adoptLegacyDb())) {
      // Seed writes replicate with a floor timestamp so they never beat a real
      // user edit already on the sync server (e.g. a customized calorie target).
      syncFlags.seeding = true
      try {
        await db.transaction('rw', db.exercises, db.equipmentModels, db.routines, db.savedMeals, db.settings, async () => {
          await db.exercises.bulkAdd(exercises)
          await db.equipmentModels.bulkAdd(models)
          await db.routines.bulkAdd(routines)
          await db.savedMeals.bulkAdd(savedMeals)
          await db.settings.add({ id: 'settings', ...settings })
        })
      } finally {
        syncFlags.seeding = false
      }
    }
    if (!(await db.routines.get(strengthCheckRoutine.id))) {
      syncFlags.seeding = true
      try {
        await db.routines.add(strengthCheckRoutine)
      } finally {
        syncFlags.seeding = false
      }
    }
    if (await db.containers.count() === 0 && await db.drinks.count() === 0) {
      syncFlags.seeding = true
      try {
        await db.containers.bulkAdd(containers)
      } finally {
        syncFlags.seeding = false
      }
    }
    await seedLocal()
  })
  return ready
}
