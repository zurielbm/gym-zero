import { BodyFigures, viewRegions, type BodyView } from './MuscleMap'
import type { RegionHit, WorkoutOverview } from '../lib/workout-overview'

const exerciseCount = (count: number) => `${count} exercise${count === 1 ? '' : 's'}`

function RegionList({ hits, level, title }: { hits: RegionHit[]; level: 'primary' | 'secondary'; title: string }) {
  if (!hits.length) return null
  return <div className="wo-regions">
    <h3 className="wo-regions-title"><i className={level} aria-hidden="true" />{title}</h3>
    <ul>
      {hits.map(hit => <li key={hit.region} data-overview-region={hit.region}>
        <b>{hit.label}</b>
        <span className="wo-region-count">{exerciseCount(hit.exercises.length)}</span>
        <span className="wo-region-names">{hit.exercises.join(' · ')}{hit.alsoAssisting.length > 0 && <><br />Also assisted in {hit.alsoAssisting.join(' · ')}</>}</span>
      </li>)}
    </ul>
  </div>
}

/** Session-wide map: union of the regions involved in exercises actually logged, main over assisting. */
export function WorkoutMuscleMap({ overview }: { overview: WorkoutOverview }) {
  const { main, assisting, levels, unmapped, exercises } = overview
  const mapped = main.length + assisting.length > 0
  const describe = (view: BodyView) => {
    const visible = (hits: RegionHit[]) => hits.filter(hit => viewRegions[view].includes(hit.region)).map(hit => hit.label).join(', ')
    const mainText = visible(main)
    const assistText = visible(assisting)
    return `Workout muscle map, ${view} view. ${mainText ? `Main: ${mainText}.` : 'No main groups on this side.'}${assistText ? ` Assisting: ${assistText}.` : ''}`
  }
  const usesSavedGroups = exercises.some(exercise => exercise.source === 'saved-groups' || exercise.source === 'saved-roles')
  return <section className="card lg wo-muscles" aria-labelledby="wo-muscles-title">
    <span className="lab lm">Muscle groups</span>
    <h2 className="wo-card-title" id="wo-muscles-title">{mapped ? `${main.length} main group${main.length === 1 ? '' : 's'}${assisting.length ? ` · ${assisting.length} assisting` : ''}` : 'No muscle data to map'}</h2>
    {mapped && <>
      <BodyFigures className="muscle-figures wo-figures" level={region => levels[region] ?? 'inactive'} describe={describe} />
      <div className="wo-region-lists">
        <RegionList hits={main} level="primary" title="Main" />
        <RegionList hits={assisting} level="secondary" title="Assisting" />
      </div>
    </>}
    {unmapped.length > 0 && <p className="wo-unmapped">
      Not on the map: {unmapped.map(exercise => exercise.name ? `${exercise.name} (no muscle groups saved)` : 'an exercise no longer in your library').join(', ')}.
    </p>}
    <p className="muscle-map-note">
      Estimated from how each logged exercise usually works — not effort, intensity or recovery.
      {usesSavedGroups ? ' Exercises without a built-in guide use their saved groups.' : ''}
    </p>
  </section>
}
