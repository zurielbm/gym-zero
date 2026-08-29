import Dexie, { type Table } from 'dexie'
import type {
  EquipmentModel, Exercise, FoodEntry, GymMachine, Routine, SavedMeal, Settings, Workout, WorkoutSet,
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

class GymTrackerDatabase extends Dexie {
  exercises!: Table<Exercise, string>
  equipmentModels!: Table<EquipmentModelRecord, string>
  machines!: Table<MachineRecord, string>
  routines!: Table<Routine, string>
  workouts!: Table<Workout, string>
  sets!: Table<WorkoutSet, string>
  food!: Table<FoodEntry, string>
  savedMeals!: Table<SavedMeal, string>
  settings!: Table<SettingsRecord, 'settings'>

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
  }
}

export const db = new GymTrackerDatabase()
export type { SettingsRecord }
