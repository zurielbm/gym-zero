import { db } from './db'
import { ensureSeeded } from './seed'
import type { DrinkEntry, FoodEntry } from '../types'

/** Related food/drink writes commit together, including undo. */
export async function addFoods(entries: Array<Omit<FoodEntry, 'id'>>) {
  await ensureSeeded()
  const rows = entries.map((entry) => ({ ...entry, id: crypto.randomUUID() }))
  await db.food.bulkAdd(rows)
  return rows
}
export async function deleteFoodWithUndo(id: string) {
  await ensureSeeded()
  const snapshot = await db.transaction('rw', db.food, db.drinks, async () => {
    const food = await db.food.get(id)
    const drinks = await db.drinks.filter((drink) => drink.foodEntryId === id).toArray()
    await db.food.delete(id)
    await db.drinks.bulkDelete(drinks.map((drink) => drink.id))
    return { food, drinks }
  })
  return async () => db.transaction('rw', db.food, db.drinks, async () => {
    if (snapshot.food) await db.food.put(snapshot.food)
    await db.drinks.bulkPut(snapshot.drinks)
  })
}
export async function deleteDrinkWithUndo(id: string) {
  await ensureSeeded()
  const snapshot = await db.transaction('rw', db.food, db.drinks, async () => {
    const drink = await db.drinks.get(id)
    const food = drink?.foodEntryId ? await db.food.get(drink.foodEntryId) : undefined
    await db.drinks.delete(id)
    if (food) await db.food.delete(food.id)
    return { food, drink }
  })
  return async () => db.transaction('rw', db.food, db.drinks, async () => {
    if (snapshot.food) await db.food.put(snapshot.food)
    if (snapshot.drink) await db.drinks.put(snapshot.drink)
  })
}
export async function addDrinkWithFood(entry: Omit<DrinkEntry, 'id' | 'foodEntryId'>, food?: Omit<FoodEntry, 'id'>) {
  await ensureSeeded()
  return db.transaction('rw', db.food, db.drinks, async () => {
    const foodEntryId = food ? crypto.randomUUID() : undefined
    if (food && foodEntryId) await db.food.add({ ...food, id: foodEntryId })
    const drink = { ...entry, id: crypto.randomUUID(), foodEntryId }
    await db.drinks.add(drink)
    return drink
  })
}
