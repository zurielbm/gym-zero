import { liveQuery } from 'dexie'
import { AiConnection, AiTaskStatus } from '../components/AiStatus'
import { useAction, useFeedback } from '../components/Feedback'
import { useAiTask } from '../hooks/useAiTask'
import { addFoods, deleteFoodWithUndo } from '../data/food-actions'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { Ring } from '../components/Ring'
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
  const action = useAction()
  const notify = useFeedback()
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
    notify(`${name.trim()} logged`)
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
        <input aria-label="Scanned food name" className="text-in" value={name} onChange={(e) => setName(e.target.value)} />
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
          <input aria-label="Servings" className="text-in" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
      ) : (
        <div className="field">
          <label>Grams</label>
          <input aria-label="Grams" className="text-in" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
        </div>
      )}
      <span className="small" style={{ display: 'block', margin: '0 0 10px', ...(g > 0 ? { color: 'var(--lime)' } : {}) }}>
        {g > 0
          ? `≈ ${calories} kcal · ${protein}g protein · ${carbs}g carbs · ${fat}g fat`
          : 'Enter how much you had and the numbers fill in.'}
      </span>
      <div className="field">
        <label>Meal</label>
        <select aria-label="Meal" className="text-in" value={meal} onChange={(e) => setMeal(e.target.value as MealSlot)}>
          {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
        </select>
      </div>
      <button className="big-btn" disabled={action.busy || !Number.isFinite(g) || g <= 0 || !name.trim()} onClick={() => void action.run(add)}>
        Log it →
      </button>
    </div>
  )
}

/** Tap-to-edit for a logged entry; the ×portion field re-scales every number at once. */
function EntryEditor({ entry, onSaved, onCancel }: { entry: FoodEntry; onSaved: () => void; onCancel: () => void }) {
  const { api } = useApp()
  const action = useAction()
  const notify = useFeedback()
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
  const ok = !!f.name.trim() && [f.calories, f.protein, f.carbs, f.fat].every((v) => !v.trim() || (Number.isFinite(Number(v)) && Number(v) >= 0)) && !!f.calories.trim() && (!f.scale.trim() || (isFinite(scale) && scale > 0))

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
    notify('Food updated')
    onSaved()
  }

  return (
    <div style={{ padding: '8px 0 4px' }}>
      <div className="field">
        <label>Food</label>
        <input aria-label="Food name" className="text-in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
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
              aria-label={c.label} value={f[c.key]} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="in-grid" style={{ marginTop: 8 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Meal</label>
          <select aria-label="Meal" className="text-in" value={f.meal} onChange={(e) => setF({ ...f, meal: e.target.value as MealSlot })}>
            {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Portion × (1.5 = half again)</label>
          <input className="text-in" inputMode="decimal" aria-label="Portion multiplier" value={f.scale}
            onChange={(e) => setF({ ...f, scale: e.target.value })} />
        </div>
      </div>
      {scaling && (
        <span className="small" style={{ display: 'block', marginTop: 6, color: 'var(--lime)' }}>
          ×{scale} → {times(f.calories)} kcal · {times(f.protein)}g protein
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={action.busy || !ok} onClick={() => void action.run(save)}>Save</button>
        <button className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

let foodDraft: { form: { name: string; calories: string; protein: string; carbs: string; fat: string; meal: MealSlot; save: boolean }; aiText: string; aiResult: AiFoodResult | null; aiReq: AiFoodRequest | null; aiAnswer: string; aiMeal: MealSlot; showAdd: boolean } | undefined

export function FoodScreen({ prefill }: { prefill?: FoodProduct }) {
  const { api, go, settings } = useApp()
  const action = useAction()
  const notify = useFeedback()
  const task = useAiTask()
  const aiBusy = task.busy
  const retryRef = useRef<() => void>(() => {})
  const composerRef = useRef<HTMLDivElement>(null)
  const today = toDayKey(new Date())
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [saved, setSaved] = useState<SavedMeal[]>([])
  const [recent, setRecent] = useState<FoodEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(foodDraft?.showAdd ?? false)
  const [form, setForm] = useState(foodDraft?.form ?? { name: '', calories: '', protein: '', carbs: '', fat: '', meal: currentSlot() as MealSlot, save: false })
  const ai = useAiAvailable(settings)
  const [aiText, setAiText] = useState(foodDraft?.aiText ?? '')
  const [aiResult, setAiResult] = useState<AiFoodResult | null>(foodDraft?.aiResult ?? null)
  const [aiReq, setAiReq] = useState<AiFoodRequest | null>(foodDraft?.aiReq ?? null)
  const [aiAnswer, setAiAnswer] = useState(foodDraft?.aiAnswer ?? '')
  const [aiMeal, setAiMeal] = useState<MealSlot>(foodDraft?.aiMeal ?? currentSlot())
  const [scanned, setScanned] = useState<FoodProduct | undefined>(prefill)
  const photoRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    foodDraft = { form, aiText, aiResult, aiReq, aiAnswer, aiMeal, showAdd }
  }, [form, aiText, aiResult, aiReq, aiAnswer, aiMeal, showAdd])
  useEffect(() => {
    if (showAdd || aiResult || scanned) composerRef.current?.scrollIntoView({ block: 'start' })
  }, [showAdd, !!aiResult, !!scanned])

  const refresh = useCallback(async () => {
    setEntries(await api.listFood(today))
    setStats(await api.getDayFoodStats(today))
  }, [api, today])

  useEffect(() => {
    const subscription = liveQuery(async () => ({
      entries: await api.listFood(today), stats: await api.getDayFoodStats(today),
      saved: await api.listSavedMeals(), recent: await api.listRecentFood(14),
    })).subscribe({ next: (data) => { setEntries(data.entries); setStats(data.stats); setSaved(data.saved); setRecent(data.recent) }, error: () => notify('Could not load meals. Please reload.', { error: true }) })
    return () => subscription.unsubscribe()
  }, [api, today, notify])

  const addSaved = async (m: SavedMeal) => {
    const entry = await api.addFood({
      date: today, meal: currentSlot(), name: m.name,
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
    })
    notify(`${m.name} logged`, { undo: () => api.deleteFood(entry.id) })
    refresh()
  }

  // recent distinct foods, minus saved-meal duplicates and drink-log entries
  const savedNames = new Set(saved.map((m) => m.name.trim().toLowerCase()))
  const grabbable = recent
    .filter((e) => !savedNames.has(e.name.trim().toLowerCase()) && !e.detail?.startsWith('from drink log'))
    .slice(0, 6)

  const grab = async (e: FoodEntry) => {
    const entry = await api.addFood({
      date: today, meal: currentSlot(), name: e.name, detail: e.detail,
      calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat,
      grams: e.grams, servings: e.servings,
    })
    notify(`${e.name} logged`, { undo: () => api.deleteFood(entry.id) })
    refresh()
  }

  const quickAdd = async () => {
    const calories = parseInt(form.calories, 10)
    const protein = parseInt(form.protein, 10) || 0
    const carbs = form.carbs.trim() ? parseInt(form.carbs, 10) || 0 : undefined
    const fat = form.fat.trim() ? parseInt(form.fat, 10) || 0 : undefined
    if (!manualValid) return
    const entry = await api.addFood({ date: today, meal: form.meal, name: form.name.trim(), calories, protein, carbs, fat })
    if (form.save) {
      await api.saveSavedMeal({ name: form.name.trim(), calories, protein, carbs, fat })
    }
    notify(`${form.name.trim()} logged`, { undo: () => api.deleteFood(entry.id) })
    setForm({ name: '', calories: '', protein: '', carbs: '', fat: '', meal: currentSlot(), save: false })
    setShowAdd(false)
    refresh()
  }

  const remove = async (id: string) => {
    const undo = await deleteFoodWithUndo(id)
    notify('Food removed', { undo })
  }

  const analyze = async () => {
    const config = aiConfig(settings)
    if (!config || !aiText.trim()) return
    const request: AiFoodRequest = { kind: 'text', text: aiText }
    retryRef.current = () => void analyze()
    await task.run('Estimating your food…', (options) => parseFood(config, request.text, undefined, options), (result) => {
      setAiResult(result); setAiReq(request); setAiAnswer('')
      setAiMeal(result.items.find((item) => item.meal)?.meal ?? currentSlot())
    })
  }

  const analyzePhoto = async (file: File) => {
    const config = aiConfig(settings)
    if (!config) return
    retryRef.current = () => void analyzePhoto(file)
    await task.run('Reading your food photo…', async (options) => {
      const photoDataUrl = await downscalePhoto(file)
      const result = await parseFoodPhoto(config, photoDataUrl, aiText, undefined, options)
      return { result, request: { kind: 'photo' as const, photoDataUrl, note: aiText } }
    }, ({ result, request }) => {
      setAiResult(result); setAiReq(request); setAiAnswer('')
      setAiMeal(result.items.find((item) => item.meal)?.meal ?? currentSlot())
    })
  }

  const answerQuestion = async (answer: string) => {
    const config = aiConfig(settings)
    if (!config || !aiResult || !aiReq || !answer.trim()) return
    retryRef.current = () => void answerQuestion(answer)
    // Include edits/removals/merges, so a correction never resurrects the old estimate.
    const followup = { priorRaw: JSON.stringify({ items: aiResult.items, question: aiResult.question }), answer: answer.trim() }
    await task.run('Updating with your feedback…', (options) => aiReq.kind === 'photo'
      ? parseFoodPhoto(config, aiReq.photoDataUrl, aiReq.note, followup, options)
      : parseFood(config, aiReq.text, followup, options), (result) => {
        setAiResult(result); setAiAnswer('')
        notify('Estimate updated — review the numbers')
      })
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
    task.clear()
  }

  const manualValid = !!form.name.trim() && !!form.calories.trim()
    && [form.calories, form.protein, form.carbs, form.fat].every((value) => !value.trim() || (Number.isFinite(Number(value)) && Number(value) >= 0))
  const aiValid = !!aiResult?.items.length && aiResult.items.every((item) => item.name.trim() && [item.calories, item.protein, item.carbs ?? 0, item.fat ?? 0].every((n) => Number.isFinite(n) && n >= 0))
  const addAllAi = async () => {
    if (!aiResult || !aiValid || aiBusy) return
    const rows = await addFoods(aiResult.items.map((item) => ({
      date: today, meal: aiMeal, name: item.name.trim(),
      calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat,
    })))
    notify(`${rows.length} food item${rows.length === 1 ? '' : 's'} logged`, { undo: async () => { for (const row of rows) await api.deleteFood(row.id) } })
    closeAi(); setAiText(''); setShowAdd(false)
    void refresh()
  }

  const kcalLeft = Math.max(0, settings.calorieTarget - stats.calories)
  const openComposer = (meal?: MealSlot) => {
    if (meal) setForm((f) => ({ ...f, meal }))
    setShowAdd(true)
    composerRef.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="page wide">
      <div className="row">
        <div>
          <span className="lab">
            {new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}
          </span>
          <h1 className="p-h1">Fuel<span className="dot">.</span></h1>
        </div>
      </div>

      <div className="card lg">
        <div className="fuel-summary">
          <div><div className="num">{stats.calories.toLocaleString()}</div><div className="lab">Eaten</div></div>
          <Ring value={stats.calories} target={settings.calorieTarget} size="big" label={`${stats.calories} of ${settings.calorieTarget} calories`}>
            {kcalLeft.toLocaleString()}<small>left</small>
          </Ring>
          <div><div className="num">{settings.calorieTarget.toLocaleString()}</div><div className="lab">Target</div></div>
        </div>
        <div className="macro-triad">
          <div>
            <div className="row"><span className="lab">Protein</span><span className="small">{stats.protein}/{settings.proteinTarget}</span></div>
            <div className="bar"><i className="alt" style={{ width: `${Math.min(100, (stats.protein / settings.proteinTarget) * 100)}%` }} /></div>
          </div>
          <div>
            <div className="row"><span className="lab">Carbs</span><span className="small">{stats.carbs} g</span></div>
            <div className="bar"><i className="carb" style={{ width: `${Math.min(100, (stats.carbs / Math.max(1, settings.calorieTarget / 8)) * 100)}%` }} /></div>
          </div>
          <div>
            <div className="row"><span className="lab">Fat</span><span className="small">{stats.fat} g</span></div>
            <div className="bar"><i className="fat" style={{ width: `${Math.min(100, (stats.fat / Math.max(1, settings.calorieTarget / 30)) * 100)}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="food-actions">
        <button className="big-btn" onClick={() => openComposer()}>＋ Log food</button>
        <button className="ghost-btn" onClick={() => go({ name: 'scan' })}>Scan barcode</button>
      </div>

      <div className="fd-grid">
        <div>
          {slots.map((slot) => {
            const list = entries.filter((e) => e.meal === slot)
            if (list.length === 0) return null
            const kcal = list.reduce((t, e) => t + e.calories, 0)
            return (
              <div key={slot} className="card">
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="t" style={{ fontSize: '0.95rem' }}>{slotLabel[slot]}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="small">{kcal} kcal</span>
                    <button className="plus-btn" aria-label={`Add to ${slotLabel[slot]}`} title={`Add to ${slotLabel[slot]}`} onClick={() => openComposer(slot)}>+</button>
                  </span>
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
                      <button className="meal-edit" aria-label={`Edit ${e.name}`} style={{ cursor: 'pointer', flex: 1, minWidth: 0 }} title="Tap to edit" onClick={() => setEditingId(e.id)}>
                        {e.name}
                        {e.detail && <span className="small" style={{ display: 'block' }}>{e.detail}</span>}
                        <span className="edit-affordance">Edit</span>
                      </button>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="small">
                          {e.calories} kcal · {e.protein}P
                          {e.carbs != null && ` · ${e.carbs}C`}
                          {e.fat != null && ` · ${e.fat}F`}
                        </span>
                        <button className="del" title="Delete" aria-label={`Delete ${e.name}`} disabled={action.busy} onClick={() => void action.run(() => remove(e.id))}>✕</button>
                      </span>
                    </div>
                  )
                ))}
              </div>
            )
          })}
          {entries.length === 0 && (
            <div className="card">
              <div className="row">
                <div>
                  <span className="t" style={{ fontSize: '0.95rem' }}>Nothing logged yet</span>
                  <span className="small" style={{ display: 'block' }}>Today's meals build here.</span>
                </div>
                <button className="plus-btn" aria-label="Log food" onClick={() => openComposer()}>+</button>
              </div>
            </div>
          )}
          <HydrationCard onFoodChanged={() => void refresh()} />
        </div>

        <div className="fd-side" ref={composerRef}>
          {scanned && (
            <BarcodeCard
              product={scanned}
              onDone={() => { setScanned(undefined); void refresh() }}
              onDismiss={() => setScanned(undefined)}
            />
          )}
          {aiResult ? (
            <div className="card">
              <div className="row">
                <span className="lab lm">✦ AI estimate — review</span>
                <span className="lab">{aiResult.items.reduce((t, i) => t + i.calories, 0)} kcal</span>
              </div>
              <p className="small">Not logged yet. Check the portions, edit any number, or tell AI what to change.</p>
              {aiReq?.kind === 'photo' && <img className="food-photo" src={aiReq.photoDataUrl} alt="Your food photo" />}
              <AiTaskStatus task={task} onRetry={() => retryRef.current()} />
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
                    <input className="text-in" style={{ flex: 1, minWidth: 0 }} value={item.name} aria-label={`Food ${i + 1} name`} disabled={aiBusy || action.busy}
                      onChange={(e) => patchAiItem(i, { name: e.target.value })} />
                    <button className="del" title="Remove" aria-label={`Remove ${item.name}`} disabled={aiBusy || action.busy} onClick={() => dropAiItem(i)}>✕</button>
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
                          value={item[f.key] ?? ''} aria-label={`Food ${i + 1} ${f.label}`} disabled={aiBusy || action.busy}
                          onChange={(e) => patchAiItem(i, { [f.key]: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {aiResult.items.length > 0 && (
                <span className="small" style={{ display: 'block', marginTop: 6 }}>Grams for protein, carbs and fat — estimates, tweak anything.</span>
              )}
              <div className="ai-feedback">
                <label className="lab" htmlFor="food-feedback">Correct or clarify</label>
                <textarea id="food-feedback" className="text-in" rows={2}
                  placeholder="e.g. I ate half, no sauce, or this is chicken"
                  value={aiAnswer} disabled={aiBusy || action.busy} onChange={(e) => setAiAnswer(e.target.value)} />
                <button className="ghost-btn" disabled={aiBusy || action.busy || !aiAnswer.trim()} onClick={() => void answerQuestion(aiAnswer)}>
                  Update estimate
                </button>
                <span className="small">Your note updates this estimate. Nothing is logged until you tap Add.</span>
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Meal</label>
                <select aria-label="Meal" className="text-in" value={aiMeal} onChange={(e) => setAiMeal(e.target.value as MealSlot)}>
                  {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
                </select>
              </div>
              <button className="big-btn" onClick={() => void action.run(addAllAi)} disabled={!aiValid || aiBusy || action.busy}>
                Add {aiResult.items.length} item{aiResult.items.length === 1 ? '' : 's'} →
              </button>
              <div style={{ height: 8 }} />
              <button className="ghost-btn" disabled={aiBusy || action.busy} onClick={closeAi}>Back</button>
            </div>
          ) : showAdd ? (
            <div className="card">
              <div className="field">
                <label style={ai.available ? { color: 'var(--lime)' } : undefined}>
                  ✦ Describe it or snap it
                </label>
                <textarea aria-label="Describe your food"
                  className="text-in" rows={3}
                  placeholder="2 eggs, toast with butter, café con leche"
                  value={aiText} disabled={aiBusy}
                  onChange={(e) => setAiText(e.target.value)}
                />
              </div>
              <AiConnection ai={ai} onSettings={() => go({ name: 'settings' })} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`ghost-btn${ai.available ? '' : ' soft-disabled'}`}
                  disabled={aiBusy || !ai.configured || !aiText.trim()}
                  onClick={() => void analyze()}
                >
                  {aiBusy ? 'Analyzing…' : 'Analyze with AI'}
                </button>
                <button
                  className={`ghost-btn${ai.available ? '' : ' soft-disabled'}`}
                  style={{ width: 'auto', padding: '0 16px' }} title="Photo of your food"
                  disabled={aiBusy || !ai.configured}
                  onClick={() => photoRef.current?.click()}
                >
                  Photo
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
              <AiTaskStatus task={task} onRetry={() => retryRef.current()} />
              <p className="section-label" style={{ marginTop: 24 }}>Or enter by hand</p>
              <div className="field">
                <label>Food</label>
                <input aria-label="Food name" className="text-in" value={form.name} placeholder="Chicken bowl"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="in-grid">
                <div className="field">
                  <label>Calories</label>
                  <input aria-label="Calories" className="text-in" inputMode="numeric" value={form.calories} placeholder="650"
                    onChange={(e) => setForm({ ...form, calories: e.target.value })} />
                </div>
                <div className="field">
                  <label>Protein (g)</label>
                  <input aria-label="Protein in grams" className="text-in" inputMode="numeric" value={form.protein} placeholder="40"
                    onChange={(e) => setForm({ ...form, protein: e.target.value })} />
                </div>
              </div>
              <div className="in-grid">
                <div className="field">
                  <label>Carbs (g) — optional</label>
                  <input aria-label="Carbs in grams" className="text-in" inputMode="numeric" value={form.carbs} placeholder="55"
                    onChange={(e) => setForm({ ...form, carbs: e.target.value })} />
                </div>
                <div className="field">
                  <label>Fat (g) — optional</label>
                  <input aria-label="Fat in grams" className="text-in" inputMode="numeric" value={form.fat} placeholder="20"
                    onChange={(e) => setForm({ ...form, fat: e.target.value })} />
                </div>
              </div>
              <span className="small" style={{ display: 'block', margin: '-4px 0 10px' }}>
                Skip carbs and fat if you don't know them — calories and protein are what matter for your goal.
              </span>
              <div className="field">
                <label>Meal</label>
                <select aria-label="Meal" className="text-in" value={form.meal}
                  onChange={(e) => setForm({ ...form, meal: e.target.value as MealSlot })}>
                  {slots.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
                </select>
              </div>
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.save}
                  onChange={(e) => setForm({ ...form, save: e.target.checked })} />
                Save as a reusable meal
              </label>
              <button className="big-btn" onClick={() => void action.run(quickAdd)} disabled={!manualValid || action.busy || aiBusy}>
                {action.busy ? 'Saving…' : 'Add →'}
              </button>
              <button className="text-button" disabled={aiBusy || action.busy} onClick={() => setShowAdd(false)}>Close — keep draft</button>
            </div>
          ) : (
            <button className="ghost-btn" onClick={() => openComposer()}>
              ＋ Quick add (name · kcal · macros)
            </button>
          )}
          {grabbable.length > 0 && (
            <>
              <p className="section-label">Grab again — recent, same portion</p>
              <div className="chips">
                {grabbable.map((e) => (
                  <button key={e.id} type="button" className="chip btn" disabled={action.busy} onClick={() => void action.run(() => grab(e))}>
                    {e.name} · {e.calories} kcal
                  </button>
                ))}
              </div>
            </>
          )}
          {saved.length > 0 && (
            <>
              <p className="section-label">Quick add — saved meals</p>
              <div className="chips">
                {saved.map((m) => (
                  <button key={m.id} type="button" className="chip green btn" disabled={action.busy} onClick={() => void action.run(() => addSaved(m))}>
                    {m.emoji ? `${m.emoji} ` : ''}{m.name}
                  </button>
                ))}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
