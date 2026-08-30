import Dexie, { type Table } from 'dexie'
import { currentUser } from './auth-store'
import type {
  AiProgram, BodyStatEntry, EquipmentModel, Exercise, FoodEntry, FoodProduct, GymMachine, MachineAiInfo, Routine, SavedMeal, Settings, StrengthBaseline, TapeEntry, Workout, WorkoutSet,
} from '../types'

export interface EquipmentModelRecord extends EquipmentModel {
  /** Derived lookup field; not part of the public EquipmentModel contract. */
  qrKeys: string[]
}

export interface MachineRecord extends GymMachine {
  /** Derived lookup field; not part of the public GymMachine contract. */
  qrKey?: string
}

interface SettingsRecord extends Settings {
  id: 'settings'
}

/** Pending local change awaiting replication to the sync server. */
export interface OutboxEntry {
  /** `${table}:${id}` */
  key: string
  table: string
  id: string
  /** full row as stored locally; undefined = tombstone */
  doc?: unknown
  deleted: boolean
  updatedAt: number
}

/** Cross-module flags the sync hooks read at write time (avoids import cycles). */
export const syncFlags = {
  seeding: false,
  /** True while copying the legacy DB into an account DB; suppresses outbox capture. */
  adopting: false,
}

/** Database name of the pre-auth era; also used when running without a sync server. */
export const LEGACY_DB_NAME = 'gym-tracker'

class GymTrackerDatabase extends Dexie {
  exercises!: Table<Exercise, string>
  equipmentModels!: Table<EquipmentModelRecord, string>
  machines!: Table<MachineRecord, string>
  routines!: Table<Routine, string>
  workouts!: Table<Workout, string>
  sets!: Table<WorkoutSet, string>
  food!: Table<FoodEntry, string>
  savedMeals!: Table<SavedMeal, string>
  bodyStats!: Table<BodyStatEntry, string>
  tape!: Table<TapeEntry, string>
  machineAi!: Table<MachineAiInfo, string>
  aiPrograms!: Table<AiProgram, string>
  baselines!: Table<StrengthBaseline, string>
  products!: Table<FoodProduct, string>
  settings!: Table<SettingsRecord, 'settings'>
  outbox!: Table<OutboxEntry, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      exercises: 'id',
      equipmentModels: 'id,*qrKeys',
      machines: 'id,qrKey,exerciseId',
      routines: 'id',
      workouts: 'id,date,startedAt,finishedAt',
      sets: 'id,workoutId,exerciseId,loggedAt',
      food: 'id,date',
      savedMeals: 'id',
      settings: 'id',
    })
    this.version(2).stores({
      outbox: 'key',
    })
    this.version(3).stores({
      bodyStats: 'id,date,at',
      tape: 'id,date,at',
    })
    this.version(4).stores({
      machineAi: 'id',
    })
    this.version(5).stores({
      aiPrograms: 'id',
    })
    this.version(6).stores({
      baselines: 'id',
    })
    // barcode product cache; deliberately NOT in SYNC_TABLES — it's a local
    // cache of public Open Food Facts data, not user data
    this.version(7).stores({
      products: 'barcode',
    })
  }
}

// Each account gets its own local database so family members sharing a device
// never see each other's rows; signed out (or local-only builds) use the
// legacy name. Sign-in/out reloads the page, so the name is stable for the
// lifetime of the module.
const owner = currentUser()
export const db = new GymTrackerDatabase(owner ? `${LEGACY_DB_NAME}::${owner.id}` : LEGACY_DB_NAME)
export type { SettingsRecord }
