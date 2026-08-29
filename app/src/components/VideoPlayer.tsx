import { useState } from 'react'
import { youTubeId, youTubeThumb } from '../lib/youtube'

/** Instruction video: thumbnail that swaps to an embedded player on tap. */
export function VideoPlayer({ url }: { url: string | undefined }) {
  const [playing, setPlaying] = useState(false)
  const vid = youTubeId(url)

  if (!url) return null

  if (!vid) {
    return (
      <a className="video-thumb" href={url} target="_blank" rel="noopener noreferrer">
        <div className="placeholder">▶ Open instruction link</div>
      </a>
    )
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {playing ? (
        <div className="video-thumb" style={{ margin: 0 }}>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&playsinline=1&rel=0`}
            title="Instruction video"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', aspectRatio: '16 / 9', border: 0, display: 'block' }}
          />
        </div>
      ) : (
        <div className="video-thumb" style={{ margin: 0, cursor: 'pointer' }} onClick={() => setPlaying(true)}>
          <img src={youTubeThumb(vid)} alt="Instruction video" />
          <div className="play-badge" />
          <div className="video-meta">▶ Official instruction video</div>
        </div>
      )}
      <a
        className="small" style={{ display: 'inline-block', marginTop: 6, textDecoration: 'none' }}
        href={`https://www.youtube.com/watch?v=${vid}`} target="_blank" rel="noopener noreferrer"
      >
        Open in YouTube ↗
      </a>
    </div>
  )
}
