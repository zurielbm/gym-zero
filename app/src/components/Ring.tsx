import type { ReactNode } from 'react'

const R = 42
const C = 2 * Math.PI * R

/** Goal ring: value / target as an arc. Caption sits under the ring, label inside it. */
export function Ring({ value, target, color = 'var(--lime)', size, children, label }: {
  value: number
  target: number
  color?: string
  size?: 'sm' | 'big'
  /** content inside the ring; defaults to the value */
  children?: ReactNode
  /** accessible description */
  label?: string
}) {
  const pct = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0
  return (
    <div className={`ring${size ? ` ${size}` : ''}`} role="img" aria-label={label ?? `${value} of ${target}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="track" cx="50" cy="50" r={R} />
        <circle className="fill" cx="50" cy="50" r={R} stroke={color} strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="val">{children ?? value.toLocaleString()}</div>
    </div>
  )
}
