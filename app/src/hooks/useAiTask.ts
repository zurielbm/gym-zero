import { useEffect, useRef, useState } from 'react'
import type { AiRequestOptions } from '../lib/ai'

/** One cancellable request, with explicit retry and elapsed-time feedback. */
export function useAiTask() {
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => () => { controller.current?.abort() }, [])
  useEffect(() => {
    if (!busy) return
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  const cancel = () => {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setMessage('Stopped. Your draft is still here.')
  }
  const run = async <T,>(description: string, task: (options: AiRequestOptions) => Promise<T>, accept: (value: T) => void | Promise<void>) => {
    if (controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setElapsed(0); setLabel(description); setError(null); setMessage('')
    try {
      const result = await task({ signal: current.signal, onRetry: () => setLabel('Connection interrupted. Trying once more…') })
      if (!current.signal.aborted) await accept(result)
    } catch (err) {
      if (!current.signal.aborted) setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      if (controller.current === current) { controller.current = null; setBusy(false) }
    }
  }
  return { busy, label, elapsed, error, message, run, cancel, clear: () => { setError(null); setMessage('') } }
}
