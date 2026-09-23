import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Notice = { message: string; undo?: () => Promise<void>; error?: boolean; id: number }
const FeedbackContext = createContext<(message: string, options?: Omit<Notice, 'message' | 'id'>) => void>(() => {})

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [undoing, setUndoing] = useState(false)
  const lock = useRef(false)
  const notify = useCallback((message: string, options?: Omit<Notice, 'message' | 'id'>) => {
    setNotice({ message, ...options, id: Date.now() })
  }, [])
  useEffect(() => {
    if (!notice || undoing || notice.error || notice.undo) return
    const timer = setTimeout(() => setNotice(null), 4500)
    return () => clearTimeout(timer)
  }, [notice, undoing])
  const undo = async () => {
    if (!notice?.undo || lock.current) return
    lock.current = true
    setUndoing(true)
    try { await notice.undo(); notify('Undone') }
    catch { notify('Could not undo. Please try again.', { undo: notice.undo, error: true }) }
    finally { lock.current = false; setUndoing(false) }
  }
  return <FeedbackContext.Provider value={notify}>
    <div className="app-frame">
    {children}
    {notice && <div className={`feedback-toast${notice.error ? ' error' : ''}`}>
      <span role={notice.error ? 'alert' : 'status'}>{notice.message}</span>
      {notice.undo && <button className="ghost-btn" disabled={undoing} onClick={() => void undo()}>{undoing ? 'Undoing…' : 'Undo'}</button>}
      <button className="icon-btn" aria-label="Dismiss notification" disabled={undoing} onClick={() => setNotice(null)}>×</button>
    </div>}
    </div>
  </FeedbackContext.Provider>
}
export const useFeedback = () => useContext(FeedbackContext)

/** A synchronous lock prevents double taps before React has rendered the busy state. */
export function useAction() {
  const notify = useFeedback()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await action() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save. Please try again.', { error: true }) }
    finally { lock.current = false; setBusy(false) }
  }
  return { busy, run }
}
