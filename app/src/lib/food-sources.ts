import type { DataAPI, FoodProduct } from '../types'

/**
 * Pluggable food-database lookup for barcode scans, resolved in order:
 *   1. local cache (Dexie `products`) — instant, works offline
 *   2. self-hosted off-db mirror, when configured in Settings — no rate
 *      limit, it's the user's own hardware; any failure falls through
 *   3. public Open Food Facts API — the zero-setup default
 *
 * OFF allows 15 product lookups/min/IP. The public-API path hard-caps
 * itself at 10 so a misfiring scan loop can never get the user's IP banned;
 * excess lookups wait for a slot instead of firing. The self-hosted path is
 * deliberately unthrottled. The search API is never used.
 *
 * Data license: Open Food Facts, ODbL v1.0 — credited in Settings.
 */

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product'
const OFF_FIELDS = 'product_name,brands,nutriments,serving_quantity,serving_size'
// identifies the app to OFF; browsers can't set User-Agent, so query params it
// is. Overridable per deployment (VITE_OFF_APP_NAME) — purely a courtesy
// identifier so OFF can see who's calling; their rate limits are per IP.
const OFF_APP = `app_name=${encodeURIComponent(import.meta.env.VITE_OFF_APP_NAME || 'gym-zero')}&app_version=1.0`

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

const cleanEndpoint = (endpoint: string) => endpoint.trim().replace(/\/+$/, '')

interface OffResponse { status?: number | string; product?: Record<string, unknown> }

/** Both sources speak the same OFF v2 shape, so one mapper serves them. */
function mapProduct(code: string, data: OffResponse): FoodProduct | null {
  if (data.status !== 1 || !data.product) return null
  const raw = data.product
  const nutriments = (raw.nutriments ?? {}) as Record<string, unknown>
  const calories = num(nutriments['energy-kcal_100g'])
  if (calories === undefined) return null // listed but no nutrition — useless for logging
  return {
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
}

async function fetchJson(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ---------- self-hosted mirror (off-db sidecar) ----------

/** Database formats this app version knows how to read; /meta declares the sidecar's. */
export const SUPPORTED_SOURCE_SCHEMAS = ['off-v2']

export interface FoodDbMeta {
  status?: string
  source?: string
  sourceSchema?: string
  exportDate?: string | null
  productCount?: number
  importedAt?: number
  progress?: string
  error?: string | null
}

/** Reachability + version check for a self-hosted database; used by Settings "Test & save". */
export async function probeFoodDb(endpoint: string): Promise<FoodDbMeta> {
  const res = await fetchJson(`${cleanEndpoint(endpoint)}/meta`, 4000)
  if (!res.ok) throw new Error(`Food database answered with ${res.status}.`)
  return await res.json() as FoodDbMeta
}

async function lookupSelfHosted(endpoint: string, code: string): Promise<FoodProduct | null> {
  const res = await fetchJson(`${cleanEndpoint(endpoint)}/product/${encodeURIComponent(code)}.json`, 4000)
  if (!res.ok) throw new Error(`mirror ${res.status}`)
  return mapProduct(code, await res.json() as OffResponse)
}

// ---------- lookup entry point ----------

/**
 * Look a barcode up: cache → self-hosted mirror (if configured) → public OFF.
 * A mirror that's down, still importing, or missing the product silently
 * falls through to the public API. Null = nobody knows this product.
 */
export async function lookupBarcode(api: DataAPI, barcode: string, selfHostEndpoint?: string): Promise<FoodProduct | null> {
  const code = barcode.trim()
  const cached = await api.getCachedProduct(code)
  if (cached) return cached

  if (selfHostEndpoint?.trim()) {
    try {
      const product = await lookupSelfHosted(selfHostEndpoint, code)
      if (product) {
        await api.cacheProduct(product)
        return product
      }
    } catch { /* fall through to the public API */ }
  }

  await throttle()
  let res: Response
  try {
    res = await fetchJson(`${OFF_BASE}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}&${OFF_APP}`, 8000)
  } catch {
    throw new Error("Couldn't reach the food database — check your connection.")
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Food database error (${res.status}) — try again in a moment.`)

  const product = mapProduct(code, await res.json() as OffResponse)
  if (product) await api.cacheProduct(product)
  return product
}
