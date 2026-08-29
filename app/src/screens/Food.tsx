import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import type { DayFoodStats, FoodEntry, MealSlot, SavedMeal } from '../types'
import { toDayKey } from '../types'

const slots: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const slotLabel: Record<MealSlot, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
}

/** Sensible default meal slot from the current hour. */
function currentSlot(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

export function FoodScreen() {
  const { api, settings } = useApp()
  const today = toDayKey(new Date())
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0 })
  const [saved, setSaved] = useState<SavedMeal[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', calories: '', protein: '', meal: currentSlot() as MealSlot, save: false })

  const refresh = useCallback(async () => {
    setEntries(await api.listFood(today))
    setStats(await api.getDayFoodStats(today))
  }, [api, today])

  useEffect(() => {
    refresh()
    api.listSavedMeals().then(setSaved)
  }, [api, refresh])

  const addSaved = async (m: SavedMeal) => {
    await api.addFood({
      date: today, meal: currentSlot(), name: m.name,
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
    })
    refresh()
  }

  const quickAdd = async () => {
    const calories = parseInt(form.calories, 10)
    const protein = parseInt(form.protein, 10) || 0
    if (!form.name.trim() || !isFinite(calories)) return
    await api.addFood({ date: today, meal: form.meal, name: form.name.trim(), calories, protein })
    if (form.save) {
      const m = await api.saveSavedMeal({ name: form.name.trim(), calories, protein })
      setSaved((old) => [...old, m])
    }
    setForm({ name: '', calories: '', protein: '', meal: currentSlot(), save: false })
    setShowAdd(false)
    refresh()
  }

  const remove = async (id: string) => {
    await api.deleteFood(id)
    refresh()
  }

  const calPct = Math.min(100, (stats.calories / settings.calorieTarget) * 100)
  const proPct = Math.min(100, (stats.protein / settings.proteinTarget) * 100)

  return (
    <div className="page wide">
      <div className="row">
        <span className="lab">
          {new Intl.DateTimeFormat('en-US', { weekday: 'short', month: '2-digit', day: '2-digit' }).format(new Date())}
        </span>
      </div>
      <h1 className="p-h1" style={{ margin: '8px 0 2px' }}>Fuel<span className="dot">.</span></h1>

      <div className="macro-row">
        <span className="lab">Calories</span>
        <span className="num">
          {stats.calories.toLocaleString()}
          <span className="of"> / {settings.calorieTarget.toLocaleString()} kcal</span>
        </span>
      </div>
      <div className="bar"><i style={{ width: `${calPct}%` }} /></div>
      <div className="macro-row">
        <span className="lab">Protein</span>
        <span className="num">
          {stats.protein}
          <span className="of"> / {settings.proteinTarget} g</span>
        </span>
      </div>
      <div className="bar"><i className="alt" style={{ width: `${proPct}%` }} /></div>

      <div style={{ height: 18 }} />
      <div className="fd-grid">
        <div>
          {slots.map((slot) => {
            const list = entries.filter((e) => e.meal === slot)
            if (list.length === 0) return null
            const kcal = list.reduce((t, e) => t + e.calories, 0)
            return (
              <div key={slot} className="card">
                <div className="row">
                  <span className="lab">{slotLabel[slot]}</span>
                  <span className="lab">{kcal} kcal</span>
                </div>
                {list.map((e) => (
                  <div key={e.id} className="meal-row">
                    <span>
                      {e.name}
                      {e.detail && <span className="small" style={{ display: 'block' }}>{e.detail}</span>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="small">{e.calories} kcal · {e.protein}P</span>
                      <button className="del" title="Delete" onClick={() => remove(e.id)}>✕</button>
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
          {entries.length === 0 && (
            <div className="card">
              <span className="num" style={{ fontSize: '2.4rem', WebkitTextStroke: '1px var(--ghost)', color: 'transparent', display: 'block' }}>00</span>
              <span className="lab" style={{ display: 'block', marginTop: 4 }}>Nothing logged yet</span>
              <span className="small">Today's meals build here.</span>
            </div>
          )}
        </div>

        <div className="fd-side">
          {saved.length > 0 && (
            <>
              <p className="section-label">Quick add — saved meals</p>
              <div style={{ marginBottom: 10 }}>
                {saved.map((m) => (
                  <span key={m.id} className="chip green btn" onClick={() => addSaved(m)}>
                    {m.emoji ? `${m.emoji} ` : ''}{m.name}
                  </span>
                ))}
              </div>
            </>
          )}

          {showAdd ? (
            <div className="card">
              <div className="field">
                <label>Food</label>
                <input className="text-in" autoFocus value={form.name} placeholder="Chicken bowl"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="in-grid">
                <div className="field">
                  <label>Calories</label>
                  <input className="text-in" inputMode="numeric" value={form.calories} placeholder="650"
                    onChange={(e) => setForm({ ...form, calories: e.target.value })} />
                </div>
                <div className="field">
                  <label>Protein (g)</label>
                  <input className="text-in" inputMode="numeric" value={form.protein} placeholder="40"
                    onChange={(e) => setForm({ ...form, protein: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Meal</label>
                <select className="text-in" value={form.meal}
                  onChange={(e) => setForm({ ...form, meal: e.target.value as MealSlot })}>
                  {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
                </select>
              </div>
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.save}
                  onChange={(e) => setForm({ ...form, save: e.target.checked })} />
                Save as a reusable meal
              </label>
              <button className="big-btn" onClick={quickAdd} disabled={!form.name.trim() || !form.calories}>
                Add →
              </button>
            </div>
          ) : (
            <button className="ghost-btn" onClick={() => setShowAdd(true)}>
              ＋ Quick add (name · kcal · protein)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
