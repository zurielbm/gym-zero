/** Fragments stay out of HTTP requests and referrer headers. Keep the token in
 * memory while editing the form, then remove it on successful authentication. */
export function invitationFromUrl(href: string): string | null {
  return new URLSearchParams(new URL(href).hash.slice(1)).get('invite')
}

export function clearInvitationFromUrl() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  if (!hash.has('invite')) return
  hash.delete('invite')
  url.hash = hash.toString()
  window.history.replaceState(window.history.state, '', url)
}
