import type { ActivityLog, Exercise, WorkoutSet } from '../types'
import { exerciseMuscles, muscleLabels, type MuscleRegion } from './exercise-muscles'
import { setVolume } from './exercises'

export type MuscleSource = 'guide' | 'saved-roles' | 'saved-groups' | 'none'
export type RegionLevel = 'primary' | 'secondary' | 'inactive'

export interface OverviewExercise {
  exerciseId: string
  /** Undefined when the exercise record was deleted after logging. */
  name?: string
  sets: number
  reps: number
  volumeLb: number
  /** Heaviest weighted set, for a one-line recap. */
  topSet?: { weightLb: number; reps: number }
  repsOnly: boolean
  entries: number
  durationSec: number
  distanceMiles: number
  primary: MuscleRegion[]
  secondary: MuscleRegion[]
  source: MuscleSource
}

export interface RegionHit {
  region: MuscleRegion
  label: string
  /** Names of logged exercises that involved this region in this role; a region never counts twice. */
  exercises: string[]
  /** For main regions: exercises where the region only assisted. Listed, never added to the count. */
  alsoAssisting: string[]
}

export interface WorkoutOverview {
  exercises: OverviewExercise[]
  liftingSets: number
  reps: number
  main: RegionHit[]
  assisting: RegionHit[]
  levels: Partial<Record<MuscleRegion, RegionLevel>>
  /** Logged exercises with no muscle data to map. */
  unmapped: OverviewExercise[]
}

const regionOrder = Object.keys(muscleLabels) as MuscleRegion[]
const inOrder = (regions: Iterable<MuscleRegion>) => { const set = new Set(regions); return regionOrder.filter(region => set.has(region)) }

/** Main/assisting regions for one exercise. Built-in guides win; custom exercises use their saved roles, then saved groups. */
export function overviewMuscles(exercise: Exercise | undefined): Pick<OverviewExercise, 'primary' | 'secondary' | 'source'> {
  if (!exercise) return { primary: [], secondary: [], source: 'none' }
  const profile = exerciseMuscles(exercise)
  if (!profile.general) return { primary: inOrder(profile.primary), secondary: inOrder(profile.secondary.filter(region => !profile.primary.includes(region))), source: 'guide' }
  if (exercise.primaryMuscles?.length) {
    const primary = exerciseMuscles({ ...exercise, muscleGroups: exercise.primaryMuscles }).primary
    const secondary = exerciseMuscles({ ...exercise, muscleGroups: exercise.supportingMuscles ?? [] }).primary.filter(region => !primary.includes(region))
    return { primary: inOrder(primary), secondary: inOrder(secondary), source: 'saved-roles' }
  }
  if (profile.primary.length) return { primary: inOrder(profile.primary), secondary: [], source: 'saved-groups' }
  return { primary: [], secondary: [], source: 'none' }
}

/**
 * Aggregates only what was actually logged in this session: exercises with at least one
 * WorkoutSet or ActivityLog. Planned but unlogged routine items never reach the map.
 * Muscle involvement is estimated from exercise profiles; it is not intensity or recovery.
 */
export function buildWorkoutOverview(sets: WorkoutSet[], activities: ActivityLog[], exercises: Map<string, Exercise>): WorkoutOverview {
  const rows = new Map<string, OverviewExercise>()
  const firstAt = new Map<string, number>()
  const row = (exerciseId: string, at: number) => {
    let found = rows.get(exerciseId)
    if (!found) {
      const exercise = exercises.get(exerciseId)
      found = { exerciseId, name: exercise?.name, sets: 0, reps: 0, volumeLb: 0, repsOnly: true, entries: 0, durationSec: 0, distanceMiles: 0, ...overviewMuscles(exercise) }
      rows.set(exerciseId, found)
    }
    firstAt.set(exerciseId, Math.min(firstAt.get(exerciseId) ?? at, at))
    return found
  }
  for (const set of sets) {
    const r = row(set.exerciseId, set.loggedAt)
    r.sets += 1
    r.reps += Number.isFinite(set.reps) ? Math.max(0, set.reps) : 0
    r.volumeLb += setVolume(set)
    if (set.recordingFormat !== 'reps') {
      r.repsOnly = false
      if (setVolume(set) > 0 && (!r.topSet || set.weightLb > r.topSet.weightLb || (set.weightLb === r.topSet.weightLb && set.reps > r.topSet.reps))) r.topSet = { weightLb: set.weightLb, reps: set.reps }
    }
  }
  for (const entry of activities) {
    const r = row(entry.exerciseId, entry.loggedAt)
    r.entries += 1
    r.durationSec += Math.max(0, entry.durationSec)
    r.distanceMiles += Math.max(0, entry.distanceMiles ?? 0)
  }
  const list = [...rows.values()].sort((a, b) => firstAt.get(a.exerciseId)! - firstAt.get(b.exerciseId)!)

  // Main takes precedence: a region that is main for any exercise is never also listed as assisting.
  const levels: WorkoutOverview['levels'] = {}
  const mainNames = new Map<MuscleRegion, string[]>()
  const assistNames = new Map<MuscleRegion, string[]>()
  const add = (map: Map<MuscleRegion, string[]>, region: MuscleRegion, name: string) => { const names = map.get(region) ?? []; if (!names.includes(name)) names.push(name); map.set(region, names) }
  for (const exercise of list) {
    const name = exercise.name ?? 'Unknown exercise'
    exercise.primary.forEach(region => { add(mainNames, region, name); levels[region] = 'primary' })
    exercise.secondary.forEach(region => { add(assistNames, region, name); levels[region] ??= 'secondary' })
  }
  const hits = (map: Map<MuscleRegion, string[]>, keep: (region: MuscleRegion) => boolean, withAssists: boolean): RegionHit[] => inOrder(map.keys()).filter(keep).map(region => ({
    region, label: muscleLabels[region], exercises: map.get(region)!,
    alsoAssisting: withAssists ? (assistNames.get(region) ?? []).filter(name => !map.get(region)!.includes(name)) : [],
  }))
  return {
    exercises: list,
    liftingSets: list.reduce((total, exercise) => total + exercise.sets, 0),
    reps: list.reduce((total, exercise) => total + exercise.reps, 0),
    main: hits(mainNames, () => true, true),
    assisting: hits(assistNames, region => !mainNames.has(region), false),
    levels,
    unmapped: list.filter(exercise => exercise.source === 'none'),
  }
}
