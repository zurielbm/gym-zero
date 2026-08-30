import type { DataAPI, DayKey, Settings } from '../types'

/**
 * Daily water target, computed instead of asked for. Baseline is the common
 * ~½ fl oz per lb of body weight, and a logged workout bumps it the same day.
 * Everything here is deliberately an estimate — the UI says "about" on purpose.
 */

/** Fallback when the user hasn't recorded a body weight yet. */
export const DEFAULT_WATER_TARGET_OZ = 64

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function autoWaterTargetOz(weightLb?: number): number {
  if (!weightLb || weightLb <= 0) return DEFAULT_WATER_TARGET_OZ
  return clamp(Math.round(weightLb / 2), 48, 128)
}

/** Extra oz for training: ~20/hr, in tidy 4 oz steps, capped so it stays sane. */
export function workoutBumpOz(workoutMinutes: number): number {
  if (workoutMinutes <= 0) return 0
  return clamp(Math.round((workoutMinutes / 60) * 20 / 4) * 4, 4, 40)
}

export function waterTargetOz(
  settings: Pick<Settings, 'waterTargetOz' | 'bodyWeightLb'>,
  workoutMinutes: number,
): number {
  return (settings.waterTargetOz ?? autoWaterTargetOz(settings.bodyWeightLb)) + workoutBumpOz(workoutMinutes)
}

/** Minutes of finished workouts logged today; feeds the training bump. */
export async function todayWorkoutMinutes(api: Pick<DataAPI, 'listRecentWorkouts'>, today: DayKey): Promise<number> {
  const recent = await api.listRecentWorkouts(4)
  return Math.round(recent
    .filter((w) => w.workout.date === today)
    .reduce((total, w) => total + w.durationSec, 0) / 60)
}

/** Count in halves, spoken style: 0.5 → "½", 2 → "2", 2.5 → "2½". */
export function fmtHalf(n: number): string {
  const halves = Math.max(1, Math.round(n * 2))
  const whole = Math.floor(halves / 2)
  const half = halves % 2 === 1
  if (whole === 0) return '½'
  return half ? `${whole}½` : String(whole)
}
