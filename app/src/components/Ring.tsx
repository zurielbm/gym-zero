interface RingProps {
  value: number
  target: number
  color: string
  label: string
  unit: string
}

/** Circular progress with the value in the middle (home screen macros). */
export function Ring({ value, target, color, label, unit }: RingProps) {
  const r = 36
  const c = 2 * Math.PI * r
  const frac = target > 0 ? Math.min(value / target, 1) : 0
  return (
    <div className="ring-card">
      <div className="ring">
        <svg width="88" height="88">
          <circle cx="44" cy="44" r={r} stroke="#232e3c" strokeWidth="8" fill="none" />
          <circle
            cx="44" cy="44" r={r} stroke={color} strokeWidth="8" fill="none"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          />
        </svg>
        <div className="val">
          {value.toLocaleString()}
          <span>/ {target.toLocaleString()} {unit}</span>
        </div>
      </div>
      <span className="small">{label}</span>
    </div>
  )
}
