import { useCallback, useEffect, useState } from 'react'
import { Ring } from './Ring'
import { useAction, useFeedback } from './Feedback'
import { shortDay, usd } from './AiSettingsCard'
import { aiOverview, amIAiAdmin, setAiHousehold, setAiPerson, type AiOverview, type AiPerson } from '../lib/household-ai'
import { forgetAiStatus } from '../lib/ai'
import './ai-settings.css'

/** What one person typically spends a month on household AI (Haiku, daily food logs, 4 workouts a week). */
const TYPICAL_USD = 0.16
const STEP_USD = 0.5

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString([], { month: 'short', year: 'numeric', timeZone: 'UTC' })
const pct = (spent: number, cap: number | null) => cap ? Math.min(100, (spent / cap) * 100) : 0
const meterClass = (p: number) => `ai-meter${p >= 100 ? ' over' : p >= 80 ? ' hot' : ''}`

function MoneyStepper({ value, onChange, min = 0, max, zeroLabel }: {
  value: number
  onChange: (value: number) => void
  min?: number
  max: number
  /** shown instead of $0 when zero means something else (e.g. "No cap") */
  zeroLabel?: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 2) / 2))
  return (
    <div className="ai-stepper">
      <button className="ai-step" aria-label="Less" disabled={value <= min} onClick={() => onChange(clamp(value - STEP_USD))}>−</button>
      <span className="ai-step-value" aria-live="polite">{value === 0 && zeroLabel ? zeroLabel : `$${value % 1 ? value.toFixed(2) : value}`}</span>
      <button className="ai-step" aria-label="More" disabled={value >= max} onClick={() => onChange(clamp(value + STEP_USD))}>+</button>
    </div>
  )
}

function personHint(usdValue: number): string {
  if (usdValue === 0) return 'No personal cap. Only the household budget limits them.'
  const months = usdValue / TYPICAL_USD
  if (months < 1.5) return 'Tight: a heavy food-photo month could reach it.'
  return `About ${Math.round(months)}× a typical month ($${TYPICAL_USD.toFixed(2)}). ${months >= 4 ? 'Plenty of room.' : 'Some room.'}`
}

function PersonEditor({ person, defaultMicros, onSaved }: { person: AiPerson; defaultMicros: number; onSaved: () => Promise<void> }) {
  const action = useAction()
  const notify = useFeedback()
  const [cap, setCap] = useState((person.capMicros ?? 0) / 1_000_000)
  const [allowed, setAllowed] = useState(!person.blocked)
  const [useDefault, setUseDefault] = useState(!person.customCap)
  const shown = useDefault ? defaultMicros / 1_000_000 : cap
  const save = () => action.run(async () => {
    await setAiPerson(person.userId, { monthlyUsd: useDefault ? null : cap, blocked: !allowed })
    await onSaved()
    notify(`Saved for ${person.name}`)
  })
  return (
    <div className="ai-person-edit">
      <span className="small">{person.requests} calls · {person.photos} photos this month</span>
      <div className="lab" style={{ textAlign: 'center', marginTop: 10 }}>Monthly limit</div>
      <MoneyStepper value={shown} max={50} zeroLabel="No cap" onChange={(n) => { setUseDefault(false); setCap(n) }} />
      <span className="small ai-hint" style={{ textAlign: 'center' }}>{personHint(shown)}</span>
      {!useDefault && (
        <button className="text-button sm" style={{ display: 'block', margin: '0 auto' }} onClick={() => setUseDefault(true)}>Use the default ({usd(defaultMicros)})</button>
      )}
      <button className="ai-switch-row" role="switch" aria-checked={allowed} onClick={() => setAllowed(!allowed)}>
        <span><b>Allow household AI</b><span className="small">{allowed ? 'They can use the shared key.' : 'AI is off for them; the rest of the app still works.'}</span></span>
        <span className={`ai-toggle${allowed ? ' on' : ''}`} aria-hidden="true" />
      </button>
      <button className="big-btn" style={{ marginTop: 10 }} disabled={action.busy} onClick={() => void save()}>{action.busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}

function HouseholdEditor({ label, valueMicros, max, hint, zeroLabel, onSave }: {
  label: string
  valueMicros: number
  max: number
  hint: (usd: number) => string
  zeroLabel?: string
  onSave: (usd: number) => Promise<void>
}) {
  const action = useAction()
  const [value, setValue] = useState(valueMicros / 1_000_000)
  return (
    <div className="ai-person-edit">
      <div className="lab" style={{ textAlign: 'center' }}>{label}</div>
      <MoneyStepper value={value} min={zeroLabel ? 0 : STEP_USD} max={max} zeroLabel={zeroLabel} onChange={setValue} />
      <span className="small ai-hint" style={{ textAlign: 'center' }}>{hint(value)}</span>
      <button className="big-btn" style={{ marginTop: 10 }} disabled={action.busy} onClick={() => void action.run(() => onSave(value))}>{action.busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}

/** Admin-only: household AI spend, caps, and per-person limits. Hidden for everyone else. */
export function AiUsageCard() {
  const notify = useFeedback()
  const action = useAction()
  const [admin, setAdmin] = useState(false)
  const [data, setData] = useState<AiOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await aiOverview()); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load AI usage.') }
  }, [])

  useEffect(() => {
    let alive = true
    void amIAiAdmin().then((yes) => { if (alive && yes) { setAdmin(true); void load() } })
    return () => { alive = false }
  }, [load])

  if (!admin) return null

  const saved = async () => { setOpen(null); forgetAiStatus(); await load() }
  const toggleOpen = (id: string) => setOpen(open === id ? null : id)

  if (!data) return (
    <div className="card ai-admin">
      <span className="lab lm">✦ Household AI · Admin</span>
      {error ? <div className="inline-error"><p role="alert">{error}</p><button className="ghost-btn" onClick={() => void load()}>Try again</button></div>
        : <p className="small" role="status">Loading usage…</p>}
    </div>
  )

  const left = Math.max(0, data.householdCapMicros - data.householdSpentMicros)
  const usedPct = pct(data.householdSpentMicros, data.householdCapMicros)
  const daysLeft = Math.max(0, Math.ceil((data.resetsAt - Date.now()) / 86_400_000))
  const ringColor = usedPct >= 100 ? 'var(--danger)' : usedPct >= 80 ? 'var(--carb)' : 'var(--lime)'

  return (
    <div className="card ai-admin">
      <div className="row">
        <span className="lab lm">✦ Household AI · Admin</span>
        <span className="lab">{monthName(data.month)}</span>
      </div>

      {!data.configured && (
        <p className="small ai-warn" role="alert">
          No Anthropic key on the server yet, so household AI is off. Set <code>ANTHROPIC_API_KEY</code> with <code>npx convex env set</code> (see DEPLOY.md).
        </p>
      )}

      <div className="ai-gauge">
        <Ring value={left} target={data.householdCapMicros} color={ringColor} size="big" label={`${usd(left)} of ${usd(data.householdCapMicros)} left this month`}>
          <span className="ai-gauge-num">{usd(left)}</span><small>left</small>
        </Ring>
        <span className="small">{Math.round(100 - usedPct)}% left · {daysLeft === 1 ? '1 day' : `${daysLeft} days`} to go · refreshes {shortDay(data.resetsAt)}</span>
      </div>

      <div className="ai-list">
        <button className="ai-li" aria-expanded={open === 'cap'} onClick={() => toggleOpen('cap')}><span>Household budget</span><span className="lm">{usd(data.householdCapMicros)} ›</span></button>
        {open === 'cap' && (
          <HouseholdEditor label="Monthly household budget" valueMicros={data.householdCapMicros} max={500}
            hint={(n) => `Covers about ${Math.floor(n / TYPICAL_USD)} people at typical use. Keep it under your Anthropic Console spend limit.`}
            onSave={async (n) => { await setAiHousehold({ monthlyUsd: n }); await saved(); notify('Household budget saved') }} />
        )}
        <button className="ai-li" aria-expanded={open === 'default'} onClick={() => toggleOpen('default')}><span>Default per person</span><span className="lm">{data.defaultUserMicros ? usd(data.defaultUserMicros) : 'No cap'} ›</span></button>
        {open === 'default' && (
          <HouseholdEditor label="Default monthly limit" valueMicros={data.defaultUserMicros} max={50} zeroLabel="No cap" hint={personHint}
            onSave={async (n) => { await setAiHousehold({ defaultUserUsd: n }); await saved(); notify('Default limit saved') }} />
        )}
        <div className="ai-li static"><span>Spent · {data.requests} {data.requests === 1 ? 'call' : 'calls'}</span><span>{usd(data.householdSpentMicros)}</span></div>
        <button className="ai-li" role="switch" aria-checked={!data.paused} disabled={action.busy}
          onClick={() => void action.run(async () => { await setAiHousehold({ paused: !data.paused }); await saved(); notify(data.paused ? 'Household AI is back on' : 'Household AI paused for everyone') })}>
          <span>Household AI on</span><span className={`ai-toggle${data.paused ? '' : ' on'}`} aria-hidden="true" />
        </button>
      </div>

      <div className="lab" style={{ margin: '14px 0 4px' }}>People</div>
      <div className="ai-people">
        {data.people.map((person) => {
          const p = pct(person.spentMicros, person.capMicros)
          return (
            <div key={person.userId} className="ai-person">
              <button className="ai-person-row" aria-expanded={open === person.userId} onClick={() => toggleOpen(person.userId)}>
                <span className="ai-person-name">
                  {person.name}
                  {person.blocked ? <span className="ai-tag">Off</span>
                    : person.capMicros !== null && person.spentMicros >= person.capMicros ? <span className="ai-tag">Limit</span>
                    : person.ownKey ? <span className="ai-tag own">Own key</span> : null}
                </span>
                <span className="ai-person-amt">{usd(person.spentMicros)}</span>
                <span className="small">{person.requests} {person.requests === 1 ? 'call' : 'calls'} · {person.capMicros !== null ? `limit ${usd(person.capMicros)}` : 'no limit'}{person.customCap ? '' : ' (default)'}</span>
                <span className="small" aria-hidden="true">›</span>
                {person.capMicros !== null && <span className={meterClass(p)}><i style={{ width: `${p}%` }} /></span>}
              </button>
              {open === person.userId && <PersonEditor person={person} defaultMicros={data.defaultUserMicros} onSaved={saved} />}
            </div>
          )
        })}
      </div>
      <p className="small" style={{ marginTop: 10 }}>Own-key use isn’t counted here; it’s billed to that person’s provider.</p>
    </div>
  )
}
