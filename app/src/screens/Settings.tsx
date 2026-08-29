import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useApp } from '../AppContext'
import { Seg } from '../components/Seg'
import { currentUser } from '../data/auth-store'
import { countRows, exportBackup, importBackup, parseBackup } from '../data/backup'
import { claimByPassphrase, syncNow, syncStore } from '../data/sync'
import { aiConfig, probeAi } from '../lib/ai'
import { signOut } from '../lib/auth-client'
import type { Settings, StrengthBaseline } from '../types'
import { epleyMaxLb, toDayKey } from '../types'

function AccountCard() {
  const status = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const user = currentUser()

  if (!status.configured || !user) return null

  const claim = async () => {
    const pass = window.prompt('This account already syncs automatically. To also pull in data saved under the old sync passphrase, enter that passphrase:')
    if (!pass) return
    setBusy(true)
    setMsg(null)
    try {
      await claimByPassphrase(pass)
      setMsg('Claimed — the data arrives with the next sync.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stateLabel = status.phase === 'syncing' ? 'Syncing…'
    : status.phase === 'error' ? 'Error'
    : status.pending > 0 ? `${status.pending} pending`
    : 'Synced'
  return (
    <div className="card">
      <div className="row">
        <span className="lab">Account — {stateLabel}</span>
        <span className="lab">
          {status.lastSyncAt ? `Last · ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
      </div>
      <span className="small" style={{ display: 'block', marginTop: 4 }}>{user.name} · {user.email}</span>
      {status.phase === 'error' && status.error && (
        <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>{status.error}</span>
      )}
      {msg && <span className="small" style={{ display: 'block', marginTop: 6 }}>{msg}</span>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={syncNow}>Sync now</button>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={busy} onClick={() => void claim()}>Claim old data</button>
        <button className="ghost-btn danger" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  )
}

function TrainingProfileCard() {
  const { api, settings, refreshSettings } = useApp()
  const [limitations, setLimitations] = useState(settings.limitations ?? '')
  const [age, setAge] = useState(settings.birthYear ? String(new Date().getFullYear() - settings.birthYear) : '')

  const patch = async (p: Partial<Settings>) => {
    await api.saveSettings({ ...settings, ...p })
    await refreshSettings()
  }

  return (
    <div className="card">
      <span className="lab" style={{ display: 'block' }}>Training profile</span>
      <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
        Sizes your AI starter programs. Everything is optional — saves as you tap.
      </span>
      <span className="lab">Experience</span>
      <Seg
        options={[{ v: 'new', label: 'New to gym' }, { v: 'returning', label: 'Returning' }, { v: 'experienced', label: 'Experienced' }]}
        value={settings.experience} onPick={(v) => void patch({ experience: v })}
      />
      <span className="lab">Goal</span>
      <Seg
        options={[
          { v: 'recomp', label: 'Muscle + abs' }, { v: 'muscle', label: 'Muscle' },
          { v: 'fat-loss', label: 'Fat loss' }, { v: 'strength', label: 'Strength' }, { v: 'general', label: 'Fitness' },
        ]}
        value={settings.goal} onPick={(v) => void patch({ goal: v })}
      />
      <div className="in-grid">
        <div>
          <span className="lab">Days / week</span>
          <Seg
            options={[{ v: 2, label: '2' }, { v: 3, label: '3' }, { v: 4, label: '4' }, { v: 5, label: '5+' }]}
            value={settings.daysPerWeek} onPick={(v) => void patch({ daysPerWeek: v })}
          />
        </div>
        <div>
          <span className="lab">Session</span>
          <Seg
            options={[{ v: 45, label: '45m' }, { v: 60, label: '60m' }, { v: 90, label: '90m' }]}
            value={settings.sessionMinutes} onPick={(v) => void patch({ sessionMinutes: v })}
          />
        </div>
      </div>
      <div className="in-grid">
        <div className="field" style={{ margin: 0 }}>
          <label>Age (optional)</label>
          <input
            className="text-in" inputMode="numeric" value={age} placeholder="—"
            onChange={(e) => setAge(e.target.value)}
            onBlur={() => {
              const a = parseInt(age, 10)
              void patch({ birthYear: isFinite(a) && a > 0 && a < 120 ? new Date().getFullYear() - a : undefined })
            }}
          />
        </div>
        <div>
          <span className="lab">Sex (optional)</span>
          <Seg
            options={[{ v: 'male', label: 'M' }, { v: 'female', label: 'F' }]}
            value={settings.sex} onPick={(v) => void patch({ sex: settings.sex === v ? undefined : v })}
          />
        </div>
      </div>
      <div className="field" style={{ margin: '10px 0 0' }}>
        <label>Anything to work around? (injuries etc.)</label>
        <input
          className="text-in" value={limitations} placeholder="e.g. lower back pain"
          onChange={(e) => setLimitations(e.target.value)}
          onBlur={() => void patch({ limitations: limitations.trim() || undefined })}
        />
      </div>
    </div>
  )
}

function AiCard() {
  const { api, settings, refreshSettings } = useApp()
  const [endpoint, setEndpoint] = useState(settings.aiEndpoint ?? '')
  const [apiKey, setApiKey] = useState(settings.aiApiKey ?? '')
  const [model, setModel] = useState(settings.aiModel ?? '')
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  const save = async () => {
    setState('testing')
    const next = {
      ...settings,
      aiEndpoint: endpoint.trim() || undefined,
      aiApiKey: apiKey.trim() || undefined,
      aiModel: model.trim() || undefined,
    }
    await api.saveSettings(next)
    await refreshSettings()
    const config = aiConfig(next)
    if (!config) { setState('idle'); return }
    setState(await probeAi(config) ? 'ok' : 'fail')
  }

  return (
    <div className="card">
      <div className="row">
        <span className="lab">✦ AI assist — CLIProxyAPI</span>
        {state === 'ok' && <span className="lab lm">Connected ✓</span>}
        {state === 'fail' && <span className="lab" style={{ color: 'var(--danger)' }}>Unreachable</span>}
      </div>
      <span className="small" style={{ display: 'block', margin: '6px 0 8px' }}>
        Your proxy's tailnet HTTPS address. AI buttons gray out whenever it can't be reached.
      </span>
      <div className="field">
        <label>Endpoint</label>
        <input
          className="text-in" placeholder="https://optiplex.tailnet.ts.net" autoCapitalize="off" autoCorrect="off"
          value={endpoint} onChange={(e) => { setEndpoint(e.target.value); setState('idle') }}
        />
      </div>
      <div className="in-grid">
        <div className="field" style={{ margin: 0 }}>
          <label>API key</label>
          <input
            className="text-in" type="password" placeholder="sk-…"
            value={apiKey} onChange={(e) => { setApiKey(e.target.value); setState('idle') }}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Model</label>
          <input
            className="text-in" placeholder="gemini-2.5-flash" autoCapitalize="off" autoCorrect="off"
            value={model} onChange={(e) => { setModel(e.target.value); setState('idle') }}
          />
        </div>
      </div>
      <div style={{ height: 10 }} />
      <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={state === 'testing'} onClick={() => void save()}>
        {state === 'testing' ? 'Testing…' : 'Test & save'}
      </button>
      {state === 'fail' && (
        <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>
          {endpoint.trim().startsWith('http://') && window.location.protocol === 'https:'
            ? 'Blocked by the browser: this app runs on https, so it can never call an http:// endpoint (mixed content) — an IP address can\'t get a certificate, so it has to be a name. On the proxy machine run "tailscale serve --bg localhost:8317", then use its https://…ts.net address here.'
            : "Saved, but the proxy didn't answer. Are you on Tailscale, and is the endpoint HTTPS?"}
        </span>
      )}
    </div>
  )
}

/** All the weights the user already knows they can do, one row per exercise. */
function MyStrengthCard() {
  const { api, exercises } = useApp()
  const [baselines, setBaselines] = useState<StrengthBaseline[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { w: string; r: string }>>({})
  const [addId, setAddId] = useState('')

  useEffect(() => {
    api.listBaselines().then((list) =>
      setBaselines([...list].sort((a, b) =>
        (exercises.get(a.id)?.name ?? a.id).localeCompare(exercises.get(b.id)?.name ?? b.id))),
    )
  }, [api, exercises])

  if (!baselines) return null

  const draftFor = (b: StrengthBaseline) => drafts[b.id] ?? { w: String(b.weightLb), r: String(b.reps) }

  const commit = async (exerciseId: string) => {
    const d = drafts[exerciseId]
    if (!d) return
    const w = parseFloat(d.w)
    const r = parseInt(d.r, 10)
    if (!isFinite(w) || w <= 0 || !isFinite(r) || r <= 0) return
    setDrafts((old) => { const n = { ...old }; delete n[exerciseId]; return n })
    const saved = await api.saveBaseline({ id: exerciseId, weightLb: w, reps: r })
    setBaselines((old) => old && old.map((b) => (b.id === exerciseId ? saved : b)))
  }

  const remove = async (b: StrengthBaseline) => {
    setDrafts((old) => { const n = { ...old }; delete n[b.id]; return n })
    setBaselines((old) => old && old.filter((other) => other.id !== b.id))
    if (b.at > 0) await api.deleteBaseline(b.id)
  }

  // rows with at === 0 are unsaved placeholders; they persist on first valid commit
  const add = () => {
    if (!addId) return
    setBaselines((old) => {
      const next = [...(old ?? []), { id: addId, weightLb: 0, reps: 0, at: 0 }]
      return next.sort((a, b) => (exercises.get(a.id)?.name ?? a.id).localeCompare(exercises.get(b.id)?.name ?? b.id))
    })
    setDrafts((old) => ({ ...old, [addId]: { w: '', r: '10' } }))
    setAddId('')
  }

  const remaining = [...exercises.values()]
    .filter((ex) => !baselines.some((b) => b.id === ex.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="card">
      <span className="lab" style={{ display: 'block' }}>My strength</span>
      <span className="small" style={{ display: 'block', margin: '6px 0 8px' }}>
        Your starting point per machine — one set's worth: the weight and how many reps you get at it (not number of sets). AI programs start from these instead of guessing, and each one updates itself whenever you log a heavier set in a workout.
      </span>
      {baselines.map((b) => {
        const d = draftFor(b)
        const valid = b.weightLb > 0 && b.reps > 0
        return (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span className="small" style={{ flex: 1, color: 'var(--ink)' }}>
              {exercises.get(b.id)?.name ?? b.id}
              {valid && (
                <span className="lab" style={{ display: 'block' }}>
                  est. max ~{epleyMaxLb(b.weightLb, b.reps)} lb · {new Date(b.at).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                </span>
              )}
            </span>
            <input
              className="text-in" inputMode="decimal" placeholder="lb" style={{ width: 64, textAlign: 'center' }}
              value={d.w}
              onChange={(e) => setDrafts((old) => ({ ...old, [b.id]: { ...d, w: e.target.value } }))}
              onBlur={() => void commit(b.id)}
            />
            <span className="lab">×</span>
            <input
              className="text-in" inputMode="numeric" placeholder="reps" style={{ width: 52, textAlign: 'center' }}
              value={d.r}
              onChange={(e) => setDrafts((old) => ({ ...old, [b.id]: { ...d, r: e.target.value } }))}
              onBlur={() => void commit(b.id)}
            />
            <button className="icon-btn" title="Remove" onClick={() => void remove(b)}>✕</button>
          </div>
        )
      })}
      {baselines.length === 0 && (
        <span className="small" style={{ display: 'block', marginTop: 4 }}>
          Nothing yet — add a machine below, or run the Strength Check routine at the gym.
        </span>
      )}
      {remaining.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <select className="text-in" value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Add an exercise…</option>
            {remaining.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
          <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} disabled={!addId} onClick={() => void add()}>
            Add
          </button>
        </div>
      )}
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

export function SettingsScreen() {
  return (
    <div className="page">
      <h1 className="p-h1" style={{ margin: '8px 0 14px' }}>Settings<span className="dot">.</span></h1>
      <AccountCard />
      <AiCard />
      <TrainingProfileCard />
      <MyStrengthCard />
      <DataCard />
    </div>
  )
}
