import type { AiAvailability } from '../lib/ai'
import type { useAiTask } from '../hooks/useAiTask'

export function AiConnection({ ai, onSettings }: { ai: AiAvailability; onSettings: () => void }) {
  return <div className={`ai-connection ${ai.status}`}>
    <span role="status"><i className={ai.checking ? 'spinner' : 'status-dot'} />{ai.checking ? 'Checking AI connection…' : ai.available ? 'AI ready' : ai.configured ? 'AI connection unavailable' : 'AI is not set up'}</span>
    {!ai.available && !ai.checking && <div className="inline-actions">
      {ai.configured && <button className="text-button" onClick={ai.recheck}>Retry connection</button>}
      <button className="text-button" onClick={onSettings}>{ai.configured ? 'Settings' : 'Set up AI'}</button>
    </div>}
    {!ai.available && !ai.checking && <small>{ai.configured ? 'Check your connection or Tailscale. You can still enter everything by hand.' : 'Connect AI in Settings to estimate food and build programs.'}</small>}
  </div>
}

export function AiTaskStatus({ task, onRetry }: { task: ReturnType<typeof useAiTask>; onRetry?: () => void }) {
  return <>
    {task.busy && <div className="ai-progress" aria-busy="true">
      <div role="status"><i className="spinner" /><b>{task.label}</b></div>
      <p className="small">{task.elapsed}s elapsed · {task.elapsed >= 15 ? 'Still waiting for AI. You can stop and try again.' : 'You’ll review the result before using it.'}</p>
      <button className="ghost-btn" onClick={task.cancel}>Stop request</button>
    </div>}
    {task.error && <div className="inline-error"><p role="alert">{task.error}</p>{onRetry && <button className="ghost-btn" onClick={onRetry}>Try again</button>}</div>}
    {task.message && <p className="small" role="status">{task.message}</p>}
  </>
}
