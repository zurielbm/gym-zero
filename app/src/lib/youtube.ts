/** Extract a YouTube video id from any common URL form, or null. */
export function youTubeId(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1) || null
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const m = u.pathname.match(/^\/(shorts|embed|v)\/([\w-]+)/)
      if (m) return m[2]
    }
    return null
  } catch {
    return null
  }
}

export const youTubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
