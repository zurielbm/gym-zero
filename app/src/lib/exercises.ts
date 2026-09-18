import type { ActivityCategory, ActivityLog, Exercise, MuscleGroup, WorkoutSet } from '../types'
import { ACTIVITY_CATEGORIES, MUSCLE_GROUPS, RECORDING_FORMATS } from '../types'

export const exerciseNameKey = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, ' ')
export const exerciseNames = (exercise: Pick<Exercise, 'name' | 'aliases'>) => [exercise.name, ...(exercise.aliases ?? [])].map(exerciseNameKey)

export function normalizeExercise(input: Omit<Exercise, 'id'> & { id?: string }): Omit<Exercise, 'id'> & { id?: string } {
  const name = input.name?.trim()
  if (!name || name.length > 100) throw new Error('Give the exercise a name of 1–100 characters.')
  if (!['machine', 'cable', 'free', 'bodyweight'].includes(input.equipment)) throw new Error('Choose the equipment type.')
  const categories: ActivityCategory[] = [...new Set<ActivityCategory>(input.categories ?? ['strength'])]
  if (!categories.length || categories.some((c) => !ACTIVITY_CATEGORIES.includes(c))) throw new Error('Choose at least one activity category.')
  const primaryCategory = input.primaryCategory ?? categories[0]!
  if (!categories.includes(primaryCategory)) throw new Error('The primary category must be selected.')
  const recordingFormat = input.recordingFormat ?? 'weight-reps'
  if (!RECORDING_FORMATS.includes(recordingFormat)) throw new Error('Choose how to log this exercise.')
  const muscles = (values: MuscleGroup[] = []) => {
    if (!Array.isArray(values) || values.some((v) => !MUSCLE_GROUPS.includes(v))) throw new Error('Choose muscle areas from the list.')
    return [...new Set(values)]
  }
  const primaryMuscles = input.primaryMuscles === undefined ? undefined : muscles(input.primaryMuscles)
  const supportingMuscles = input.supportingMuscles === undefined ? undefined : muscles(input.supportingMuscles).filter((m) => !primaryMuscles?.includes(m))
  const muscleGroups = muscles([...(input.muscleGroups ?? []), ...(primaryMuscles ?? []), ...(supportingMuscles ?? [])])
  const aliases = [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))].slice(0, 12)
  if (aliases.some((a) => a.length > 100)) throw new Error('Exercise aliases must be at most 100 characters.')
  return { ...input, name, categories, primaryCategory, recordingFormat, primaryMuscles, supportingMuscles, muscleGroups, aliases }
}

/** Invalid/future timed schemas remain stored for a newer app, but cannot enter current calculations. */
export function isActivityLog(value: unknown): value is ActivityLog {
  if (!value || typeof value !== 'object') return false
  const v = value as ActivityLog
  return v.schemaVersion === 1 && typeof v.id === 'string' && typeof v.workoutId === 'string'
    && typeof v.exerciseId === 'string' && ['duration', 'duration-distance', 'timed-sets'].includes(v.recordingFormat)
    && Number.isFinite(v.durationSec) && v.durationSec > 0
    && Number.isInteger(v.entryNumber) && v.entryNumber > 0 && Number.isFinite(v.loggedAt)
    && Array.isArray(v.categories) && v.categories.every((c) => ACTIVITY_CATEGORIES.includes(c))
    && (v.distanceMiles === undefined || (Number.isFinite(v.distanceMiles) && v.distanceMiles >= 0))
    && (v.resistance === undefined || (Number.isFinite(v.resistance) && v.resistance >= 0))
}

export const activityIsCardio = (activity: ActivityLog) => activity.categories.includes('cardio')
export const setVolume = (set: WorkoutSet): number => (!set.recordingFormat || set.recordingFormat === 'weight-reps') && Number.isFinite(set.weightLb * set.reps) ? Math.max(0, set.weightLb * set.reps) : 0
export const isWeightedSet = (set: WorkoutSet): boolean => (!set.recordingFormat || set.recordingFormat === 'weight-reps') && set.weightLb > 0 && set.reps > 0
export const formatActivity = (entry: Pick<ActivityLog, 'durationSec' | 'distanceMiles' | 'resistance'>): string => [
  `${Number((entry.durationSec / 60).toFixed(2))} min`,
  entry.distanceMiles !== undefined ? `${entry.distanceMiles} mi` : '',
  entry.resistance !== undefined ? `resistance ${entry.resistance}` : '',
].filter(Boolean).join(' · ')
export const exerciseCategories = (exercise?: Exercise): ActivityCategory[] => exercise?.categories ?? ['strength']
