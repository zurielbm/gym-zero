import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import type { BodyMetricKey, BodyStatEntry, TapeEntry, TapeSite } from '../types'
import { toDayKey } from '../types'

/** direction: which way a change counts as progress; weight resolves against the goal. */
const METRICS: Array<{ key: BodyMetricKey; label: string; unit?: string; direction?: 'up' | 'down' }> = [
  { key: 'weightLb', label: 'Weight', unit: 'lb' },
  { key: 'bmi', label: 'BMI' },
  { key: 'bodyFatPct', label: 'Body fat', unit: '%', direction: 'down' },
  { key: 'fatFreeWeightLb', label: 'Fat-free wt', unit: 'lb' },
  { key: 'subcutaneousFatPct', label: 'Subcut. fat', unit: '%', direction: 'down' },
  { key: 'visceralFat', label: 'Visceral fat', direction: 'down' },
  { key: 'bodyWaterPct', label: 'Body water', unit: '%' },
  { key: 'skeletalMusclePct', label: 'Skel. muscle', unit: '%', direction: 'up' },
  { key: 'muscleMassLb', label: 'Muscle mass', unit: 'lb', direction: 'up' },
  { key: 'boneMassLb', label: 'Bone mass', unit: 'lb' },
  { key: 'proteinPct', label: 'Protein', unit: '%', direction: 'up' },
  { key: 'bmrKcal', label: 'BMR', unit: 'kcal' },
]

const TAPE_ROWS: Array<{ label: string; sites: TapeSite[] }> = [
  { label: 'Neck', sites: ['neck'] },
  { label: 'Shoulder', sites: ['shoulder'] },
  { label: 'Chest', sites: ['chest'] },
  { label: 'Waist', sites: ['waist'] },
  { label: 'Abdomen', sites: ['abdomen'] },
  { label: 'Hip', sites: ['hip'] },
  { label: 'Biceps', sites: ['bicepL', 'bicepR'] },
  { label: 'Forearm', sites: ['forearmL', 'forearmR'] },
  { label: 'Thigh', sites: ['thighL', 'thighR'] },
  { label: 'Calf', sites: ['calfL', 'calfR'] },
]

const fmtWhen = (at: number) =>
  new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const parseNum = (raw: string): number | undefined => {
  const n = parseFloat(raw)
  return isFinite(n) && n > 0 ? n : undefined
}

/** Height in `5'5"`, `5 5`, or `5ft 5in` form → total inches; plain numbers pass through as inches. */
const parseHeight = (raw: string): number | undefined => {
  const m = raw.trim().match(/^(\d+)\s*(?:['’′]|ft|feet|\s)\s*(\d+(?:\.\d+)?)\s*(?:["”″]|in\w*)?$/i)
  if (m) return parseInt(m[1], 10) * 12 + parseFloat(m[2])
  return parseNum(raw)
}

const fmtHeight = (inches: number) => `${Math.floor(inches / 12)}'${Math.round((inches % 12) * 10) / 10}"`

function Delta({ cur, prev, direction }: { cur: number; prev?: number; direction?: 'up' | 'down' }) {
  if (prev === undefined || cur === prev) return <span className="bstat-delta">—</span>
  const diff = Math.round((cur - prev) * 10) / 10
  const good = direction ? (direction === 'down' ? diff < 0 : diff > 0) : undefined
  return (
    <span className={`bstat-delta${good ? ' good' : ''}`}>
      {diff > 0 ? '▴' : '▾'} {Math.abs(diff)}
    </span>
  )
}

const TREND_RANGES = [
  { days: 30, chip: '30d', words: '30 days' },
  { days: 90, chip: '90d', words: '90 days' },
  { days: 365, chip: '1y', words: 'year' },
]

/** Any-metric trend over a real time window, driven by getBodyTrend. */
function TrendCard({ stats, weightDirection }: { stats: BodyStatEntry[]; weightDirection?: 'up' | 'down' }) {
  const { api } = useApp()
  const [metric, setMetric] = useState<BodyMetricKey>('weightLb')
  const [days, setDays] = useState(90)
  const [points, setPoints] = useState<Array<{ at: number; value: number }> | null>(null)

  // only offer metrics the user actually records
  const available = useMemo(() => METRICS.filter((m) => stats.some((s) => s[m.key] !== undefined)), [stats])

  useEffect(() => {
    if (available.length && !available.some((m) => m.key === metric)) setMetric(available[0].key)
  }, [available, metric])

  useEffect(() => {
    let alive = true
    api.getBodyTrend(metric, days).then((p) => { if (alive) setPoints(p) })
    return () => { alive = false }
  }, [api, metric, days])

  if (available.length === 0) return null

  const def = METRICS.find((m) => m.key === metric)
  const unit = def?.unit ? ` ${def.unit}` : ''
  const direction = metric === 'weightLb' ? weightDirection : def?.direction
  const range = TREND_RANGES.find((r) => r.days === days) ?? TREND_RANGES[1]
  const shown = (points ?? []).slice(-32)
  const values = shown.map((p) => p.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, max)

  const summary = (() => {
    if (!points || shown.length < 2) return 'Not enough readings in this window yet — log a couple more.'
    const first = shown[0].value
    const last = shown[shown.length - 1].value
    const diff = Math.round((last - first) * 10) / 10
    if (diff === 0) return `Holding steady at ${last}${unit} over the last ${range.words}.`
    const moved = `${diff < 0 ? 'Down' : 'Up'} ${Math.abs(diff)}${unit} over the last ${range.words}`
    if (!direction) return `${moved}.`
    const good = direction === 'down' ? diff < 0 : diff > 0
    return good ? `${moved} — the right direction.` : `${moved}.`
  })()

  return (
    <div className="card">
      <span className="lab">Trend</span>
      <div style={{ marginTop: 8 }}>
        {available.map((m) => (
          <span
            key={m.key}
            className={`chip btn${m.key === metric ? ' solid' : ''}`}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </span>
        ))}
      </div>
      {shown.length >= 2 && (
        <div className="spark">
          {shown.map((p, i) => (
            <i
              key={p.at}
              className={i === shown.length - 1 ? 'hi' : ''}
              style={{ height: `${Math.max(8, max === min ? 100 : ((p.value - min) / (max - min)) * 90 + 10)}%` }}
            />
          ))}
        </div>
      )}
      <span className="small" style={{ display: 'block', margin: '6px 0 8px' }}>{summary}</span>
      <div>
        {TREND_RANGES.map((r) => (
          <span
            key={r.days}
            className={`chip btn${r.days === days ? ' solid' : ''}`}
            onClick={() => setDays(r.days)}
          >
            {r.chip}
          </span>
        ))}
      </div>
    </div>
  )
}

function CompositionView() {
  const { api, settings, refreshSettings } = useApp()
  const [stats, setStats] = useState<BodyStatEntry[] | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [form, setForm] = useState<Partial<Record<BodyMetricKey, string>>>({})
  const [goalWeight, setGoalWeight] = useState(settings.bodyWeightGoalLb?.toString() ?? '')
  const [goalFat, setGoalFat] = useState(settings.bodyFatGoalPct?.toString() ?? '')
  const [height, setHeight] = useState(settings.heightIn ? fmtHeight(settings.heightIn) : '')

  const reload = useCallback(() => api.listBodyStats().then(setStats), [api])
  useEffect(() => { void reload() }, [reload])

  const latest = stats?.[0]
  const prev = stats?.[1]

  // weight progress reads against the goal when one is set
  const weightDirection = settings.bodyWeightGoalLb && latest?.weightLb
    ? (settings.bodyWeightGoalLb < latest.weightLb ? 'down' as const : 'up' as const)
    : undefined

  const saveGoals = async () => {
    await api.saveSettings({
      ...settings,
      bodyWeightGoalLb: parseNum(goalWeight),
      bodyFatGoalPct: parseNum(goalFat),
      heightIn: parseHeight(height),
    })
    await refreshSettings()
  }

  const saveReading = async () => {
    const fields: Partial<Record<BodyMetricKey, number>> = {}
    for (const m of METRICS) {
      const value = parseNum(form[m.key] ?? '')
      if (value !== undefined) fields[m.key] = value
    }
    if (Object.keys(fields).length === 0) return
    const now = new Date()
    await api.addBodyStat({ date: toDayKey(now), at: now.getTime(), ...fields })
    await refreshSettings()
    setForm({})
    setLogOpen(false)
    await reload()
  }

  if (!stats) return <p className="small">Loading…</p>

  return (
    <>
      {latest ? (
        <>
          <span className="lab" style={{ display: 'block', margin: '2px 0 6px' }}>
            Last reading · {fmtWhen(latest.at)}
          </span>
          <div className="bstat-grid">
            {METRICS.map((m) => {
              const value = latest[m.key]
              return (
                <div key={m.key} className="bstat">
                  <span className="num" style={{ fontSize: '1.15rem' }}>
                    {value !== undefined ? value : <span className="faint">—</span>}
                    {value !== undefined && m.unit && <span className="bstat-unit"> {m.unit}</span>}
                  </span>
                  <span className="lab bstat-lab">{m.label}</span>
                  {value !== undefined
                    ? <Delta cur={value} prev={prev?.[m.key]} direction={m.key === 'weightLb' ? weightDirection : m.direction} />
                    : <span className="bstat-delta"> </span>}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="card">
          <span className="lab" style={{ display: 'block', marginBottom: 4 }}>No readings yet</span>
          <span className="small">Log your first weigh-in below — only weight is required, everything else is optional.</span>
        </div>
      )}

      {stats.length >= 2 && <TrendCard stats={stats} weightDirection={weightDirection} />}

      <div className="card">
        <span className="lab">Goals</span>
        <div className="tape-pair" style={{ marginTop: 8 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Weight goal · lb</label>
            <input className="text-in" inputMode="decimal" placeholder="135" value={goalWeight} onChange={(e) => setGoalWeight(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Body fat goal · %</label>
            <input className="text-in" inputMode="decimal" placeholder="13" value={goalFat} onChange={(e) => setGoalFat(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Height</label>
            <input className="text-in" placeholder={'5\'5" or 65'} value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <button className="ghost-btn" style={{ alignSelf: 'end' }} onClick={saveGoals}>Save</button>
        </div>
        <span className="small" style={{ display: 'block', marginTop: 6 }}>Height fills in BMI automatically on weight-only entries.</span>
      </div>

      {logOpen ? (
        <div className="card">
          <span className="lab lm" style={{ display: 'block', marginBottom: 8 }}>New reading — blank fields are skipped</span>
          <div className="in-grid">
            {METRICS.map((m) => (
              <div key={m.key} className="field" style={{ marginBottom: 0 }}>
                <label>{m.label}{m.unit ? ` · ${m.unit}` : ''}</label>
                <input
                  className="text-in" inputMode="decimal"
                  value={form[m.key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [m.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="big-btn" onClick={saveReading}>Save reading</button>
            <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} onClick={() => setLogOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="big-btn" style={{ marginTop: 8 }} onClick={() => setLogOpen(true)}>+ Log reading</button>
      )}

      {stats.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p className="section-label">History</p>
          {stats.map((s) => (
            <div key={s.id} className="meal-row">
              <span>
                <b>{fmtWhen(s.at)}</b>
                <span className="small" style={{ marginLeft: 8 }}>
                  {s.weightLb !== undefined && `${s.weightLb} lb`}
                  {s.bodyFatPct !== undefined && ` · ${s.bodyFatPct}% fat`}
                  {s.muscleMassLb !== undefined && ` · ${s.muscleMassLb} lb muscle`}
                </span>
              </span>
              <button className="del" title="Delete reading" onClick={async () => { await api.deleteBodyStat(s.id); await reload() }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function TapeView() {
  const { api } = useApp()
  const [tapes, setTapes] = useState<TapeEntry[] | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [form, setForm] = useState<Partial<Record<TapeSite, string>>>({})

  const reload = useCallback(() => api.listTape().then(setTapes), [api])
  useEffect(() => { void reload() }, [reload])

  const latest = tapes?.[0]
  const ratio = latest?.sites.waist && latest?.sites.hip
    ? (latest.sites.waist / latest.sites.hip).toFixed(2)
    : undefined

  const saveSession = async () => {
    const sites: TapeEntry['sites'] = {}
    for (const row of TAPE_ROWS) for (const site of row.sites) {
      const value = parseNum(form[site] ?? '')
      if (value !== undefined) sites[site] = value
    }
    if (Object.keys(sites).length === 0) return
    const now = new Date()
    await api.addTape({ date: toDayKey(now), at: now.getTime(), sites })
    setForm({})
    setLogOpen(false)
    await reload()
  }

  if (!tapes) return <p className="small">Loading…</p>

  return (
    <>
      {latest ? (
        <>
          <span className="lab" style={{ display: 'block', margin: '2px 0 8px' }}>
            Last taped · {fmtWhen(latest.at)}
          </span>
          <div className="tape-pair">
            {TAPE_ROWS.map((row) => (
              <div key={row.label} className="tape-cell">
                <span className="lab bstat-lab" style={{ marginTop: 0 }}>{row.label}</span>
                <span className="num" style={{ fontSize: '0.98rem', display: 'block', marginTop: 2 }}>
                  {row.sites.length === 1
                    ? (latest.sites[row.sites[0]] !== undefined ? `${latest.sites[row.sites[0]]}"` : <span className="faint">—</span>)
                    : row.sites.map((site, i) => (
                        <span key={site}>
                          {i > 0 && <span className="faint"> · </span>}
                          <span className={`tape-side ${i === 0 ? 'l' : 'r'}`}>{i === 0 ? 'L' : 'R'}</span>{' '}
                          {latest.sites[site] !== undefined ? `${latest.sites[site]}"` : <span className="faint">—</span>}
                        </span>
                      ))}
                </span>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 10 }}>
            <div className="row">
              <span className="lab">Waist–hip ratio</span>
              {ratio
                ? <span className="num" style={{ fontSize: '1.1rem' }}>{ratio}</span>
                : <span className="lab faint">needs waist + hip</span>}
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <span className="lab" style={{ display: 'block', marginBottom: 4 }}>No tape sessions yet</span>
          <span className="small">Measure in inches — fill only the sites you taped.</span>
        </div>
      )}

      {logOpen ? (
        <div className="card">
          <span className="lab lm" style={{ display: 'block', marginBottom: 8 }}>New session · inches — blank sites are skipped</span>
          {TAPE_ROWS.map((row) => (
            <div key={row.label} className="field">
              <label>{row.label}{row.sites.length === 2 ? ' · L / R' : ''}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {row.sites.map((site) => (
                  <input
                    key={site} className="text-in" inputMode="decimal"
                    value={form[site] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [site]: e.target.value }))}
                  />
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="big-btn" onClick={saveSession}>Save session</button>
            <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} onClick={() => setLogOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="big-btn" style={{ marginTop: 8 }} onClick={() => setLogOpen(true)}>+ Log tape session</button>
      )}

      {tapes.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p className="section-label">History</p>
          {tapes.map((t) => (
            <div key={t.id} className="meal-row">
              <span>
                <b>{fmtWhen(t.at)}</b>
                <span className="small" style={{ marginLeft: 8 }}>{Object.keys(t.sites).length} sites</span>
              </span>
              <button className="del" title="Delete session" onClick={async () => { await api.deleteTape(t.id); await reload() }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function BodyScreen() {
  const { go } = useApp()
  const [view, setView] = useState<'composition' | 'tape'>('composition')

  return (
    <div className="page">
      <button className="back-link" onClick={() => go({ name: 'history' })}>‹ Stats</button>
      <h1 className="p-h1">Body<span className="dot">.</span></h1>
      <p className="p-sub">Composition readings & tape measurements</p>

      <div className="seg">
        <button className={view === 'composition' ? 'on' : ''} onClick={() => setView('composition')}>Composition</button>
        <button className={view === 'tape' ? 'on' : ''} onClick={() => setView('tape')}>Tape</button>
      </div>

      {view === 'composition' ? <CompositionView /> : <TapeView />}
    </div>
  )
}
