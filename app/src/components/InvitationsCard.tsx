import { useCallback, useEffect, useRef, useState } from 'react'
import { createInvitation, invitationError, listInvitations, revokeInvitation, type Invitation } from '../lib/invitations'
import './invitations.css'

type Created = Awaited<ReturnType<typeof createInvitation>>
type Busy = { kind: 'create' } | { kind: 'revoke'; id: Invitation['id'] }

const SHOWN = 10
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const isActive = (i: Invitation, now: number) => i.revokedAt === undefined && i.expiresAt > now

/**
 * Settings card for inviting someone to their own private account. The raw
 * link comes back from the server exactly once, so it lives only in this
 * component's memory and is dropped when revoked or expired.
 */
export function InvitationsCard() {
  const [items, setItems] = useState<Invitation[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [created, setCreated] = useState<Created | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: Invitation['id']; msg: string } | null>(null)
  const [linkMsg, setLinkMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lock = useRef(false)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const urlRef = useRef<HTMLInputElement>(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Never throws: a failed refresh only sets listError, so a freshly created link is never lost.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setListLoading(true)
    try {
      const list = await listInvitations()
      if (!mounted.current || seq !== loadSeq.current) return
      setItems(list)
      setListError(null)
    } catch (e) {
      if (!mounted.current || seq !== loadSeq.current) return
      setListError(invitationError(e))
    } finally {
      if (mounted.current && seq === loadSeq.current) setListLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Flip statuses to "Expired" on time: wake at the next expiry (capped, so sleep drift self-corrects)
  // and whenever the tab comes back into view.
  useEffect(() => {
    const expiries = [...(items ?? []).filter(i => isActive(i, now)).map(i => i.expiresAt), ...(created ? [created.expiresAt] : [])]
      .filter(t => t > now)
    if (!expiries.length) return
    const delay = Math.min(Math.min(...expiries) - now + 500, 60 * 60 * 1000)
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(delay, 1000))
    return () => window.clearTimeout(timer)
  }, [items, created, now])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Drop the raw link from memory once it can no longer be used.
  const createdRow = created ? items?.find(i => i.id === created.id) : undefined
  const createdDead = !!created && (created.expiresAt <= now || createdRow?.revokedAt !== undefined)
  useEffect(() => {
    if (createdDead) { setCreated(null); setLinkMsg(null) }
  }, [createdDead])

  const create = async () => {
    if (lock.current) return
    lock.current = true
    setBusy({ kind: 'create' })
    setCreateError(null)
    setNotice(null)
    setLinkMsg(null)
    let ok = false
    try {
      const inv = await createInvitation()
      if (!mounted.current) return
      ok = true
      setCreated(inv)
      setItems(prev => !prev?.some(i => i.id === inv.id)
        ? [{ id: inv.id, createdAt: Date.now(), expiresAt: inv.expiresAt }, ...(prev ?? [])]
        : prev)
      setNotice('Invite link created.')
    } catch (e) {
      if (mounted.current) setCreateError(invitationError(e))
    } finally {
      lock.current = false
      if (mounted.current) setBusy(null)
    }
    if (ok) void load()
  }

  const revoke = async (id: Invitation['id']) => {
    if (lock.current) return
    if (!window.confirm('Revoke this invite link? It stops working right away. Accounts already created with it are not affected.')) return
    lock.current = true
    setBusy({ kind: 'revoke', id })
    setRowError(null)
    setNotice(null)
    let ok = false
    try {
      await revokeInvitation(id)
      if (!mounted.current) return
      ok = true
      const t = Date.now()
      setItems(prev => prev?.map(i => i.id === id && i.revokedAt === undefined ? { ...i, revokedAt: t } : i) ?? prev)
      setCreated(c => (c?.id === id ? null : c))
      setNotice('Invite link revoked.')
    } catch (e) {
      if (mounted.current) setRowError({ id, msg: invitationError(e) })
    } finally {
      lock.current = false
      if (mounted.current) setBusy(null)
    }
    if (ok) void load()
  }

  const selectLink = () => urlRef.current?.select()

  const copy = async () => {
    if (!created) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(created.url)
      if (mounted.current) setLinkMsg({ text: 'Copied to clipboard.' })
    } catch {
      if (!mounted.current) return
      selectLink()
      setLinkMsg({ text: 'Couldn’t copy automatically. The link is selected above — copy it by hand.', error: true })
    }
  }

  // Its own tap (not chained after create) so the browser still counts it as a user gesture.
  const share = async () => {
    if (!created || !canShare) return
    try {
      await navigator.share({ title: 'Join me on Gym Zero', text: 'Create your own private Gym Zero account:', url: created.url })
    } catch (e) {
      if (!mounted.current || (e instanceof DOMException && e.name === 'AbortError')) return
      selectLink()
      setLinkMsg({ text: 'Couldn’t open sharing. Copy the link instead.', error: true })
    }
  }

  const live = created && !createdDead ? created : null
  const shown = items ? [...items.filter(i => isActive(i, now)), ...items.filter(i => !isActive(i, now)).slice(0, SHOWN)] : []
  const creating = busy?.kind === 'create'

  return (
    <section className="card inv" aria-labelledby="inv-title">
      <h2 className="lab inv-title" id="inv-title">Invite someone</h2>
      <p className="small inv-copy">
        They get their own private account. Your training, food and settings stay yours, and theirs stay theirs.
      </p>
      <p className="small inv-copy">
        Anyone with the link can create an account until you revoke it or it expires after 7 days. One link can be used more than once.
      </p>

      <button type="button" className="big-btn inv-create" disabled={busy !== null} aria-busy={creating}
        onClick={() => void create()}>
        {creating ? 'Creating link…' : createError ? 'Try again' : live ? 'Create another link' : 'Create invite link'}
      </button>
      {createError && <p className="small inv-err" role="alert">{createError}</p>}

      {live && (
        <div className="inv-new">
          <label className="lab" htmlFor="inv-url">New invite link</label>
          <input id="inv-url" ref={urlRef} className="text-in inv-url" readOnly value={live.url}
            aria-describedby="inv-url-help" spellCheck={false} autoCapitalize="off" autoCorrect="off"
            onFocus={(e) => e.currentTarget.select()} />
          <p className="small" id="inv-url-help">
            Expires {when(live.expiresAt)}. This is the only time the full link is shown, so copy or share it now.
          </p>
          <div className="inv-actions">
            <button type="button" className="ghost-btn" onClick={() => void copy()}>Copy link</button>
            {canShare && <button type="button" className="ghost-btn" onClick={() => void share()}>Share…</button>}
          </div>
          {linkMsg && (
            <p className={`small${linkMsg.error ? ' inv-err' : ' lm'}`} role={linkMsg.error ? 'alert' : 'status'}>{linkMsg.text}</p>
          )}
        </div>
      )}

      <p className="inv-sr" role="status" aria-live="polite">{notice ?? ''}</p>

      <div className="inv-list">
        <div className="row">
          <h3 className="lab inv-title">Recent invitations</h3>
          {listLoading && items && <span className="small" aria-hidden="true">Refreshing…</span>}
        </div>

        {listError && (
          <div className="inv-list-err">
            <p className="small inv-err" role="alert">{items ? `Couldn’t refresh: ${listError}` : listError}</p>
            <button type="button" className="ghost-btn inv-small-btn" disabled={listLoading} onClick={() => void load()}>
              {listLoading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {!items && listLoading && <p className="small" role="status">Loading invitations…</p>}
        {items && items.length === 0 && <p className="small">No invitations yet.</p>}

        {shown.length > 0 && (
          <ul className="inv-rows">
            {shown.map(i => {
              const active = isActive(i, now)
              const status = i.revokedAt !== undefined ? `Revoked ${when(i.revokedAt)}`
                : active ? `Active · expires ${when(i.expiresAt)}`
                : `Expired ${when(i.expiresAt)}`
              const revoking = busy?.kind === 'revoke' && busy.id === i.id
              return (
                <li key={i.id} className="inv-row">
                  <div className="inv-row-text">
                    <span className="inv-row-date">
                      Created {when(i.createdAt)}{live?.id === i.id && <span className="lab lm inv-badge">New</span>}
                    </span>
                    <span className={`small${active ? ' lm' : ''}`}>{status}</span>
                    {rowError?.id === i.id && <span className="small inv-err" role="alert">{rowError.msg}</span>}
                  </div>
                  {active && (
                    <button type="button" className="ghost-btn danger inv-small-btn" disabled={busy !== null}
                      aria-busy={revoking} aria-label={`Revoke invite link created ${when(i.createdAt)}`}
                      onClick={() => void revoke(i.id)}>
                      {revoking ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {items && items.length > shown.length && (
          <p className="small">Showing all active links and the {SHOWN} most recent inactive invitations.</p>
        )}
      </div>
    </section>
  )
}
