import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { useApp } from '../AppContext'
import type { QrResolution } from '../types'

interface Found { url: string; res: QrResolution }

/** Camera QR scanner with BarcodeDetector, jsQR fallback, and manual URL entry. */
export function ScanScreen() {
  const { api, go, activeWorkout } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [manual, setManual] = useState('')
  const foundRef = useRef<Found | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement('canvas')

    const handleUrl = async (url: string) => {
      if (foundRef.current?.url === url) return
      const res = await api.resolveQr(url)
      const f = { url, res }
      foundRef.current = f
      setFound(f)
    }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (stopped || !videoRef.current) { stream?.getTracks().forEach((t) => t.stop()); return }
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraOn(true)

        const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
        const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
        let lastScan = 0

        const loop = async () => {
          if (stopped) return
          const video = videoRef.current
          const now = Date.now()
          if (video && video.readyState >= 2 && now - lastScan > 350) {
            lastScan = now
            try {
              if (detector) {
                const codes = await detector.detect(video)
                if (codes[0]?.rawValue) await handleUrl(codes[0].rawValue)
              } else {
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                const g = canvas.getContext('2d', { willReadFrequently: true })!
                g.drawImage(video, 0, 0)
                const img = g.getImageData(0, 0, canvas.width, canvas.height)
                const code = jsQR(img.data, img.width, img.height)
                if (code?.data) await handleUrl(code.data)
              }
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
  }, [api])

  const open = (f: Found) => {
    if (f.res.machine) go({ name: 'machine', machineId: f.res.machine.id })
    else go({ name: 'machine', modelId: f.res.model?.id, qrUrl: f.url })
  }

  const resolveManual = async () => {
    const url = manual.trim()
    if (!url) return
    open({ url, res: await api.resolveQr(url) })
  }

  return (
    <>
      <button
        className="back-link"
        onClick={() => go(activeWorkout ? { name: 'workout' } : { name: 'routines' })}
      >
        ‹ Back
      </button>
      <h1 className="p-h1" style={{ fontSize: '1.25rem' }}>Scan machine</h1>
      <p className="p-sub">Point at the QR sticker on the machine</p>

      <div className="viewfinder">
        <video ref={videoRef} muted playsInline style={{ display: cameraOn ? 'block' : 'none' }} />
        <div className="corner tl" /><div className="corner tr" />
        <div className="corner bl" /><div className="corner br" />
        <div className="scanline" />
        {found && (
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
            <span style={{ color: 'var(--accent)', fontWeight: 900 }}>›</span>
          </div>
        )}
      </div>

      {!cameraOn && (
        <p className="small" style={{ marginTop: 0 }}>
          Camera unavailable — paste the machine's QR link instead.
        </p>
      )}
      <div className="field">
        <label>Or enter the QR link manually</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="text-in" placeholder="https://www.youtube.com/watch?v=…"
            value={manual} onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resolveManual()}
          />
          <button className="ghost-btn" style={{ width: 'auto', padding: '0 16px' }} onClick={resolveManual}>
            Go
          </button>
        </div>
      </div>

      <p className="small">
        Known code → opens the machine instantly.<br />
        Unknown code → you name &amp; map it once, remembered forever.
      </p>
    </>
  )
}
