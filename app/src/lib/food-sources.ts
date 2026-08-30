import type { DataAPI, FoodProduct } from '../types'

/**
 * Pluggable food-database lookup for barcode scans. Today there is one
 * source — the public Open Food Facts API — called straight from the client,
 * same no-server philosophy as the AI proxy. A self-hosted OFF mirror can
 * slot in behind lookupBarcode later without touching any UI code.
 *
 * OFF allows 15 product lookups/min/IP. This client hard-caps itself at 10
 * so a misfiring scan loop can never get the user's IP banned; excess
 * lookups wait for a slot instead of firing. Cache hits (the local Dexie
 * `products` table) don't count against the limit and keep rescans of the
 * usual foods working offline. The search API is never used.
 *
 * Data license: Open Food Facts, ODbL v1.0 — credited in Settings.
 */

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product'
const OFF_FIELDS = 'product_name,brands,nutriments,serving_quantity,serving_size'
// identifies the app to OFF; browsers can't set User-Agent, so query params it is
const OFF_APP = 'app_name=gym-zero&app_version=1.0'

/** EAN-8 / UPC-A / EAN-13 — the barcode shapes food packaging uses. */
export const isFoodBarcode = (raw: string): boolean => /^\d{8}$|^\d{12,13}$/.test(raw.trim())

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
const stamps: number[] = []

/** Waits for a request slot; returns immediately while under the cap. */
async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift()
    if (stamps.length < MAX_PER_WINDOW) {
      stamps.push(now)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, stamps[0] + WINDOW_MS - now + 50))
  }
}

const num = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return isFinite(n) && n >= 0 ? n : undefined
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

/**
 * Look a barcode up: local cache first, then Open Food Facts.
 * Null = the product isn't in the database (or has no usable nutrition).
 */
export async function lookupBarcode(api: DataAPI, barcode: string): Promise<FoodProduct | null> {
  const code = barcode.trim()
  const cached = await api.getCachedProduct(code)
  if (cached) return cached

  await throttle()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  let res: Response
  try {
    res = await fetch(`${OFF_BASE}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}&${OFF_APP}`, {
      signal: controller.signal,
    })
  } catch {
    throw new Error("Couldn't reach the food database — check your connection.")
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Food database error (${res.status}) — try again in a moment.`)

  const data = await res.json() as { status?: number; product?: Record<string, unknown> }
  if (data.status !== 1 || !data.product) return null

  const raw = data.product
  const nutriments = (raw.nutriments ?? {}) as Record<string, unknown>
  const calories = num(nutriments['energy-kcal_100g'])
  if (calories === undefined) return null // listed but no nutrition — useless for logging

  const product: FoodProduct = {
    barcode: code,
    name: text(raw.product_name, 60) ?? `Product ${code}`,
    brand: text(raw.brands, 40)?.split(',')[0].trim(),
    per100g: {
      calories: Math.round(calories),
      protein: num(nutriments.proteins_100g) ?? 0,
      carbs: num(nutriments.carbohydrates_100g) ?? 0,
      fat: num(nutriments.fat_100g) ?? 0,
    },
    servingG: num(raw.serving_quantity),
    servingLabel: text(raw.serving_size, 40),
    fetchedAt: Date.now(),
  }
  await api.cacheProduct(product)
  return product
}
