import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Seg } from './Seg'
import { fmtHalf, todayWorkoutMinutes, waterTargetOz, workoutBumpOz } from '../lib/hydration'
import type { Container, DrinkEntry, DrinkKind } from '../types'
import { currentMealSlot, toDayKey } from '../types'

const kindEmoji: Record<DrinkKind, string> = { water: '🚰', electrolyte: '⚡', coffee: '☕', shake: '🥤', other: '🧃' }

const fmtTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Tap-a-container hydration logging: register real vessels once, count refills. */
export function HydrationCard({ onFoodChanged }: { onFoodChanged?: () => void }) {
  const { api, settings } = useApp()
  const today = toDayKey(new Date())
  const [containers, setContainers] = useState<Container[]>([])
  const [drinks, setDrinks] = useState<DrinkEntry[]>([])
  const [fraction, setFraction] = useState(1)
  const [trainedMin, setTrainedMin] = useState(0)
  const [manage, setManage] = useState(false)
  const [form, setForm] = useState({ name: '', oz: '', kind: 'water' as DrinkKind, cal: '', pro: '' })

  const refresh = useCallback(async () => {
    setDrinks(await api.listDrinks(today))
  }, [api, today])

  useEffect(() => {
    void refresh()
    api.listContainers().then(setContainers)
    todayWorkoutMinutes(api, today).then(setTrainedMin)
  }, [api, refresh, today])

  const totalOz = Math.round(drinks.reduce((total, d) => total + d.volumeOz, 0))
  const target = waterTargetOz(settings, trainedMin)
  const pct = Math.min(100, target > 0 ? (totalOz / target) * 100 : 0)
  const hadElectrolytes = drinks.some((d) => d.kind === 'electrolyte')
  // the container totals are spoken in: the biggest water vessel reads most naturally
  const primary = [...containers].sort((a, b) => b.volumeOz - a.volumeOz).find((c) => c.kind === 'water')

  const logDrink = async (c: Container) => {
    const volumeOz = Math.round(c.volumeOz * fraction * 10) / 10
    // caloric containers (shakes, soda) write both ledgers from the one tap;
    // the pair is linked so deleting either half removes the other
    let foodEntryId: string | undefined
    if (c.calories && Math.round(c.calories * fraction) > 0) {
      const food = await api.addFood({
        date: today, meal: currentMealSlot(), name: c.name,
        detail: `from drink log · ${volumeOz} oz`,
        calories: Math.round(c.calories * fraction),
        protein: Math.round((c.protein ?? 0) * fraction),
      })
      foodEntryId = food.id
    }
    await api.addDrink({
      date: today, at: Date.now(), kind: c.kind, volumeOz,
      containerId: c.id, name: c.name, foodEntryId,
    })
    setFraction(1)
    void refresh()
    if (foodEntryId) onFoodChanged?.()
  }

  const removeDrink = async (id: string) => {
    const hadFood = !!drinks.find((d) => d.id === id)?.foodEntryId
    await api.deleteDrink(id)
    void refresh()
    if (hadFood) onFoodChanged?.()
  }

  const addContainer = async () => {
    const volumeOz = parseFloat(form.oz)
    if (!form.name.trim() || !isFinite(volumeOz) || volumeOz <= 0) return
    const calories = parseInt(form.cal, 10)
    const protein = parseInt(form.pro, 10)
    const saved = await api.saveContainer({
      name: form.name.trim(), emoji: kindEmoji[form.kind], volumeOz,
      kind: form.kind,
      calories: isFinite(calories) && calories > 0 ? calories : undefined,
      protein: isFinite(protein) && protein > 0 ? protein : undefined,
      sortOrder: (containers[containers.length - 1]?.sortOrder ?? -1) + 1,
    })
    setContainers((old) => [...old, saved])
    setForm({ name: '', oz: '', kind: 'water', cal: '', pro: '' })
  }

  const removeContainer = async (id: string) => {
    await api.deleteContainer(id)
    setContainers((old) => old.filter((c) => c.id !== id))
  }

  const words = () => {
    if (totalOz === 0) {
      return trainedMin > 0
        ? 'Nothing yet, and you trained today — time to start catching up.'
        : 'Tap a container when you finish it — that’s the whole system.'
    }
    const amount = primary
      ? `About ${fmtHalf(totalOz / primary.volumeOz)} ${primary.name.toLowerCase()}${Math.round(totalOz / primary.volumeOz * 2) <= 2 ? '' : 's'}`
      : `About ${totalOz} oz`
    const state = totalOz >= target ? 'that’s the target — nice.'
      : pct >= 75 ? 'almost there.'
      : pct >= 50 ? 'over halfway.'
      : 'keep sipping through the day.'
    const bump = trainedMin > 0 ? ' Training day, so the goal sits a bit higher.' : ''
    return `${amount} in — ${state}${bump}`
  }

  return (
    <div className="card">
      <div className="row">
        <span className="lab">Hydration</span>
        {trainedMin > 0 && <span className="lab lm">Trained · +{workoutBumpOz(trainedMin)} oz</span>}
      </div>
      <div className="macro-row" style={{ border: 0, margin: 0, paddingTop: 8 }}>
        <span className="lab">Water</span>
        <span className="num">
          {totalOz}<span className="of"> / {target} oz</span>
        </span>
      </div>
      <div className="bar"><i className="water" style={{ width: `${pct}%` }} /></div>
      <span className="small" style={{ display: 'block', marginTop: 8, ...(totalOz >= target ? { color: 'var(--lime)' } : {}) }}>
        {words()}
      </span>
      {trainedMin >= 60 && !hadElectrolytes && (
        <span className="small" style={{ display: 'block', marginTop: 4 }}>
          ⚡ Long session — water alone may not cut it. An electrolyte drink helps.
        </span>
      )}

      {manage ? (
        <div style={{ marginTop: 12 }}>
          {containers.map((c) => (
            <div key={c.id} className="meal-row">
              <span>{c.emoji ? `${c.emoji} ` : ''}{c.name}<span className="small" style={{ display: 'block' }}>{c.volumeOz} oz · {c.kind}{c.calories ? ` · ${c.calories} kcal` : ''}</span></span>
              <button className="del" title="Remove" onClick={() => void removeContainer(c.id)}>✕</button>
            </div>
          ))}
          <div className="in-grid" style={{ marginTop: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Container</label>
              <input className="text-in" value={form.name} placeholder="Big bottle"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Size (fl oz)</label>
              <input className="text-in" inputMode="decimal" value={form.oz} placeholder="24"
                onChange={(e) => setForm({ ...form, oz: e.target.value })} />
            </div>
          </div>
          <span className="lab" style={{ display: 'block', marginTop: 10 }}>What’s usually in it</span>
          <Seg
            options={[{ v: 'water', label: 'Water' }, { v: 'electrolyte', label: 'Electrolytes' }, { v: 'shake', label: 'Shake' }, { v: 'coffee', label: 'Coffee' }, { v: 'other', label: 'Soda / other' }]}
            value={form.kind} onPick={(v) => setForm({ ...form, kind: v })}
          />
          <div className="in-grid">
            <div className="field" style={{ margin: 0 }}>
              <label>Calories when full — optional</label>
              <input className="text-in" inputMode="numeric" value={form.cal} placeholder="0"
                onChange={(e) => setForm({ ...form, cal: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Protein (g) — optional</label>
              <input className="text-in" inputMode="numeric" value={form.pro} placeholder="0"
                onChange={(e) => setForm({ ...form, pro: e.target.value })} />
            </div>
          </div>
          {parseInt(form.cal, 10) > 0 && (
            <span className="small" style={{ display: 'block', margin: '6px 0 0' }}>
              Tapping this container will log the fluid here and the calories in your meals — one tap, both counted.
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }}
              disabled={!form.name.trim() || !(parseFloat(form.oz) > 0)} onClick={() => void addContainer()}>
              Add container
            </button>
            <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setManage(false)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            {containers.map((c) => (
              <button key={c.id} type="button" className="chip green btn" onClick={() => void logDrink(c)}>
                {c.emoji ? `${c.emoji} ` : ''}{c.name} · {fraction === 1 ? `${c.volumeOz}` : `${Math.round(c.volumeOz * fraction * 10) / 10}`} oz
              </button>
            ))}
            <button type="button" className="chip btn" title="Edit containers" onClick={() => setManage(true)}>
              {containers.length === 0 ? '＋ Add your bottle' : '✎ Edit'}
            </button>
          </div>
          <Seg
            options={[{ v: 0.25, label: '¼' }, { v: 0.5, label: '½' }, { v: 0.75, label: '¾' }, { v: 1, label: 'All of it' }]}
            value={fraction} onPick={setFraction}
          />
          <span className="small" style={{ display: 'block', margin: '-4px 0 0' }}>
            {fraction === 1
              ? 'Finished one? Tap it. Only drank part? Pick how much first.'
              : `Next tap logs ${fraction === 0.25 ? 'a quarter' : fraction === 0.5 ? 'half' : 'three quarters'} of that container.`}
          </span>
        </>
      )}

      {drinks.length > 0 && !manage && (
        <div style={{ marginTop: 10 }}>
          {[...drinks].reverse().map((d) => (
            <div key={d.id} className="meal-row">
              <span className="small" style={{ color: 'var(--ink)' }}>
                {containers.find((c) => c.id === d.containerId)?.emoji ?? kindEmoji[d.kind]} {d.name ?? d.kind} · {d.volumeOz} oz
                <span className="small" style={{ marginLeft: 8 }}>{fmtTime(d.at)}</span>
              </span>
              <button className="del" title="Delete" onClick={() => void removeDrink(d.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
