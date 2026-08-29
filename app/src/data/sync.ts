import Dexie, { type Transaction } from 'dexie'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { db, syncFlags, type OutboxEntry } from './db'

/**
 * Replication layer between the local Dexie store and a self-hosted Convex
 * deployment. Dexie stays the source of truth the UI reads; every local write
 * is captured via table hooks into an outbox and pushed to Convex, and other
 * devices' writes are pulled back down. Conflict resolution is last-write-wins
 * on the writing device's wall clock, per row.
 *
 * Without VITE_CONVEX_URL at build time the whole module is inert and the app
 * behaves exactly as the original local-only build.
 */

const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL || undefined
const PROFILE_LS = 'gym.sync.profileKey'
const CURSOR_LS = 'gym.sync.cursor'

const SYNC_TABLES = [
  'exercises', 'equipmentModels', 'machines', 'routines',
  'workouts', 'sets', 'food', 'savedMeals', 'bodyStats', 'tape', 'settings',
] as const

// ---------- status store (consumed by the UI via useSyncExternalStore) ----------

export interface SyncStatus {
  configured: boolean
  enabled: boolean
  phase: 'idle' | 'syncing' | 'error'
  error?: string
  lastSyncAt?: number
  pending: number
}

let status: SyncStatus = {
  configured: !!CONVEX_URL,
  enabled: !!CONVEX_URL && !!localStorage.getItem(PROFILE_LS),
  phase: 'idle',
  pending: 0,
}
const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}
export const syncStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  getSnapshot(): SyncStatus { return status },
}

// ---------- helpers ----------

/** Deterministic stringify (sorted keys) so local rows and Convex round-trips compare equal. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const fingerprint = (doc: unknown, deleted: boolean) => `${deleted ? 'D' : 'P'}${stableStringify(doc ?? null)}`

/** Strip undefined properties so the doc is a valid Convex value. */
const sanitize = <T>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T

async function deriveProfileKey(passphrase: string): Promise<string> {
  if (!crypto.subtle) {
    throw new Error('Sync needs a secure context (HTTPS or localhost).')
  }
  const bytes = new TextEncoder().encode(`gym-tracker::${passphrase}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- change capture (Dexie hooks -> outbox) ----------

/** Rows touched by transactions that haven't been re-read into the outbox yet. */
const dirty = new Map<string, { table: string; id: string; seed: boolean }>()
const seenTx = new WeakSet<Transaction>()
/** Fingerprints of rows just applied from the server, to swallow the local echo. */
const lastApplied = new Map<string, string>()

function markDirty(table: string, id: unknown) {
  if (!CONVEX_URL || !localStorage.getItem(PROFILE_LS)) return
  const key = `${table}:${String(id)}`
  dirty.set(key, { table, id: String(id), seed: syncFlags.seeding })
  const tx = Dexie.currentTransaction
  if (tx && !seenTx.has(tx)) {
    seenTx.add(tx)
    tx.on('complete', () => { void flushDirty() })
  }
}

/** After a write transaction commits, snapshot the affected rows into the outbox. */
async function flushDirty() {
  if (dirty.size === 0) return
  const batch = [...dirty.values()]
  dirty.clear()
  const entries: OutboxEntry[] = []
  for (const { table, id, seed } of batch) {
    const key = `${table}:${id}`
    const row = await db.table(table).get(id) as unknown
    const deleted = row === undefined
    const doc = deleted ? undefined : sanitize(row)
    // One-shot echo suppression: consume the fingerprint either way, so a later
    // genuine edit that happens to match an old server state still replicates.
    const applied = lastApplied.get(key)
    lastApplied.delete(key)
    if (applied === fingerprint(doc, deleted)) continue
    // Seed rows use a floor timestamp so they can never beat a real edit on the server.
    entries.push({ key, table, id, doc, deleted, updatedAt: seed ? 1 : Date.now() })
  }
  if (entries.length) {
    await db.outbox.bulkPut(entries)
    setStatus({ pending: await db.outbox.count() })
    schedule(1200)
  }
}

export function initSync() {
  if (!CONVEX_URL) return
  for (const name of SYNC_TABLES) {
    const table = db.table(name)
    table.hook('creating', function (primKey, obj) { markDirty(name, primKey ?? (obj as { id: string }).id) })
    table.hook('updating', function (_mods, primKey) { markDirty(name, primKey) })
    table.hook('deleting', function (primKey) { markDirty(name, primKey) })
  }
  window.addEventListener('online', () => schedule(0))
  setInterval(() => { if (status.enabled && navigator.onLine) schedule(0) }, 60_000)
  if (status.enabled) {
    void db.outbox.count().then((pending) => setStatus({ pending }))
    schedule(0)
  }
}

// ---------- push / pull loop ----------

const client = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null
let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let rerun = false

function schedule(delayMs: number) {
  if (!client || !status.enabled) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void runSync() }, delayMs)
}

interface PulledRecord { table: string; id: string; doc?: unknown; deleted: boolean; updatedAt: number; syncedAt: number }

async function runSync() {
  if (!client) return
  const profileKey = localStorage.getItem(PROFILE_LS)
  if (!profileKey || !navigator.onLine) return
  if (running) { rerun = true; return }
  running = true
  setStatus({ phase: 'syncing', error: undefined })
  try {
    // push
    const entries = await db.outbox.toArray()
    for (let i = 0; i < entries.length; i += 200) {
      const batch = entries.slice(i, i + 200)
      const changes = batch.map((e) => {
        const c: { table: string; id: string; deleted: boolean; updatedAt: number; doc?: unknown } =
          { table: e.table, id: e.id, deleted: e.deleted, updatedAt: e.updatedAt }
        if (!e.deleted) c.doc = e.doc
        return c
      })
      await client.mutation(api.sync.push, { profileKey, changes })
      // clear pushed entries unless they were re-dirtied mid-flight
      await db.transaction('rw', db.outbox, async () => {
        for (const e of batch) {
          const cur = await db.outbox.get(e.key)
          if (cur && cur.updatedAt === e.updatedAt) await db.outbox.delete(e.key)
        }
      })
    }

    // pull
    const since = Number(localStorage.getItem(CURSOR_LS) ?? '0')
    const records = await client.query(api.sync.pull, { profileKey, since }) as PulledRecord[]
    if (records.length) {
      await applyRemote(records)
      const cursor = Math.max(since, ...records.map((r) => r.syncedAt))
      localStorage.setItem(CURSOR_LS, String(cursor))
    }
    setStatus({ phase: 'idle', lastSyncAt: Date.now(), pending: await db.outbox.count() })
  } catch (err) {
    setStatus({ phase: 'error', error: err instanceof Error ? err.message : String(err), pending: await db.outbox.count() })
  } finally {
    running = false
    if (rerun) { rerun = false; schedule(250) }
  }
}

/** Fired after remote records are written into Dexie, so live UI state can re-read. */
export const SYNC_APPLIED_EVENT = 'gym:sync-applied'

async function applyRemote(records: PulledRecord[]) {
  const tables = SYNC_TABLES.map((n) => db.table(n))
  let applied = 0
  await db.transaction('rw', [...tables, db.outbox], async () => {
    for (const rec of records) {
      if (!(SYNC_TABLES as readonly string[]).includes(rec.table)) continue
      const key = `${rec.table}:${rec.id}`
      const pending = await db.outbox.get(key)
      if (pending && pending.updatedAt > rec.updatedAt) continue // local change is newer; it will push
      if (pending) await db.outbox.delete(key) // remote won; drop the stale local change
      lastApplied.set(key, fingerprint(rec.deleted ? undefined : rec.doc, rec.deleted))
      if (rec.deleted) await db.table(rec.table).delete(rec.id)
      else await db.table(rec.table).put(rec.doc)
      applied++
    }
  })
  if (applied > 0) window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT))
}

// ---------- public controls ----------

/** Turn on sync: server state wins for rows that exist on both sides, then local-only rows push up. */
export async function enableSync(passphrase: string) {
  if (!client) throw new Error('No sync server configured (VITE_CONVEX_URL).')
  if (!passphrase.trim()) throw new Error('Enter a sync passphrase.')
  const profileKey = await deriveProfileKey(passphrase.trim())
  localStorage.setItem(PROFILE_LS, profileKey)
  localStorage.setItem(CURSOR_LS, '0')
  setStatus({ enabled: true, phase: 'syncing', error: undefined })
  try {
    // 1. adopt everything the server already has
    const records = await client.query(api.sync.pull, { profileKey, since: 0 }) as PulledRecord[]
    const serverFp = new Map<string, string>()
    for (const r of records) serverFp.set(`${r.table}:${r.id}`, fingerprint(r.deleted ? undefined : r.doc, r.deleted))
    if (records.length) {
      await applyRemote(records)
      localStorage.setItem(CURSOR_LS, String(Math.max(...records.map((r) => r.syncedAt))))
    }
    // 2. enqueue local rows the server doesn't have yet (or that differ locally)
    const now = Date.now()
    const entries: OutboxEntry[] = []
    for (const name of SYNC_TABLES) {
      for (const row of await db.table(name).toArray() as Array<{ id: string }>) {
        const key = `${name}:${row.id}`
        const doc = sanitize(row)
        if (serverFp.get(key) === fingerprint(doc, false)) continue
        entries.push({ key, table: name, id: row.id, doc, deleted: false, updatedAt: now })
      }
    }
    if (entries.length) await db.outbox.bulkPut(entries)
    setStatus({ pending: await db.outbox.count() })
    await runSync()
  } catch (err) {
    setStatus({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Turn off sync on this device. Local data stays; nothing is deleted anywhere. */
export async function disableSync() {
  localStorage.removeItem(PROFILE_LS)
  localStorage.removeItem(CURSOR_LS)
  await db.outbox.clear()
  setStatus({ enabled: false, phase: 'idle', error: undefined, pending: 0 })
}

export function syncNow() { schedule(0) }
