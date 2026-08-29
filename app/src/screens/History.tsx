import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useApp } from '../AppContext'
import { countRows, exportBackup, importBackup, parseBackup } from '../data/backup'
import { disableSync, enableSync, syncNow, syncStore } from '../data/sync'
import type { BodyStatEntry, WeekActivity, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

function SyncCard() {
  const status = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!status.configured) return null

  const connect = async () => {
    setBusy(true)
    setErr(null)
    try { await enableSync(pass); setPass('') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (!status.enabled) {
    return (
      <div className="card">
        <span className="lab" style={{ display: 'block' }}>Sync — off</span>
        <span className="small" style={{ display: 'block', margin: '6px 0 8px' }}>
          Back up to your server and share data across devices. Use the same
          passphrase on every device — it is the only thing that identifies your data.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="text-in" type="password" placeholder="Sync passphrase" value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()} />
          <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} disabled={busy || !pass.trim()} onClick={connect}>
            {busy ? '…' : 'Connect'}
          </button>
        </div>
        {err && <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>{err}</span>}
      </div>
    )
  }

  const stateLabel = status.phase === 'syncing' ? 'Syncing…'
    : status.phase === 'error' ? 'Error'
    : status.pending > 0 ? `${status.pending} pending`
    : 'Synced'
  return (
    <div className="card">
      <div className="row">
        <span className="lab">Sync — {stateLabel}</span>
        <span className="lab">
          {status.lastSyncAt ? `Last · ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
      </div>
      {status.phase === 'error' && status.error && (
        <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>{status.error}</span>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={syncNow}>Sync now</button>
        <button className="ghost-btn danger" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => void disableSync()}>Disconnect</button>
      </div>
    </div>
  )
}

function DataCard() {
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const doExport = async () => {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `gym-zero-backup-${toDayKey(new Date())}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    setMsg({ text: `Exported ${countRows(backup)} rows` })
  }

  const doImport = async (file: File) => {
    setBusy(true)
    setMsg(null)
    try {
      const backup = parseBackup(JSON.parse(await file.text()))
      const total = countRows(backup)
      if (!window.confirm(`Import ${total} rows from “${file.name}”? Rows with matching ids are overwritten; nothing is deleted.`)) return
      const { rows } = await importBackup(backup)
      setMsg({ text: `Imported ${rows} rows — reloading…` })
      setTimeout(() => window.location.reload(), 900)
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <span className="lab" style={{ display: 'block' }}>Data</span>
      <span className="small" style={{ display: 'block', margin: '6px 0 8px' }}>
        Download everything as JSON, or merge a backup into this device.
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={busy} onClick={() => void doExport()}>
          Export data
        </button>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={busy} onClick={() => fileRef.current?.click()}>
          Import data
        </button>
        <input
          ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void doImport(file)
          }}
        />
      </div>
      {msg && (
        <span className="small" style={{ display: 'block', marginTop: 6, ...(msg.error ? { color: 'var(--danger)' } : {}) }}>
          {msg.text}
        </span>
      )}
    </div>
  )
}

const dayLetter = (dateKey: string) =>
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${dateKey}T12:00:00`).getDay()]

export function HistoryScreen() {
  const { api, settings, refreshSettings, exercises, go } = useApp()
  const [week, setWeek] = useState<WeekActivity | null>(null)
  const [recent, setRecent] = useState<WorkoutSummary[]>([])
  const [latestStat, setLatestStat] = useState<BodyStatEntry | undefined>(undefined)
  const [weightIn, setWeightIn] = useState('')

  useEffect(() => {
    api.getWeekActivity().then(setWeek)
    api.listRecentWorkouts(10).then(setRecent)
    api.getLatestBodyStat().then(setLatestStat)
  }, [api])

  const saveWeight = async () => {
    const w = parseFloat(weightIn)
    if (!isFinite(w) || w <= 0) return
    const now = new Date()
    // every quick weigh-in is a real body record, not just a settings overwrite
    await api.addBodyStat({ date: toDayKey(now), at: now.getTime(), weightLb: w })
    await refreshSettings()
    setLatestStat(await api.getLatestBodyStat())
    setWeightIn('')
  }

  const didCount = week?.days.filter((d) => d.workoutId).length ?? 0
  const maxVol = Math.max(1, ...(week?.weeklyVolumeLb ?? []))
  const volTrend = (() => {
    const v = week?.weeklyVolumeLb ?? []
    const cur = v[v.length - 1] ?? 0
    const prev = v[v.length - 2] ?? 0
    if (prev <= 0 || cur <= 0) return null
    return Math.round(((cur - prev) / prev) * 100)
  })()

  return (
    <div className="page wide">
      <span className="lab">This week · {didCount} workout{didCount === 1 ? '' : 's'}</span>
      <h1 className="p-h1" style={{ margin: '8px 0 14px' }}>Stats<span className="dot">.</span></h1>

      <div className="hi-grid">
        <div>
          {week && (
            <div className="cal-strip">
              {week.days.map((d) => (
                <div key={d.date} className={`cal-day${d.workoutId ? ' did' : ''}`}>
                  <b>{dayLetter(d.date)}</b>
                  <span className="blk" />
                  <span style={{ fontSize: '0.5rem' }}>{d.routineName ?? (d.workoutId ? '✓' : '—')}</span>
                </div>
              ))}
            </div>
          )}

          {week && (
            <div className="card">
              <div className="row">
                <span className="lab">Weekly volume · 6 wk</span>
                {volTrend !== null && (
                  <span className={`chip ${volTrend >= 0 ? 'green' : ''}`} style={{ margin: 0 }}>
                    {volTrend >= 0 ? '▲' : '▼'} {Math.abs(volTrend)}%
                  </span>
                )}
              </div>
              <div className="spark">
                {week.weeklyVolumeLb.map((v, i) => (
                  <i
                    key={i}
                    className={i === week.weeklyVolumeLb.length - 1 ? 'hi' : ''}
                    style={{ height: `${Math.max(5, (v / maxVol) * 100)}%` }}
                  />
                ))}
              </div>
              <span className="lab" style={{ display: 'block', marginTop: 6 }}>Lb lifted per week</span>
            </div>
          )}

          <div className="card">
            <div className="row">
              <div>
                <span className="lab">Body</span>
                <span className="num" style={{ fontSize: '1.1rem', display: 'block', marginTop: 2 }}>
                  {settings.bodyWeightLb ? `${settings.bodyWeightLb} lb` : '—'}
                  {latestStat?.bodyFatPct !== undefined && <span className="small" style={{ fontFamily: 'var(--body)' }}> · {latestStat.bodyFatPct}% fat</span>}
                  {settings.bodyWeightGoalLb ? <span className="small" style={{ fontFamily: 'var(--body)' }}> · goal {settings.bodyWeightGoalLb} lb</span> : null}
                </span>
              </div>
              <button className="ghost-btn" style={{ width: 'auto', padding: '8px 14px' }} onClick={() => go({ name: 'body' })}>
                Open ›
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input className="text-in" inputMode="decimal" placeholder="182.4" value={weightIn}
                onChange={(e) => setWeightIn(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveWeight()} />
              <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} onClick={saveWeight}>
                Log
              </button>
            </div>
          </div>

          <SyncCard />
          <DataCard />
        </div>

        <div>
          <p className="section-label">Sessions</p>
          {recent.map((s) => (
            <div key={s.workout.id} className="card">
              <div className="row">
                <span className="num" style={{ fontSize: '1.05rem' }}>
                  {s.workout.date.slice(5).replace('-', '/')}
                </span>
                <span className="lab">{Math.max(1, Math.round(s.durationSec / 60))} min</span>
              </div>
              <span className="small">
                {s.setCount} set{s.setCount === 1 ? '' : 's'} · {Math.round(s.totalVolumeLb).toLocaleString()} lb
                {s.prs.map((pr) => (
                  <span key={pr.exerciseId} className="pr-flag">
                    {exercises.get(pr.exerciseId)?.name ?? ''} PR {pr.weightLb}×{pr.reps}
                  </span>
                ))}
              </span>
              {s.workout.notes && <span className="small" style={{ display: 'block', marginTop: 4 }}>“{s.workout.notes}”</span>}
            </div>
          ))}
          {recent.length === 0 && (
            <div className="card">
              <span className="num" style={{ fontSize: '2.4rem', WebkitTextStroke: '1px var(--ghost)', color: 'transparent', display: 'block' }}>00</span>
              <span className="lab" style={{ display: 'block', marginTop: 4 }}>No sessions yet</span>
              <span className="small">Your history builds here. First one today?</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
