import { runAi, type AiConfig, type AiRequestOptions } from './ai'
import { buildWorkoutOverview } from './workout-overview'
import type { ActivityLog, DataAPI, Exercise, Settings, WorkoutSet, WorkoutSummary } from '../types'

export interface WorkoutReview {
  assessment: string
  progress: string
  strengths: string[]
  improvements: string[]
  routine: { recommendation: string; reason: string; days: Array<{ name: string; exercises: string[] }> }
  limitations: string[]
  historyCount: number
}
export interface WorkoutReviewInput {
  api: DataAPI
  summary: WorkoutSummary
  sets: WorkoutSet[]
  activities: ActivityLog[]
  exercises: Map<string, Exercise>
  settings: Settings
  question?: string
}

const clipped = (value: string | undefined, max = 1000) => value?.slice(0, max)

/** Allowlisted training data only: never serialize Settings, credentials, account data or unrelated health/nutrition records. */
export function workoutReviewSnapshot(summary: WorkoutSummary, sets: WorkoutSet[], activities: ActivityLog[], catalog: Map<string, Exercise>) {
  const overview = buildWorkoutOverview(sets, activities, catalog)
  return {
    date: summary.workout.date,
    durationSec: summary.durationSec,
    totalSets: summary.setCount,
    volumeLb: summary.totalVolumeLb,
    timedDurationSec: summary.timedDurationSec,
    cardioDurationSec: summary.cardioDurationSec,
    distanceMiles: summary.distanceMiles,
    notes: clipped(summary.workout.notes),
    exercises: overview.exercises.slice(0, 40).map(ex => ({
      exerciseId: ex.exerciseId, name: clipped(ex.name, 160), sets: ex.sets, reps: ex.reps,
      volumeLb: ex.volumeLb, durationSec: ex.durationSec, distanceMiles: ex.distanceMiles,
      primaryMuscles: ex.primary, assistingMuscles: ex.secondary, muscleSource: ex.source,
    })),
    sets: sets.slice(0, 120).map(set => ({ exerciseId: set.exerciseId, machineId: set.machineId,
      weightLb: set.weightLb, reps: set.reps, recordingFormat: set.recordingFormat ?? 'weight-reps' })),
    activities: activities.slice(0, 60).map(entry => ({ exerciseId: entry.exerciseId, machineId: entry.machineId,
      recordingFormat: entry.recordingFormat, categories: entry.categories, durationSec: entry.durationSec,
      distanceMiles: entry.distanceMiles, resistance: entry.resistance })),
    detailsTruncated: sets.length > 120 || activities.length > 60 || overview.exercises.length > 40,
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI returned an incomplete workout review. Please try again.')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 1500): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('AI returned an incomplete workout review. Please try again.')
  return value.trim().slice(0, max)
}
function list(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) throw new Error('AI returned an incomplete workout review. Please try again.')
  return value.slice(0, max).map(item => text(item, 600))
}
export function parseWorkoutReview(value: unknown, historyCount: number): WorkoutReview {
  const raw = object(value)
  const routine = object(raw.routine)
  if (!Array.isArray(routine.days)) throw new Error('AI returned an incomplete workout review. Please try again.')
  return {
    assessment: text(raw.assessment), progress: text(raw.progress),
    strengths: list(raw.strengths), improvements: list(raw.improvements),
    routine: { recommendation: text(routine.recommendation), reason: text(routine.reason),
      days: routine.days.slice(0, 7).map(value => { const day = object(value); return { name: text(day.name, 100), exercises: list(day.exercises, 10) } }) },
    limitations: list(raw.limitations), historyCount,
  }
}

export async function evaluateWorkout(config: AiConfig, input: WorkoutReviewInput, options: AiRequestOptions = {}): Promise<WorkoutReview> {
  const { api, summary, sets, activities, exercises, settings } = input
  if (!summary.workout.finishedAt) throw new Error('Finish this workout before asking for a review.')
  if (!sets.length && !activities.length) throw new Error('Log at least one set or activity before asking for a review.')
  options.signal?.throwIfAborted()
  const [recent, routines] = await Promise.all([
    api.listRecentWorkouts(12, summary.workout.startedAt),
    summary.workout.routineId ? api.listRoutines() : Promise.resolve([]),
  ])
  options.signal?.throwIfAborted()
  const earliest = summary.workout.startedAt - 56 * 24 * 60 * 60 * 1000
  const previous = recent.filter(row => row.workout.id !== summary.workout.id && row.workout.startedAt >= earliest
    && row.workout.startedAt < summary.workout.startedAt && !!row.workout.finishedAt && row.workout.finishedAt <= summary.workout.startedAt).slice(0, 12)
  const history = await Promise.all(previous.map(async row => {
    options.signal?.throwIfAborted()
    const [rows, entries] = await Promise.all([api.listSets(row.workout.id), api.listActivities(row.workout.id)])
    return workoutReviewSnapshot(row, rows, entries, exercises)
  }))
  options.signal?.throwIfAborted()
  const routine = routines.find(r => r.id === summary.workout.routineId)
  const payload = {
    profile: { goal: settings.goal, experience: settings.experience, daysPerWeek: settings.daysPerWeek,
      sessionMinutes: settings.sessionMinutes, limitations: clipped(settings.limitations) },
    question: clipped(input.question?.trim()),
    session: workoutReviewSnapshot(summary, sets, activities, exercises),
    currentSavedRoutine: routine ? { name: clipped(routine.name, 160), items: routine.items.slice(0, 40).map(item => ({
      exerciseId: item.exerciseId, name: clipped(exercises.get(item.exerciseId)?.name, 160),
      targetSets: item.targetSets, targetReps: item.targetReps,
      targetDurationSec: item.targetDurationSec, targetDistanceMiles: item.targetDistanceMiles,
    })), detailsTruncated: routine.items.length > 40 } : null,
    historyScope: { earlierCompletedWorkouts: history.length, maximumWorkouts: 12, precedingDays: 56,
      sampleOnly: true, comparisonEndsAt: summary.workout.date },
    earlierWorkouts: history,
  }
  return parseWorkoutReview(await runAi(config, { feature: 'workoutReview', payloadJson: JSON.stringify(payload) }, options), history.length)
}
