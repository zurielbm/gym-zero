/** Canonical form used to compare QR destinations. */
export function normalizeQrUrl(raw: string): string {
  try {
    const url = new URL(raw.trim())
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return `yt:${url.pathname.slice(1)}`
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : null
      if (videoId) return `yt:${videoId}`
      const short = url.pathname.match(/^\/(shorts|embed|v)\/([\w-]+)/)
      if (short) return `yt:${short[2]}`
    }
    return `${host}${url.pathname}${url.search}`
  } catch {
    return raw.trim()
  }
}
