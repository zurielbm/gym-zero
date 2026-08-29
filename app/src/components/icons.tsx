const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export const HomeIcon = () => (
  <svg {...base}><path d="M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10" /></svg>
)
export const BarbellIcon = () => (
  <svg {...base}><path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12" /></svg>
)
export const FoodIcon = () => (
  <svg {...base}><path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M17 3c-2 2-2 5-2 8h2v10" /></svg>
)
export const ChartIcon = () => (
  <svg {...base}><path d="M4 20V10M10 20V4M16 20v-8M21 20H3" /></svg>
)
export const ScanIcon = () => (
  <svg {...base} strokeWidth={2}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
  </svg>
)
