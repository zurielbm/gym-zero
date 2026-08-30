import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { HydrationCard } from '../components/HydrationCard'
import { aiConfig, parseFood, parseFoodPhoto, useAiAvailable, type AiFoodItem, type AiFoodRequest, type AiFoodResult } from '../lib/ai'
import { downscalePhoto } from '../lib/image'
import type { DayFoodStats, FoodEntry, FoodProduct, MealSlot, SavedMeal } from '../types'
import { currentMealSlot as currentSlot, toDayKey } from '../types'

const slots: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const slotLabel: Record<MealSlot, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
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
      grams: Math.round(g),
      servings: mode === 'serving' ? parseFloat(qty) || undefined : undefined,
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

/** Tap-to-edit for a logged entry; the ×portion field re-scales every number at once. */
function EntryEditor({ entry, onSaved, onCancel }: { entry: FoodEntry; onSaved: () => void; onCancel: () => void }) {
  const { api } = useApp()
  const [f, setF] = useState({
    name: entry.name,
    calories: String(entry.calories),
    protein: String(entry.protein),
    carbs: entry.carbs != null ? String(entry.carbs) : '',
    fat: entry.fat != null ? String(entry.fat) : '',
    meal: entry.meal,
    scale: '1',
  })
  const scale = parseFloat(f.scale)
  const scaling = isFinite(scale) && scale > 0 && scale !== 1
  const times = (v: string) => Math.round((parseInt(v, 10) || 0) * (scaling ? scale : 1))
  const ok = !!f.name.trim() && isFinite(parseInt(f.calories, 10)) && (!f.scale.trim() || (isFinite(scale) && scale > 0))

  const save = async () => {
    if (!ok) return
    const grams = entry.grams != null && scaling ? Math.round(entry.grams * scale) : entry.grams
    const servings = entry.servings != null && scaling ? Math.round(entry.servings * scale * 100) / 100 : entry.servings
    await api.updateFood({
      ...entry,
      name: f.name.trim(),
      meal: f.meal,
      calories: times(f.calories),
      protein: times(f.protein),
      carbs: f.carbs.trim() ? times(f.carbs) : undefined,
      fat: f.fat.trim() ? times(f.fat) : undefined,
      grams,
      servings,
      detail: grams != null && grams !== entry.grams
        ? (servings != null ? `${servings} serving${servings === 1 ? '' : 's'} · ${grams} g` : `${grams} g`)
        : entry.detail,
    })
    onSaved()
  }

  return (
    <div style={{ padding: '8px 0 4px' }}>
      <div className="field">
        <label>Food</label>
        <input className="text-in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {([
          { key: 'calories', label: 'kcal' },
          { key: 'protein', label: 'Protein' },
          { key: 'carbs', label: 'Carbs' },
          { key: 'fat', label: 'Fat' },
        ] as const).map((c) => (
          <div key={c.key} style={{ flex: 1, minWidth: 0 }}>
            <span className="lab" style={{ display: 'block', fontSize: '0.625rem', marginBottom: 3 }}>{c.label}</span>
            <input className="text-in" style={{ padding: '8px 6px', textAlign: 'center' }} inputMode="numeric"
              value={f[c.key]} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="in-grid" style={{ marginTop: 8 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Meal</label>
          <select className="text-in" value={f.meal} onChange={(e) => setF({ ...f, meal: e.target.value as MealSlot })}>
            {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Portion × (1.5 = half again)</label>
          <input className="text-in" inputMode="decimal" value={f.scale}
            onChange={(e) => setF({ ...f, scale: e.target.value })} />
        </div>
      </div>
      {scaling && (
        <span className="small" style={{ display: 'block', marginTop: 6, color: 'var(--lime)' }}>
          ×{scale} → {times(f.calories)} kcal · {times(f.protein)}g protein
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={!ok} onClick={() => void save()}>Save</button>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function FoodScreen({ prefill }: { prefill?: FoodProduct }) {
  const { api, go, settings } = useApp()
  const today = toDayKey(new Date())
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [saved, setSaved] = useState<SavedMeal[]>([])
  const [recent, setRecent] = useState<FoodEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', meal: currentSlot() as MealSlot, save: false })
  const ai = useAiAvailable(settings)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<AiFoodResult | null>(null)
  const [aiReq, setAiReq] = useState<AiFoodRequest | null>(null)
  const [aiAnswer, setAiAnswer] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [aiMeal, setAiMeal] = useState<MealSlot>(currentSlot())
  const [scanned, setScanned] = useState<FoodProduct | undefined>(prefill)
  const photoRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setEntries(await api.listFood(today))
    setStats(await api.getDayFoodStats(today))
  }, [api, today])

  useEffect(() => {
    refresh()
    api.listSavedMeals().then(setSaved)
    api.listRecentFood(14).then(setRecent)
  }, [api, refresh])

  const addSaved = async (m: SavedMeal) => {
    await api.addFood({
      date: today, meal: currentSlot(), name: m.name,
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
    })
    refresh()
  }

  // recent distinct foods, minus saved-meal duplicates and drink-log entries
  const savedNames = new Set(saved.map((m) => m.name.trim().toLowerCase()))
  const grabbable = recent
    .filter((e) => !savedNames.has(e.name.trim().toLowerCase()) && !e.detail?.startsWith('from drink log'))
    .slice(0, 6)

  const grab = async (e: FoodEntry) => {
    await api.addFood({
      date: today, meal: currentSlot(), name: e.name, detail: e.detail,
      calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat,
      grams: e.grams, servings: e.servings,
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
      const result = await parseFood(config, aiText)
      setAiResult(result)
      setAiReq({ kind: 'text', text: aiText })
      setAiAnswer('')
      setShowFeedback(false)
      setAiMeal(result.items.find((item) => item.meal)?.meal ?? currentSlot())
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  const analyzePhoto = async (file: File) => {
    const config = aiConfig(settings)
    if (!config || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    try {
      // any text already typed rides along as a note ("the bowl on the left is mine")
      const photoDataUrl = await downscalePhoto(file)
      const result = await parseFoodPhoto(config, photoDataUrl, aiText)
      setAiResult(result)
      setAiReq({ kind: 'photo', photoDataUrl, note: aiText })
      setAiAnswer('')
      setShowFeedback(false)
      setAiMeal(result.items.find((item) => item.meal)?.meal ?? currentSlot())
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  /** Send the user's answer back with the original request as context; the AI revises its items. */
  const answerQuestion = async (answer: string) => {
    const config = aiConfig(settings)
    if (!config || !aiResult || !aiReq || !answer.trim() || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    try {
      const followup = { priorRaw: aiResult.raw, answer: answer.trim() }
      const result = aiReq.kind === 'photo'
        ? await parseFoodPhoto(config, aiReq.photoDataUrl, aiReq.note, followup)
        : await parseFood(config, aiReq.text, followup)
      setAiResult(result)
      setAiAnswer('')
      setShowFeedback(false)
      setAiMeal((meal) => result.items.find((item) => item.meal)?.meal ?? meal)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  const patchAiItem = (index: number, patch: Partial<AiFoodItem>) =>
    setAiResult((r) => r && { ...r, items: r.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) })

  const dropAiItem = (index: number) =>
    setAiResult((r) => r && { ...r, items: r.items.filter((_, i) => i !== index) })

  /** "That's one sandwich, not four ingredients" — sum everything into a single item. */
  const mergeAi = () =>
    setAiResult((r) => {
      if (!r || r.items.length < 2) return r
      const sum = (pick: (i: AiFoodItem) => number | undefined) =>
        r.items.some((i) => pick(i) != null) ? r.items.reduce((t, i) => t + (pick(i) ?? 0), 0) : undefined
      const merged: AiFoodItem = {
        name: r.items.map((i) => i.name).join(' + ').slice(0, 60),
        calories: r.items.reduce((t, i) => t + i.calories, 0),
        protein: r.items.reduce((t, i) => t + i.protein, 0),
        carbs: sum((i) => i.carbs),
        fat: sum((i) => i.fat),
        meal: r.items[0].meal,
      }
      return { ...r, items: [merged] }
    })

  const closeAi = () => {
    setAiResult(null)
    setAiReq(null)
    setAiAnswer('')
    setShowFeedback(false)
  }

  const addAllAi = async () => {
    for (const item of aiResult?.items ?? []) {
      if (!item.name.trim() || !isFinite(item.calories)) continue
      await api.addFood({
        date: today, meal: aiMeal, name: item.name.trim(),
        calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat,
      })
    }
    closeAi()
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
      <HydrationCard onFoodChanged={() => void refresh()} />

      <div style={{ height: 12 }} />
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
                  editingId === e.id ? (
                    <EntryEditor
                      key={e.id} entry={e}
                      onSaved={() => { setEditingId(null); void refresh() }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <div key={e.id} className="meal-row">
                      <span style={{ cursor: 'pointer', flex: 1, minWidth: 0 }} title="Tap to edit" onClick={() => setEditingId(e.id)}>
                        {e.name}
                        {e.detail && <span className="small" style={{ display: 'block' }}>{e.detail}</span>}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="small">
                          {e.calories} kcal · {e.protein}P
                          {e.carbs != null && ` · ${e.carbs}C`}
                          {e.fat != null && ` · ${e.fat}F`}
                        </span>
                        <button className="del" title="Delete" onClick={() => remove(e.id)}>✕</button>
                      </span>
                    </div>
                  )
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
          {grabbable.length > 0 && (
            <>
              <p className="section-label">Grab again — recent, same portion</p>
              <div style={{ marginBottom: 10 }}>
                {grabbable.map((e) => (
                  <button key={e.id} type="button" className="chip btn" onClick={() => void grab(e)}>
                    {e.name} · {e.calories} kcal
                  </button>
                ))}
              </div>
            </>
          )}
          {saved.length > 0 && (
            <>
              <p className="section-label">Quick add — saved meals</p>
              <div style={{ marginBottom: 10 }}>
                {saved.map((m) => (
                  <button key={m.id} type="button" className="chip green btn" onClick={() => void addSaved(m)}>
                    {m.emoji ? `${m.emoji} ` : ''}{m.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {aiResult ? (
            <div className="card">
              <div className="row">
                <span className="lab lm">✦ AI estimate — review</span>
                <span className="lab">{aiResult.items.reduce((t, i) => t + i.calories, 0)} kcal</span>
              </div>
              {aiResult.question && (
                <div style={{ border: '1px solid var(--lime)', padding: '10px 12px', margin: '10px 0 4px' }}>
                  <span className="small" style={{ color: 'var(--ink)', display: 'block', marginBottom: 8 }}>
                    {aiResult.question.text}
                  </span>
                  <div>
                    {aiResult.question.options.map((opt) => (
                      <button key={opt} type="button" className="chip green btn" disabled={aiBusy}
                        onClick={() => void answerQuestion(opt)}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input className="text-in" style={{ flex: 1, minWidth: 0 }} placeholder="Or answer in your own words…"
                      value={aiAnswer} disabled={aiBusy}
                      onChange={(e) => setAiAnswer(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void answerQuestion(aiAnswer) }} />
                    <button className="ghost-btn" style={{ width: 'auto', padding: '0 16px' }}
                      disabled={aiBusy || !aiAnswer.trim()} onClick={() => void answerQuestion(aiAnswer)}>
                      {aiBusy ? '…' : '↩'}
                    </button>
                  </div>
                  {aiResult.items.length > 0 && (
                    <span className="small" style={{ display: 'block', marginTop: 6 }}>
                      Answering sharpens the numbers below — or just add them as-is.
                    </span>
                  )}
                </div>
              )}
              {aiResult.items.length >= 2 && (
                <button className="ghost-btn" style={{ width: 'auto', padding: '8px 14px', marginTop: 10 }} disabled={aiBusy} onClick={mergeAi}>
                  ⇤ One dish? Merge into a single item
                </button>
              )}
              {aiResult.items.map((item, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="text-in" style={{ flex: 1, minWidth: 0 }} value={item.name}
                      onChange={(e) => patchAiItem(i, { name: e.target.value })} />
                    <button className="del" title="Remove" onClick={() => dropAiItem(i)}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {([
                      { key: 'calories', label: 'kcal' },
                      { key: 'protein', label: 'Protein' },
                      { key: 'carbs', label: 'Carbs' },
                      { key: 'fat', label: 'Fat' },
                    ] as const).map((f) => (
                      <div key={f.key} style={{ flex: 1, minWidth: 0 }}>
                        <span className="lab" style={{ display: 'block', fontSize: '0.625rem', marginBottom: 3 }}>{f.label}</span>
                        <input className="text-in" style={{ padding: '8px 6px', textAlign: 'center' }} inputMode="numeric"
                          value={item[f.key] ?? ''}
                          onChange={(e) => patchAiItem(i, { [f.key]: parseInt(e.target.value, 10) || 0 })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {aiResult.items.length > 0 && (
                <span className="small" style={{ display: 'block', marginTop: 6 }}>Grams for protein, carbs and fat — estimates, tweak anything.</span>
              )}
              {!aiResult.question && aiResult.items.length > 0 && (
                showFeedback ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="text-in" style={{ flex: 1, minWidth: 0 }}
                        placeholder="e.g. I ate 3 of these · it was a large bowl" autoFocus
                        value={aiAnswer} disabled={aiBusy}
                        onChange={(e) => setAiAnswer(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void answerQuestion(aiAnswer) }} />
                      <button className="ghost-btn" style={{ width: 'auto', padding: '0 16px' }}
                        disabled={aiBusy || !aiAnswer.trim()} onClick={() => void answerQuestion(aiAnswer)}>
                        {aiBusy ? '…' : '↩'}
                      </button>
                    </div>
                    <span className="small" style={{ display: 'block', marginTop: 6 }}>
                      It re-checks {aiReq?.kind === 'photo' ? 'the photo' : 'your description'} with your note and fixes the numbers.
                    </span>
                  </div>
                ) : (
                  <button className="ghost-btn" style={{ width: 'auto', padding: '8px 14px', marginTop: 10 }}
                    disabled={aiBusy} onClick={() => setShowFeedback(true)}>
                    ✎ Did it get something wrong? Tell it
                  </button>
                )
              )}
              <div className="field" style={{ marginTop: 10 }}>
                <label>Meal</label>
                <select className="text-in" value={aiMeal} onChange={(e) => setAiMeal(e.target.value as MealSlot)}>
                  {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
                </select>
              </div>
              {aiError && <span className="small" style={{ color: 'var(--danger)', display: 'block', margin: '0 0 8px' }}>{aiError}</span>}
              <button className="big-btn" onClick={() => void addAllAi()} disabled={aiResult.items.length === 0 || aiBusy}>
                Add {aiResult.items.length} item{aiResult.items.length === 1 ? '' : 's'} →
              </button>
              <div style={{ height: 8 }} />
              <button className="ghost-btn" onClick={closeAi}>Back</button>
            </div>
          ) : showAdd ? (
            <div className="card">
              <div className="field">
                <label style={ai.available ? { color: 'var(--lime)' } : undefined}>
                  ✦ Describe it or snap it{ai.available ? '' : ' — offline'}
                </label>
                <textarea
                  className="text-in" rows={2} style={{ resize: 'none', ...(ai.available ? {} : { opacity: 0.55 }) }}
                  placeholder="2 eggs, toast with butter, café con leche"
                  value={aiText} disabled={!ai.available || aiBusy}
                  onChange={(e) => setAiText(e.target.value)}
                />
              </div>
              {!ai.available && (
                <button className="ai-hint" onClick={() => go({ name: 'settings' })}>
                  {ai.configured
                    ? '⚡ AI offline — connect to Tailscale, or check the endpoint in Settings ›'
                    : '⚡ AI is off — set your endpoint in Settings to analyze text & photos ›'}
                </button>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`ghost-btn${ai.available ? '' : ' soft-disabled'}`}
                  disabled={aiBusy || (ai.available && !aiText.trim())}
                  onClick={() => (ai.available ? void analyze() : go({ name: 'settings' }))}
                >
                  {aiBusy ? 'Analyzing…' : 'Analyze with AI'}
                </button>
                <button
                  className={`ghost-btn${ai.available ? '' : ' soft-disabled'}`}
                  style={{ width: 'auto', padding: '0 16px' }} title="Photo of your food"
                  disabled={aiBusy}
                  onClick={() => (ai.available ? photoRef.current?.click() : go({ name: 'settings' }))}
                >
                  📷
                </button>
                <input
                  ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void analyzePhoto(file)
                  }}
                />
              </div>
              {aiError && <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>{aiError}</span>}
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
