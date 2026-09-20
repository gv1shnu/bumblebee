import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CorpusStats, Segment, Source } from '../shared/types'
import { mulberry32, RadioEngine } from './audio'
import { matchText } from './matcher'

const frequencyFor = (id: string): number => {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return 88 + ((hash >>> 0) / 0xffffffff) * 20
}
const positionFor = (id: string): number => ((frequencyFor(id) - 88) / 20) * 100
const frequencyLabel = (source: Source): string => `${source.label} ${frequencyFor(source.id).toFixed(1)}`

type Phase = 'idle' | 'thinking' | 'playing'
type ClockState = { now: number; needle: number; level: number; flicker: boolean; active: number }

// Uneven per-bar weights so the mouth grille never moves as one clean block —
// it mirrors the deliberate unevenness of the spliced voice.
const MOUTH = [0.55, 0.85, 0.68, 1, 0.62, 0.82, 0.5]
function BumblebeeFace({ level, speaking }: { level: number; speaking: boolean }) {
  const drive = speaking ? level : level * 0.35
  const glow = 0.42 + Math.min(0.58, drive * 0.95)
  return (
    <svg className="bumble-face" viewBox="0 0 76 60" aria-hidden="true">
      <path className="antenna" d="M25 8 L21 0 M51 8 L55 0" />
      <path className="helmet" d="M14 20 Q14 8 27 7 L49 7 Q62 8 62 20 L62 39 Q62 51 49 52 L27 52 Q14 51 14 39 Z" />
      <g className="eyes" style={{ opacity: glow, filter: `drop-shadow(0 0 ${(glow * 3).toFixed(1)}px var(--vfd))` }}>
        <circle className="optic" cx="28" cy="25" r="7" />
        <circle className="optic" cx="48" cy="25" r="7" />
        <circle className="glint" cx="30.5" cy="22.5" r="1.9" />
        <circle className="glint" cx="50.5" cy="22.5" r="1.9" />
      </g>
      <g className="mouth">
        {MOUTH.map((weight, index) => {
          const height = 2 + drive * weight * (speaking ? 10 : 3)
          return <rect key={index} className="bar" x={22.5 + index * 4.6} y={45 - height} width="3" height={Math.max(1.5, height)} rx="1" />
        })}
      </g>
    </svg>
  )
}

export function DeviceRadio({ sources, stats }: { sources: Source[]; stats?: CorpusStats }) {
  const engine = useMemo(() => new RadioEngine(), [])
  const [input, setInput] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [freeSpeak, setFreeSpeak] = useState(false)
  const [latency, setLatency] = useState<number>()
  const [seed, setSeed] = useState<number>()
  const [clock, setClock] = useState<ClockState>({ now: 0, needle: 50, level: 0, flicker: false, active: -1 })
  const raf = useRef(0)
  const physics = useRef({ position: 50, velocity: 0, last: 0, level: 0, nextFlicker: 9 })
  const analyserData = useRef(new Uint8Array(engine.analyser.frequencyBinCount))
  const reduced = useRef(matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const tick = () => {
      const now = engine.ctx.currentTime
      const state = physics.current
      const delta = Math.min(0.04, Math.max(0.001, now - (state.last || now - 0.016)))
      state.last = now
      let active = segments.findIndex(s => now >= (s.audioStart ?? Infinity) && now < (s.audioEnd ?? -Infinity))
      let target = state.position
      let transit: { from: number; to: number; progress: number } | undefined
      if (phase === 'thinking') {
        const sweep = (now * 1.35) % 2
        target = sweep <= 1 ? sweep * 100 : (2 - sweep) * 100
      } else if (active >= 0) {
        const segment = segments[active]
        if (segment.kind === 'clip') target = positionFor(segment.clip.sourceId)
        const clipEnd = segment.audioClipEnd ?? segment.audioEnd ?? now
        const next = segments[active + 1]
        if (now > clipEnd && next?.kind === 'clip' && segment.audioEnd! > clipEnd) {
          const progress = Math.min(1, (now - clipEnd) / (segment.audioEnd! - clipEnd))
          const from = segment.kind === 'clip' ? positionFor(segment.clip.sourceId) : state.position
          transit = { from, to: positionFor(next.clip.sourceId), progress }
          target = transit.to
        }
      } else if (phase === 'idle') target = 50 + Math.sin(now * 0.72) * 0.45
      if (transit) {
        const raw = 1 - Math.exp(-6 * transit.progress) * Math.cos(7 * transit.progress)
        const end = 1 - Math.exp(-6) * Math.cos(7)
        const eased = reduced.current ? 1 : raw / end
        state.position = transit.from + (transit.to - transit.from) * eased
        state.velocity = 0
      } else if (reduced.current) { state.position = target; state.velocity = 0 } else {
        const stiffness = 215
        const damping = 22
        state.velocity += ((target - state.position) * stiffness - state.velocity * damping) * delta
        state.position += state.velocity * delta
      }
      engine.analyser.getByteFrequencyData(analyserData.current)
      const raw = analyserData.current.reduce((sum, value) => sum + value, 0) / analyserData.current.length / 255
      state.level = raw > state.level ? raw : Math.max(raw, state.level - delta / 0.3)
      let flicker = false
      if (!reduced.current && now >= state.nextFlicker) {
        flicker = true
        const seeded = mulberry32(Math.floor(state.nextFlicker * 1000))
        state.nextFlicker = now + 8 + seeded() * 12
      }
      setClock({ now, needle: state.position, level: state.level, flicker, active })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf.current); void engine.stop() }
  }, [engine, phase, segments])

  const transmit = async (event: FormEvent) => {
    event.preventDefault()
    const message = input.trim()
    if (!message || phase !== 'idle') return
    setSubmitted(message)
    setInput('')
    setPhase('thinking')
    const started = performance.now()
    await engine.ctx.resume()
    const result = freeSpeak
      ? { reply: message, seed: Array.from(message).reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0 }
      : await window.bridge.reply.generate(message)
    const matched = await matchText(result.reply)
    setLatency(Math.round(performance.now() - started))
    setSegments(matched)
    setSeed(result.seed)
    await engine.play(matched, result.seed)
    setPhase('playing')
  }

  const replay = async () => {
    if (phase !== 'idle' || !segments.length || seed == null) return
    setPhase('playing')
    await engine.play(segments, seed)
  }

  useEffect(() => {
    if (phase === 'playing' && clock.now >= (segments.at(-1)?.audioEnd ?? Infinity)) { setPhase('idle'); void engine.startIdle() }
  }, [clock.now, phase, segments])

  const activeSegment = segments[clock.active]
  const activeSource = activeSegment?.kind === 'clip' ? sources.find(s => s.id === activeSegment.clip.sourceId) : undefined
  const nearestId = sources.length ? sources.reduce((best, s) => Math.abs(positionFor(s.id) - clock.needle) < Math.abs(positionFor(best.id) - clock.needle) ? s : best).id : undefined
  const lit = Math.min(8, Math.round(clock.level * 13))

  return <main className={`device ${clock.flicker ? 'flicker' : ''}`}>
    <div className="surface grain" aria-hidden="true" />
    <div className="surface scanlines" aria-hidden="true" />
    <section className="tuner" aria-label="Tuning band">
      <BumblebeeFace level={clock.level} speaking={phase === 'playing' && clock.active >= 0} />
      <div className="tuner-title">TUNING BAND <span>FM</span></div>
      <div className="scale">
        {Array.from({ length: 41 }, (_, index) => {
          const frequency = 88 + index / 2
          return <i key={frequency} className={index % 10 === 0 ? 'major' : index % 2 === 0 ? 'medium' : ''} style={{ left: `${index / 40 * 100}%` }}>{index % 10 === 0 && <b>{frequency}</b>}</i>
        })}
        {sources.map(source => {
          const position = positionFor(source.id)
          const near = source.id === nearestId
          const active = activeSource?.id === source.id
          return <span key={source.id} className={`station-tick ${active ? 'active' : ''} ${near ? 'near' : ''}`} style={{ left: `${position}%` }}><b>{frequencyLabel(source)}</b></span>
        })}
        <div className="needle-trail" style={{ transform: `translate3d(${clock.needle * 0.83}cqw,0,0)`, opacity: Math.min(0.35, Math.abs(physics.current.velocity) / 150) }} />
        <div className={`needle ${phase}`} style={{ transform: `translate3d(${clock.needle * 0.83}cqw,0,0)` }}><span /></div>
      </div>
    </section>

    <section className="terminal" aria-live="polite">
      <p className="hud" aria-label="Corpus statistics">
        <span><b>{(stats?.clipCount ?? 0).toLocaleString()}</b> lines</span>
        <span><b>{(stats?.phraseCount ?? 0).toLocaleString()}</b> phrases</span>
        <span><b>{stats?.sourceCount ?? 0}</b> sources</span>
        <span><b>{(stats?.hours ?? 0).toFixed(1)}</b> hrs</span>
        <span><b>{latency != null ? latency : '—'}</b> ms latency</span>
      </p>
      <p className="user-line"><span>&gt;</span> {submitted || 'receiver standing by'}</p>
      {phase === 'idle' && segments.length === 0 && <p className="intro">Bumblebee — it answers only in fragments of dialogue spliced from films and television you own.</p>}
      <div className="reply-line">
        {segments.map((segment, index) => {
          const start = segment.audioStart ?? Infinity
          const end = segment.audioClipEnd ?? segment.audioEnd ?? Infinity
          const ratio = clock.now < start ? 0 : Math.min(1, (clock.now - start) / Math.max(0.01, end - start))
          const text = segment.text.slice(0, Math.ceil(segment.text.length * ratio))
          const status = ratio === 1 ? 'spoken' : ratio > 0 ? 'speaking' : 'waiting'
          return <span className={`fragment ${status} ${segment.kind === 'unmatched' && ratio > 0 ? 'unmatched' : ''}`} style={{ '--hue': `${(index % 3 - 1) * 4}deg` } as CSSProperties} key={`${index}-${segment.text}`}>{index > 0 && ratio > 0 && <i>·</i>}{text}</span>
        })}
        {phase === 'idle' && segments.length === 0 && <span className="ghost">NO CARRIER</span>}
      </div>
      {phase === 'idle' && segments.length > 0 && <div className="reply-actions"><button type="button" className="replay" onClick={replay} disabled={seed == null}>↻ Replay</button></div>}
      <p className="station-plate">{phase === 'thinking' ? 'SCANNING…' : activeSource ? `▮ ${frequencyLabel(activeSource)} · ${activeSource.title}` : '▯ BAND OPEN'}</p>
    </section>

    <form className="control-bar" onSubmit={transmit}>
      <div className="meter" aria-label={`Signal ${lit} of 8`}><div>{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < lit ? 'lit' : i === 7 && lit === 8 ? 'clip' : ''} />)}</div><b>SIG</b></div>
      <label className="mode-switch"><input type="checkbox" checked={freeSpeak} onChange={event => setFreeSpeak(event.target.checked)} /><span /><b>{freeSpeak ? 'FREE' : 'REPLY'}</b></label>
      <label className="command" style={{ '--chars': Math.min(48, input.length) } as CSSProperties}><b>&gt;</b><input value={input} onChange={event => setInput(event.target.value)} disabled={phase !== 'idle'} placeholder={phase === 'thinking' ? 'scanning band…' : phase === 'playing' ? 'transmitting…' : 'type a message'} /><i /></label>
      <button className="power" aria-label="Transmit" disabled={phase !== 'idle'}>⏻</button>
    </form>
  </main>
}
