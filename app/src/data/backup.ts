import { db } from './db'
import { ensureSeeded } from './seed'

/**
 * Portable JSON backup of every user-owned table. Import merges by row id
 * (upsert; nothing is deleted), and the writes flow through the normal sync
 * hooks, so importing on a sync-enabled device pushes the rows to the server.
 */

const BACKUP_TABLES = [
  'exercises', 'equipmentModels', 'machines', 'routines',
  'workouts', 'sets', 'food', 'savedMeals', 'bodyStats', 'tape', 'machineAi', 'aiPrograms', 'settings',
] as const

export interface Backup {
  app: 'gym-zero'
  format: 1
  exportedAt: string
  tables: Partial<Record<(typeof BACKUP_TABLES)[number], Array<Record<string, unknown>>>>
}

export async function exportBackup(): Promise<Backup> {
  await ensureSeeded()
  const tables: Backup['tables'] = {}
  for (const name of BACKUP_TABLES) {
    tables[name] = await db.table(name).toArray() as Array<Record<string, unknown>>
  }
  return { app: 'gym-zero', format: 1, exportedAt: new Date().toISOString(), tables }
}

export const countRows = (backup: Backup): number =>
  Object.values(backup.tables).reduce((total, rows) => total + (rows?.length ?? 0), 0)

/** Throws with a human-readable message when the file isn't a usable backup. */
export function parseBackup(raw: unknown): Backup {
  const backup = raw as Backup
  if (!backup || typeof backup !== 'object' || backup.app !== 'gym-zero') throw new Error('Not a Gym Zero backup file.')
  if (backup.format !== 1) throw new Error(`Backup format ${String(backup.format)} is newer than this app understands.`)
  if (!backup.tables || typeof backup.tables !== 'object') throw new Error('Backup has no tables.')
  for (const name of BACKUP_TABLES) {
    const rows = backup.tables[name]
    if (rows === undefined) continue
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || typeof row.id !== 'string')) {
      throw new Error(`Backup table "${name}" is malformed.`)
    }
  }
  return backup
}

export async function importBackup(backup: Backup): Promise<{ rows: number }> {
  await ensureSeeded()
  const names = BACKUP_TABLES.filter((name) => backup.tables[name]?.length)
  let rows = 0
  await db.transaction('rw', names.map((name) => db.table(name)), async () => {
    for (const name of names) {
      const tableRows = backup.tables[name]!
      await db.table(name).bulkPut(tableRows)
      rows += tableRows.length
    }
  })
  return { rows }
}
