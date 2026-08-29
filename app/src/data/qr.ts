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
    // LA Fitness machine stickers: https://lfconnect.com/q?t=s&m=sspd
    // The m param is the Life Fitness machine code — that's the identity.
    if (host === 'lfconnect.com') {
      const machineCode = url.searchParams.get('m')
      if (machineCode) return `lf:${machineCode.toLowerCase()}`
    }
    // The sticker URL redirects to
    // https://trainer.lifefitness.com/qrredirect?referer-link=<base64 lfconnect url>&url-video=<yt id>
    // Decode referer-link so both forms collapse to the same lf:<code> key.
    if (host === 'trainer.lifefitness.com' && url.pathname.startsWith('/qrredirect')) {
      const original = decodeBase64Url(url.searchParams.get('referer-link'))
      if (original) {
        const key = normalizeQrUrl(original)
        if (key.startsWith('lf:')) return key
      }
      const video = url.searchParams.get('url-video')
      if (video) return `yt:${video}`
    }
    return `${host}${url.pathname}${url.search}`
  } catch {
    return raw.trim()
  }
}

function decodeBase64Url(value: string | null): string | null {
  if (!value) return null
  try {
    // '+' in standard base64 arrives as a space after query-string decoding
    return atob(value.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
}
