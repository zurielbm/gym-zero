/** A quiet, rounded two-note chime. No downloads, looping, or system-volume changes. */
let audio: AudioContext | undefined
let lastPlayedAt = -Infinity

export function renderRestChime(context: BaseAudioContext, at = context.currentTime) {
  const voices: OscillatorNode[] = []
  for (const [frequency, offset, strength] of [[523.25, 0, 0.12], [659.25, 0.18, 0.085]]) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency!
    const start = at + offset!
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(strength!, start + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.25)
    gain.gain.linearRampToValueAtTime(0, start + 1.4)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 1.42)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    voices.push(oscillator)
  }
  return voices
}

/** Call on a tap/key press so mobile browsers can authorize audio before the timer ends. */
export async function primeRestChime(): Promise<boolean> {
  try {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Audio) return false
    if (!audio || audio.state === 'closed') audio = new Audio()
    if (audio.state !== 'running') await audio.resume()
    return audio.state === 'running'
  } catch { return false }
}

export function playRestChime(): boolean {
  if (!audio || audio.state !== 'running') return false
  // Rapid preview taps should never stack a loud cluster of notes.
  if (audio.currentTime - lastPlayedAt < 1.7) return true
  try {
    renderRestChime(audio)
    lastPlayedAt = audio.currentTime
    return true
  } catch { return false }
}
