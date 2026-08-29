import Dexie, { type Table } from 'dexie'
import type {
  BodyStatEntry, EquipmentModel, Exercise, FoodEntry, GymMachine, Routine, SavedMeal, Settings, TapeEntry, Workout, WorkoutSet,
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
export const syncFlags = { seeding: false }

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
  settings!: Table<SettingsRecord, 'settings'>
  outbox!: Table<OutboxEntry, string>

  constructor() {
    super('gym-tracker')
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
  }
}

export const db = new GymTrackerDatabase()
export type { SettingsRecord }
