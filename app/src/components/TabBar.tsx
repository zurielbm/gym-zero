import { useApp } from '../AppContext'
import type { Screen } from '../AppContext'
import { BarbellIcon, ChartIcon, FoodIcon, HomeIcon, ScanIcon } from './icons'

const workoutScreens = new Set(['routines', 'workout', 'machine', 'summary'])

const tabs: Array<{ key: string; label: string; icon: () => React.ReactElement; to: Screen }> = [
  { key: 'home', label: 'Home', icon: HomeIcon, to: { name: 'home' } },
  { key: 'workout', label: 'Train', icon: BarbellIcon, to: { name: 'routines' } },
  { key: 'food', label: 'Fuel', icon: FoodIcon, to: { name: 'food' } },
  { key: 'history', label: 'Stats', icon: ChartIcon, to: { name: 'history' } },
]

function useNavState() {
  const { screen, go, activeWorkout } = useApp()
  const current = workoutScreens.has(screen.name) ? 'workout' : screen.name === 'body' ? 'history' : screen.name
  const navTo = (t: (typeof tabs)[number]) =>
    go(t.key === 'workout' && activeWorkout ? { name: 'workout' } : t.to)
  return { current, navTo, go, scanning: screen.name === 'scan' }
}

/** Bottom bar (mobile): 4 tabs with the scan key in the center slot. */
export function TabBar() {
  const { current, navTo, go, scanning } = useNavState()
  const [left, right] = [tabs.slice(0, 2), tabs.slice(2)]
  const tab = (t: (typeof tabs)[number]) => (
    <button key={t.key} className={`tab${current === t.key ? ' on' : ''}`} onClick={() => navTo(t)}>
      <t.icon />
      {t.label}
    </button>
  )
  return (
    <nav className="tabbar">
      {left.map(tab)}
      <button
        className={`scan-key${scanning ? ' on' : ''}`}
        title="Scan machine QR"
        onClick={() => go({ name: 'scan' })}
      >
        <ScanIcon />
      </button>
      {right.map(tab)}
    </nav>
  )
}

/** Top bar (desktop): brand, links, scan key. */
export function TopNav() {
  const { current, navTo, go, scanning } = useNavState()
  return (
    <nav className="topnav">
      <span className="brand">Gym<span className="lm">Zero</span></span>
      <div className="links">
        {tabs.map((t) => (
          <button key={t.key} className={current === t.key ? 'on' : ''} onClick={() => navTo(t)}>
            {t.label}
          </button>
        ))}
      </div>
      <button
        className={`scan-key${scanning ? ' on' : ''}`}
        title="Scan machine QR"
        onClick={() => go({ name: 'scan' })}
      >
        <ScanIcon />
      </button>
    </nav>
  )
}
