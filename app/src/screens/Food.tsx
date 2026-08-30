import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { aiConfig, parseFood, useAiAvailable, type AiFoodItem } from '../lib/ai'
import type { DayFoodStats, FoodEntry, FoodProduct, MealSlot, SavedMeal } from '../types'
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

/** Scanned barcode → portion → log. Servings when the label declares one, grams otherwise. */
function BarcodeCard({ product, onDone, onDismiss }: { product: FoodProduct; onDone: () => void; onDismiss: () => void }) {
  const { api } = useApp()
  const [name, setName] = useState(product.brand ? `${product.name} (${product.brand})` : product.name)
  const [mode, setMode] = useState<'serving' | 'grams'>(product.servingG ? 'serving' : 'grams')
  const [qty, setQty] = useState('1')
  const [grams, setGrams] = useState(product.servingG ? String(product.servingG) : '100')
  const [meal, setMeal] = useState<MealSlot>(currentSlot())

  const g = mode === 'serving'
    ? (parseFloat(qty) || 0) * (product.servingG ?? 0)
    : parseFloat(grams) || 0
  const macro = (per100: number) => Math.round((per100 * g) / 100)
  const calories = macro(product.per100g.calories)
  const protein = macro(product.per100g.protein)
  const carbs = macro(product.per100g.carbs)
  const fat = macro(product.per100g.fat)

  const add = async () => {
    if (g <= 0 || !name.trim()) return
    await api.addFood({
      date: toDayKey(new Date()), meal, name: name.trim(),
      detail: mode === 'serving'
        ? `${qty} serving${qty === '1' ? '' : 's'} · ${Math.round(g)} g`
        : `${Math.round(g)} g`,
      calories, protein, carbs, fat,
    })
    onDone()
  }

  return (
    <div className="card">
      <div className="row">
        <span className="lab lm">Scanned — how much did you have?</span>
        <button className="del" title="Dismiss" onClick={onDismiss}>✕</button>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Food</label>
        <input className="text-in" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {product.servingG ? (
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={mode === 'serving' ? 'on' : ''} onClick={() => setMode('serving')}>Servings</button>
          <button className={mode === 'grams' ? 'on' : ''} onClick={() => setMode('grams')}>Grams</button>
        </div>
      ) : null}
      {mode === 'serving' ? (
        <div className="field">
          <label>Servings · 1 = {product.servingLabel ?? `${product.servingG} g`}</label>
          <input className="text-in" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
      ) : (
        <div className="field">
          <label>Grams</label>
          <input className="text-in" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
        </div>
      )}
      <span className="small" style={{ display: 'block', margin: '0 0 10px', ...(g > 0 ? { color: 'var(--lime)' } : {}) }}>
        {g > 0
          ? `≈ ${calories} kcal · ${protein}g protein · ${carbs}g carbs · ${fat}g fat`
          : 'Enter how much you had and the numbers fill in.'}
      </span>
      <div className="field">
        <label>Meal</label>
        <select className="text-in" value={meal} onChange={(e) => setMeal(e.target.value as MealSlot)}>
          {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
        </select>
      </div>
      <button className="big-btn" disabled={g <= 0 || !name.trim()} onClick={() => void add()}>
        Log it →
      </button>
    </div>
  )
}

export function FoodScreen({ prefill }: { prefill?: FoodProduct }) {
  const { api, settings } = useApp()
  const today = toDayKey(new Date())
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [saved, setSaved] = useState<SavedMeal[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', meal: currentSlot() as MealSlot, save: false })
  const ai = useAiAvailable(settings)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiItems, setAiItems] = useState<AiFoodItem[] | null>(null)
  const [aiMeal, setAiMeal] = useState<MealSlot>(currentSlot())
  const [scanned, setScanned] = useState<FoodProduct | undefined>(prefill)

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
    const carbs = form.carbs.trim() ? parseInt(form.carbs, 10) || 0 : undefined
    const fat = form.fat.trim() ? parseInt(form.fat, 10) || 0 : undefined
    if (!form.name.trim() || !isFinite(calories)) return
    await api.addFood({ date: today, meal: form.meal, name: form.name.trim(), calories, protein, carbs, fat })
    if (form.save) {
      const m = await api.saveSavedMeal({ name: form.name.trim(), calories, protein, carbs, fat })
      setSaved((old) => [...old, m])
    }
    setForm({ name: '', calories: '', protein: '', carbs: '', fat: '', meal: currentSlot(), save: false })
    setShowAdd(false)
    refresh()
  }

  const remove = async (id: string) => {
    await api.deleteFood(id)
    refresh()
  }

  const analyze = async () => {
    const config = aiConfig(settings)
    if (!config || !aiText.trim() || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    try {
      const items = await parseFood(config, aiText)
      setAiItems(items)
      setAiMeal(items.find((item) => item.meal)?.meal ?? currentSlot())
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  const patchAiItem = (index: number, patch: Partial<AiFoodItem>) =>
    setAiItems((items) => items!.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const addAllAi = async () => {
    for (const item of aiItems ?? []) {
      if (!item.name.trim() || !isFinite(item.calories)) continue
      await api.addFood({
        date: today, meal: aiMeal, name: item.name.trim(),
        calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat,
      })
    }
    setAiItems(null)
    setAiText('')
    setShowAdd(false)
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
      {/* carbs & fat are context, not targets: gray bars show their share of the calorie target */}
      <div className="macro-row">
        <span className="lab">Carbs</span>
        <span className="num">{stats.carbs}<span className="of"> g</span></span>
      </div>
      <div className="bar"><i className="dim" style={{ width: `${Math.min(100, ((stats.carbs * 4) / settings.calorieTarget) * 100)}%` }} /></div>
      <div className="macro-row">
        <span className="lab">Fat</span>
        <span className="num">{stats.fat}<span className="of"> g</span></span>
      </div>
      <div className="bar"><i className="dim" style={{ width: `${Math.min(100, ((stats.fat * 9) / settings.calorieTarget) * 100)}%` }} /></div>

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
                      <span className="small">
                        {e.calories} kcal · {e.protein}P
                        {e.carbs != null && ` · ${e.carbs}C`}
                        {e.fat != null && ` · ${e.fat}F`}
                      </span>
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
          {scanned && (
            <BarcodeCard
              product={scanned}
              onDone={() => { setScanned(undefined); void refresh() }}
              onDismiss={() => setScanned(undefined)}
            />
          )}
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

          {aiItems ? (
            <div className="card">
              <div className="row">
                <span className="lab lm">✦ AI estimate — review</span>
                <span className="lab">{aiItems.reduce((t, i) => t + i.calories, 0)} kcal</span>
              </div>
              {aiItems.map((item, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="text-in" style={{ flex: 1, minWidth: 0 }} value={item.name}
                      onChange={(e) => patchAiItem(i, { name: e.target.value })} />
                    <button className="del" title="Remove" onClick={() => setAiItems((items) => items!.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {([
                      { key: 'calories', label: 'kcal' },
                      { key: 'protein', label: 'Protein' },
                      { key: 'carbs', label: 'Carbs' },
                      { key: 'fat', label: 'Fat' },
                    ] as const).map((f) => (
                      <div key={f.key} style={{ flex: 1, minWidth: 0 }}>
                        <span className="lab" style={{ display: 'block', fontSize: '0.52rem', marginBottom: 3 }}>{f.label}</span>
                        <input className="text-in" style={{ padding: '8px 6px', textAlign: 'center' }} inputMode="numeric"
                          value={item[f.key] ?? ''}
                          onChange={(e) => patchAiItem(i, { [f.key]: parseInt(e.target.value, 10) || 0 })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <span className="small" style={{ display: 'block', marginTop: 6 }}>Grams for protein, carbs and fat — estimates, tweak anything.</span>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Meal</label>
                <select className="text-in" value={aiMeal} onChange={(e) => setAiMeal(e.target.value as MealSlot)}>
                  {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
                </select>
              </div>
              <button className="big-btn" onClick={() => void addAllAi()} disabled={aiItems.length === 0}>
                Add {aiItems.length} item{aiItems.length === 1 ? '' : 's'} →
              </button>
              <div style={{ height: 8 }} />
              <button className="ghost-btn" onClick={() => setAiItems(null)}>Back</button>
            </div>
          ) : showAdd ? (
            <div className="card">
              <div className="field">
                <label style={ai.available ? { color: 'var(--lime)' } : undefined}>
                  ✦ Describe it{ai.available ? '' : ' — offline'}
                </label>
                <textarea
                  className="text-in" rows={2} style={{ resize: 'none', ...(ai.available ? {} : { opacity: 0.55 }) }}
                  placeholder="2 eggs, toast with butter, café con leche"
                  value={aiText} disabled={!ai.available || aiBusy}
                  onChange={(e) => setAiText(e.target.value)}
                />
              </div>
              <button className="ghost-btn" disabled={!ai.available || aiBusy || !aiText.trim()} onClick={() => void analyze()}>
                {aiBusy ? 'Analyzing…' : 'Analyze with AI'}
              </button>
              {aiError && <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>{aiError}</span>}
              {!ai.available && (
                <span className="small" style={{ display: 'block', marginTop: 6 }}>
                  {ai.configured ? 'AI offline — connect to Tailscale.' : 'Set up AI in Settings.'}
                </span>
              )}
              <div style={{ height: 14 }} />
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
              <div className="in-grid">
                <div className="field">
                  <label>Carbs (g) — optional</label>
                  <input className="text-in" inputMode="numeric" value={form.carbs} placeholder="55"
                    onChange={(e) => setForm({ ...form, carbs: e.target.value })} />
                </div>
                <div className="field">
                  <label>Fat (g) — optional</label>
                  <input className="text-in" inputMode="numeric" value={form.fat} placeholder="20"
                    onChange={(e) => setForm({ ...form, fat: e.target.value })} />
                </div>
              </div>
              <span className="small" style={{ display: 'block', margin: '-4px 0 10px' }}>
                Skip carbs and fat if you don't know them — calories and protein are what matter for your goal.
              </span>
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
              ＋ Quick add (name · kcal · macros)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
