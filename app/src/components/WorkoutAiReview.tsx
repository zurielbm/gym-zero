import { useId, useState } from 'react'
import { useApp } from '../AppContext'
import { aiConfig, useAiAvailable } from '../lib/ai'
import { evaluateWorkout, type WorkoutReview } from '../lib/workout-review'
import { useAiTask } from '../hooks/useAiTask'
import { AiConnection, AiTaskStatus } from './AiStatus'
import type { ActivityLog, WorkoutSet, WorkoutSummary } from '../types'
import './workout-ai-review.css'

interface Props {
  summary: WorkoutSummary
  sets: WorkoutSet[]
  activities: ActivityLog[]
  /** e.g. while a logged set is being corrected */
  disabled?: boolean
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Click-only AI review of a saved workout. The inner card is keyed on the AI
 * config and training profile so edits there drop any in-flight request and
 * any answer produced from the old inputs. The key is never rendered.
 */
export function WorkoutAiReview(props: Props) {
  const { settings } = useApp()
  const inputsKey = JSON.stringify({
    ai: aiConfig(settings),
    goal: settings.goal, experience: settings.experience, limitations: settings.limitations,
    daysPerWeek: settings.daysPerWeek, sessionMinutes: settings.sessionMinutes,
  })
  return <ReviewCard key={inputsKey} {...props} />
}

function ReviewCard({ summary, sets, activities, disabled = false }: Props) {
  const { api, exercises, settings, go } = useApp()
  const ai = useAiAvailable(settings)
  const task = useAiTask()
  const ids = useId()
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<{ review: WorkoutReview; question: string } | null>(null)

  const empty = sets.length === 0 && activities.length === 0
  const config = aiConfig(settings)
  const canAsk = !!config && ai.configured && !empty && !disabled && !task.busy

  const ask = () => {
    if (!config || empty || disabled) return
    const asked = question.trim()
    void task.run('Reviewing your workout…', (options) => evaluateWorkout(config, {
      api, summary, sets, activities, exercises, settings, question: asked || undefined,
    }, options), (review) => setResult({ review, question: asked }))
  }

  // An answer is "previous" once the question changed or a newer request is running or failed.
  const previous = !!result && (result.question !== question.trim() || task.busy || !!task.error)
  const review = result?.review

  return (
    <section className="card wo-ai" aria-labelledby={`${ids}-title`} aria-busy={task.busy}>
      <h2 className="lab lm" id={`${ids}-title`}>✦ AI coach review</h2>
      <p className="small wo-ai-context">
        Sends this workout, up to 12 earlier completed workouts from the 8 weeks before it, your current routine, and your saved goal, experience and limitations to your AI.
      </p>

      <AiConnection ai={ai} onSettings={() => go({ name: 'settings' })} />

      <label className="lab wo-ai-label" htmlFor={`${ids}-question`}>Ask about your workout</label>
      <textarea
        id={`${ids}-question`} className="text-in wo-ai-question" rows={2} maxLength={1000}
        placeholder="Optional — e.g. How can I make my routine better for building muscle?"
        value={question} disabled={task.busy}
        onChange={(e) => { setQuestion(e.target.value); task.clear() }}
      />

      <button type="button" className="big-btn wo-ai-ask" disabled={!canAsk} onClick={ask}>Ask AI about this workout</button>
      {empty && <p className="small" role="status">Log at least one set or activity to get a review.</p>}
      {!empty && disabled && <p className="small" role="status">Finish editing the set first — the review uses your corrected numbers.</p>}

      <AiTaskStatus task={task} onRetry={canAsk ? ask : undefined} />

      {review && <div className={`wo-ai-result${previous ? ' previous' : ''}`}>
        <p className="wo-ai-meta">
          {previous && <b>Previous answer · </b>}
          {review.historyCount > 0
            ? `Compared with ${plural(review.historyCount, 'earlier workout')}`
            : 'No earlier workouts to compare with'}
          {result?.question && <><br /><span>You asked: {result.question}</span></>}
        </p>

        <h3 className="wo-ai-h">How it went</h3>
        <p>{review.assessment}</p>

        {review.progress && <>
          <h3 className="wo-ai-h">Progress</h3>
          <p>{review.progress}</p>
        </>}

        {review.strengths.length > 0 && <>
          <h3 className="wo-ai-h">What went well</h3>
          <ul>{review.strengths.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </>}

        {review.improvements.length > 0 && <>
          <h3 className="wo-ai-h">What to improve</h3>
          <ul>{review.improvements.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </>}

        {review.routine.recommendation && <>
          <h3 className="wo-ai-h">Routine suggestion</h3>
          <p>{review.routine.recommendation}</p>
          {review.routine.reason && <p className="small">Why: {review.routine.reason}</p>}
          {review.routine.days.length > 0 && <ol className="wo-ai-days">
            {review.routine.days.map((day, i) => <li key={i}>
              <b>{day.name}</b>
              {day.exercises.length > 0 && <span className="small">{day.exercises.join(' · ')}</span>}
            </li>)}
          </ol>}
          <p className="small">Suggestion only — your routines stay as they are.</p>
        </>}

        {review.limitations.length > 0 && <>
          <h3 className="wo-ai-h">Keep in mind</h3>
          <ul className="small">{review.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </>}
      </div>}
    </section>
  )
}
