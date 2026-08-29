import { useApp } from '../AppContext'
import type { Screen } from '../AppContext'
import { BarbellIcon, ChartIcon, FoodIcon, HomeIcon } from './icons'

const workoutScreens = new Set(['routines', 'workout', 'scan', 'machine', 'summary'])

const tabs: Array<{ key: string; label: string; icon: () => React.ReactElement; to: Screen }> = [
  { key: 'home', label: 'Home', icon: HomeIcon, to: { name: 'home' } },
  { key: 'workout', label: 'Workout', icon: BarbellIcon, to: { name: 'routines' } },
  { key: 'food', label: 'Food', icon: FoodIcon, to: { name: 'food' } },
  { key: 'history', label: 'History', icon: ChartIcon, to: { name: 'history' } },
]

export function TabBar() {
  const { screen, go, activeWorkout } = useApp()
  const current = workoutScreens.has(screen.name) ? 'workout' : screen.name
  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab${current === t.key ? ' on' : ''}`}
          onClick={() => go(t.key === 'workout' && activeWorkout ? { name: 'workout' } : t.to)}
        >
          <t.icon />
          {t.label}
        </button>
      ))}
    </nav>
  )
}
