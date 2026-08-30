import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { createScanDetector } from '../lib/barcode'
import { isFoodBarcode, lookupBarcode } from '../lib/food-sources'
import type { FoodProduct, QrResolution } from '../types'

type Found =
  | { kind: 'machine'; url: string; res: QrResolution }
  | { kind: 'food'; code: string; state: 'loading' | 'done' | 'error'; product?: FoodProduct | null; error?: string }

const sameTarget = (a: Found | null, value: string) =>
  a?.kind === 'machine' ? a.url === value : a?.kind === 'food' ? a.code === value : false

/** Camera scanner for machine QR codes and food barcodes, with manual entry. */
export function ScanScreen() {
  const { api, go, activeWorkout, settings } = useApp()
  const foodDbEndpoint = settings.foodDbEndpoint
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [manual, setManual] = useState('')
  const foundRef = useRef<Found | null>(null)

  const show = (f: Found) => {
    foundRef.current = f
    setFound(f)
  }

  const handleCode = useCallback(async (raw: string) => {
    const value = raw.trim()
    if (!value || sameTarget(foundRef.current, value)) return
    if (isFoodBarcode(value)) {
      show({ kind: 'food', code: value, state: 'loading' })
      try {
        const product = await lookupBarcode(api, value, foodDbEndpoint)
        if (sameTarget(foundRef.current, value)) show({ kind: 'food', code: value, state: 'done', product })
      } catch (err) {
        if (sameTarget(foundRef.current, value)) {
          show({ kind: 'food', code: value, state: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      }
      return
    }
    const res = await api.resolveQr(value)
    show({ kind: 'machine', url: value, res })
  }, [api, foodDbEndpoint])

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (stopped || !videoRef.current) { stream?.getTracks().forEach((t) => t.stop()); return }
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraOn(true)

        const detector = createScanDetector()
        let lastScan = 0

        const loop = async () => {
          if (stopped) return
          const video = videoRef.current
          const now = Date.now()
          if (video && video.readyState >= 2 && now - lastScan > 350) {
            lastScan = now
            try {
              const codes = await detector.detect(video)
              if (codes[0]?.rawValue) await handleCode(codes[0].rawValue)
            } catch { /* keep scanning */ }
          }
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      } catch {
        setCameraOn(false) // no camera / denied: manual entry still works
      }
    }
    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [handleCode])

  const open = (f: Found) => {
    if (f.kind === 'food') {
      if (f.state === 'done' && f.product) go({ name: 'food', prefill: f.product })
      else if (f.state !== 'loading') go({ name: 'food' })
      return
    }
    if (f.res.machine) go({ name: 'machine', machineId: f.res.machine.id })
    else go({ name: 'machine', modelId: f.res.model?.id, qrUrl: f.url })
  }

  const resolveManual = async () => {
    const value = manual.trim()
    if (!value) return
    if (isFoodBarcode(value)) {
      // result shows in the viewfinder card, same as a camera scan;
      // clearing the dedup guard lets Go retry after a failed lookup
      foundRef.current = null
      await handleCode(value)
      return
    }
    open({ kind: 'machine', url: value, res: await api.resolveQr(value) })
  }

  const foodCard = (f: Found & { kind: 'food' }) => {
    const badge = f.state === 'loading' ? '…' : f.state === 'error' ? '!' : f.product ? '✓' : '?'
    const title = f.state === 'loading' ? 'Looking it up…'
      : f.state === 'error' ? f.error
      : f.product ? (f.product.brand ? `${f.product.name} — ${f.product.brand}` : f.product.name)
      : 'Not in the food database'
    const sub = f.state === 'done' && f.product
      ? `${f.product.per100g.calories} kcal per 100 g · tap to log it`
      : f.state === 'done' ? 'Tap to add it by hand instead'
      : `Barcode ${f.code}`
    return (
      <div className="qr-found" onClick={() => open(f)}>
        <div className="qr-badge">{badge}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: '0.85rem' }}>{title}</b>
          <span className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sub}
          </span>
        </div>
        {f.state !== 'loading' && <span style={{ color: 'var(--on-lime)', fontWeight: 900 }}>→</span>}
      </div>
    )
  }

  return (
    <div className="page">
      <button
        className="back-link"
        onClick={() => go(activeWorkout ? { name: 'workout' } : { name: 'routines' })}
      >
        ‹ Back
      </button>
      <h1 className="p-h1" style={{ fontSize: '1.6rem' }}>Scan<span className="dot">.</span></h1>
      <p className="p-sub" style={{ textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.1em', fontWeight: 700 }}>
        Point at a machine QR or a food barcode
      </p>

      <div className="viewfinder">
        <video ref={videoRef} muted playsInline style={{ display: cameraOn ? 'block' : 'none' }} />
        <div className="corner tl" /><div className="corner tr" />
        <div className="corner bl" /><div className="corner br" />
        <div className="scanline" />
        {found && (found.kind === 'food' ? foodCard(found) : (
          <div className="qr-found" onClick={() => open(found)}>
            <div className="qr-badge">✓</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: '0.85rem' }}>
                {found.res.machine?.nickname ??
                  (found.res.model
                    ? `${found.res.model.manufacturer} — ${found.res.model.modelName}`
                    : /lfconnect\.com|lifefitness\.com/.test(found.url)
                      ? 'Life Fitness machine'
                      : 'New machine')}
              </b>
              <span className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {found.url}
              </span>
            </div>
            <span style={{ color: 'var(--on-lime)', fontWeight: 900 }}>→</span>
          </div>
        ))}
      </div>

      {!cameraOn && (
        <p className="small" style={{ marginTop: 0 }}>
          Camera unavailable — type the QR link or barcode digits instead.
        </p>
      )}
      <div className="field">
        <label>Or enter a QR link / barcode digits</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="text-in" placeholder="https://… or 0123456789012"
            value={manual} onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resolveManual()}
          />
          <button className="ghost-btn" style={{ width: 'auto', padding: '0 16px' }} onClick={resolveManual}>
            Go
          </button>
        </div>
      </div>

      <p className="small">
        Machine QR → opens the machine; new codes are named &amp; mapped once, remembered forever.<br />
        Food barcode → nutrition from Open Food Facts, ready to log.
      </p>
    </div>
  )
}
