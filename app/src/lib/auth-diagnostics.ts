type Operation = 'sign-in' | 'sign-up' | 'sign-out' | 'session-token'
type Reason = 'unauthorized' | 'server-error' | 'request-rejected' | 'missing-data' | 'network-error' | 'unexpected-error'
interface AuthResult {
  data?: unknown
  error?: { status?: number } | null
}

/** Logs only explicit, non-personal fields. Never pass request/response bodies,
 * headers, error messages, or Error objects to the console. Logging failures
 * must not change whether an auth operation succeeds or fails.
 */
function record(operation: Operation, startedAt: number, reason?: Reason, status?: number) {
  try {
    const details = {
      operation,
      outcome: reason ? 'failure' : 'success',
      ...(reason ? { reason } : {}),
      ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
      online: typeof navigator === 'undefined' ? null : navigator.onLine,
      at: new Date().toISOString(),
    }
    if (reason) console.warn('[gym:auth]', details)
    else if (operation === 'session-token') console.debug('[gym:auth]', details)
    else console.info('[gym:auth]', details)
  } catch {
    // Diagnostics are best effort, including when browser console is replaced.
  }
}

/** Observe an existing call without retrying, refreshing, or altering its result. */
export async function observeAuthRequest<T extends AuthResult>(operation: Operation, request: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  let result: T
  try {
    result = await request()
  } catch (error) {
    record(operation, startedAt, error instanceof TypeError ? 'network-error' : 'unexpected-error')
    throw error
  }
  if (result.error) {
    const status = result.error.status
    record(operation, startedAt, status === 401 ? 'unauthorized'
      : typeof status === 'number' && status >= 500 ? 'server-error' : 'request-rejected', status)
  } else if (operation !== 'sign-out' && (!result.data ||
    (operation === 'session-token' && !(result.data as { token?: unknown }).token))) {
    record(operation, startedAt, 'missing-data')
  } else {
    record(operation, startedAt)
  }
  return result
}
