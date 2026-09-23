import { useId } from 'react'
import type { Exercise } from '../types'
import { exerciseMuscles, muscleLabels, type MuscleRegion } from '../lib/exercise-muscles'

type Shape = { region: MuscleRegion; d: string; mirrored?: boolean }
// Original schematic anatomy, drawn in SVG so highlighted regions stay crisp on phones.
const front: Shape[] = [
  { region: 'frontDelts', d: 'M49 58 Q42 58 38 67 L35 82 Q43 82 48 75 L54 62Z', mirrored: true },
  { region: 'sideDelts', d: 'M39 63 Q32 65 29 80 L29 90 L34 88 L37 74Z', mirrored: true },
  { region: 'chest', d: 'M55 62 Q65 60 78 66 L78 88 Q66 98 49 87 L49 77Z', mirrored: true },
  { region: 'biceps', d: 'M35 88 Q44 82 44 94 L38 119 Q35 128 29 122 L29 105Z', mirrored: true },
  { region: 'triceps', d: 'M28 90 L26 108 L24 121 L28 123 L30 104 L32 89Z', mirrored: true },
  { region: 'forearms', d: 'M27 130 Q33 128 36 133 L25 164 L20 168 L20 157Z', mirrored: true },
  { region: 'abs', d: 'M64 98 L77 98 L77 110 L64 109Z M64 114 L77 115 L77 127 L65 126Z M65 131 L77 132 L77 145 L68 143Z M83 98 L96 98 L96 109 L83 110Z M83 115 L96 114 L95 126 L83 127Z M83 132 L95 131 L92 143 L83 145Z' },
  { region: 'obliques', d: 'M50 96 L59 101 L61 130 L67 148 L56 142 L53 122Z', mirrored: true },
  { region: 'hipAbductors', d: 'M54 149 L64 157 L57 184 L49 187 L49 171Z', mirrored: true },
  { region: 'adductors', d: 'M67 163 L77 169 L73 210 L67 224 L65 195Z', mirrored: true },
  { region: 'quads', d: 'M55 184 L62 177 L64 203 L67 226 L62 241 Q52 242 49 230 L48 208Z', mirrored: true },
]
const back: Shape[] = [
  { region: 'upperBack', d: 'M71 51 L78 55 L78 110 L65 99 L51 76 L56 63Z', mirrored: true },
  { region: 'rearDelts', d: 'M49 61 L52 74 Q44 85 35 83 L35 74 Q39 62 49 61Z', mirrored: true },
  { region: 'sideDelts', d: 'M36 64 L32 72 L28 90 L33 88 L37 77Z', mirrored: true },
  { region: 'triceps', d: 'M34 89 Q42 84 44 95 L39 116 Q35 129 28 123 L29 107Z', mirrored: true },
  { region: 'forearms', d: 'M27 130 Q33 128 36 133 L25 164 L20 168 L20 157Z', mirrored: true },
  { region: 'lats', d: 'M48 91 L62 101 L73 116 L65 144 L57 137 L53 116Z', mirrored: true },
  { region: 'lowerBack', d: 'M76 112 L78 119 L78 157 L67 150 L70 133Z', mirrored: true },
  { region: 'glutes', d: 'M61 154 Q69 151 78 161 L78 182 Q72 199 53 190 L51 180 Q50 165 61 154Z', mirrored: true },
  { region: 'hipAbductors', d: 'M52 150 L59 154 L53 164 L50 178 L47 181 L48 164Z', mirrored: true },
  { region: 'hamstrings', d: 'M52 197 L61 201 L75 193 L72 219 L66 242 L54 239 L50 218Z', mirrored: true },
  { region: 'adductors', d: 'M77 192 L79 199 L74 231 L71 240 L71 223Z', mirrored: true },
  { region: 'calves', d: 'M53 253 Q58 247 62 254 Q66 247 69 255 L68 277 L62 293 L55 286 L51 270Z', mirrored: true },
]
const outline = 'M68 44 L68 51 L50 57 Q35 57 29 72 L22 109 L20 127 L13 164 L10 179 Q10 186 15 185 L19 175 L21 182 L25 176 L27 160 L40 131 L44 110 L48 95 L52 122 L54 141 L48 159 Q43 180 45 199 L48 235 L47 249 L48 271 L53 302 L49 313 Q44 320 51 321 L65 320 L69 309 L69 279 L72 258 L70 243 L77 211 L80 190 L83 211 L90 243 L88 258 L91 279 L91 309 L95 320 L109 321 Q116 320 111 313 L107 302 L112 271 L113 249 L112 235 L115 199 Q117 180 112 159 L106 141 L108 122 L112 95 L116 110 L120 131 L133 160 L135 176 L139 182 L141 175 L145 185 Q150 186 150 179 L147 164 L140 127 L138 109 L131 72 Q125 57 110 57 L92 51 L92 44Z'

export type MuscleLevel = 'primary' | 'secondary' | 'inactive'
export type BodyView = 'front' | 'back'
/** Regions drawn in each view; a mirrored shape is one region, not two. */
export const viewRegions: Record<BodyView, MuscleRegion[]> = { front: front.map(shape => shape.region), back: back.map(shape => shape.region) }

/** Front and back schematic figures, coloured by a caller-supplied level per region. */
export function BodyFigures({ level, describe, className = 'muscle-figures' }: { level: (region: MuscleRegion) => MuscleLevel; describe: (view: BodyView) => string; className?: string }) {
  const id = useId()
  return <div className={className}>
    {(['front', 'back'] as const).map(view => <figure key={view}>
      <svg viewBox="0 0 160 330" role="img" aria-labelledby={`${id}-${view}`}>
        <title id={`${id}-${view}`}>{describe(view)}</title>
        <ellipse className="anatomy-outline" cx="80" cy="26" rx="15" ry="20" />
        <path className="anatomy-outline" d={outline} />
        {(view === 'front' ? front : back).map(shape => <g key={shape.region} className={`muscle-region ${level(shape.region)}`} data-region={shape.region} data-level={level(shape.region)}>
          <path d={shape.d} />{shape.mirrored && <path d={shape.d} transform="translate(160 0) scale(-1 1)" />}
        </g>)}
        <path className="anatomy-detail" d={view === 'front' ? 'M80 66V151 M55 246L65 247 M95 247L105 246 M57 260L61 300 M103 260L99 300' : 'M80 57V183 M54 246L66 247 M94 247L106 246 M62 294L62 304 M98 294L98 304'} />
      </svg>
      <figcaption>{view === 'front' ? 'Front' : 'Back'}</figcaption>
    </figure>)}
  </div>
}

export function MuscleMap({ exercise }: { exercise: Exercise }) {
  const profile = exerciseMuscles(exercise)
  const names = (regions: MuscleRegion[]) => regions.map(region => muscleLabels[region]).join(' · ')
  const level = (region: MuscleRegion): MuscleLevel => profile.primary.includes(region) ? 'primary' : profile.secondary.includes(region) ? 'secondary' : 'inactive'
  return <section className="muscle-map" aria-label={`Muscles for ${exercise.name}`} data-exercise={exercise.id}>
    <div className="muscle-map-heading"><span className="lab lm">Muscles targeted</span><b>{exercise.name}</b></div>
    <BodyFigures level={level} describe={view => `${exercise.name}, ${view} view. ${profile.general ? 'Target groups' : 'Main muscles'}: ${names(profile.primary)}.${profile.secondary.length ? ` Assisting: ${names(profile.secondary)}.` : ''}`} />
    <dl className="muscle-legend">
      <div><dt><i className="primary" />{profile.general ? 'Target groups' : 'Main'}</dt><dd>{names(profile.primary) || 'No muscle groups saved'}</dd></div>
      {profile.secondary.length > 0 && <div><dt><i className="secondary" />Assisting</dt><dd>{names(profile.secondary)}</dd></div>}
    </dl>
    <p className="muscle-movement">{profile.movement}</p>
    <p className="muscle-map-note">{profile.general ? 'General group map from your saved exercise.' : 'General muscle-group guide. Setup can change the emphasis.'}</p>
  </section>
}

export function MusclePreview({ exercise }: { exercise: Exercise }) {
  return <details className="muscle-preview">
    <summary>Muscles &amp; movement</summary>
    <MuscleMap exercise={exercise} />
  </details>
}
