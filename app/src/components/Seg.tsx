/** Segmented one-tap picker used by the training profile and quick setup. */
export function Seg<T extends string | number>({ options, value, onPick }: {
  options: Array<{ v: T; label: string }>
  value: T | undefined
  onPick: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  )
}
