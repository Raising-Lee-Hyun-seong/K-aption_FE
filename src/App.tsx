import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { mockAdapter, stages } from './api/mockAdapter'
import type { CaptionMode, DemoOutcome, JobView, SubtitleSegment } from './types'

type Screen = 'upload' | 'processing' | 'error' | 'watch'
type SelectedMedia = { file: File; url: string; duration: number | null; isAudio: boolean }
type ErrorInfo = { title: string; detail: string }

const MAX_SECONDS = 90 * 60
const allowed = new Set(['mp4', 'mkv', 'mp3', 'wav'])

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '00:00'
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const media = document.createElement(file.name.toLowerCase().match(/\.(mp3|wav)$/) ? 'audio' : 'video')
    let settled = false
    const finish = (duration: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      media.removeAttribute('src')
      media.load()
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    media.preload = 'metadata'
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : null)
    media.onerror = () => finish(null)
    const timer = window.setTimeout(() => finish(null), 5000)
    media.src = url
  })
}

function Logo({ onHome }: { onHome: () => void }) {
  return <button className="logo-button" type="button" onClick={onHome} aria-label="업로드 홈 화면으로 이동" title="홈으로 이동"><span className="logo" aria-hidden="true">K</span></button>
}

function DemoBadge() {
  return <span className="demo-badge">데모 · 실제 AI 처리 아님</span>
}

function UploadIcon() {
  return <svg className="upload-icon" viewBox="0 0 160 140" aria-hidden="true"><path d="M20 26h45l11 14h65a9 9 0 0 1 9 9v76a9 9 0 0 1-9 9H20a9 9 0 0 1-9-9V35a9 9 0 0 1 9-9Z" fill="#80a4ef" stroke="#3154ad" strokeWidth="3"/><path d="M11 49h139" stroke="#3154ad" strokeWidth="3"/><circle cx="80" cy="83" r="27" fill="#fff" stroke="#3154ad" strokeWidth="3"/><path d="M80 98V69m0 0-9 10m9-10 9 10" fill="none" stroke="#3154ad" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function UploadPage({ selected, onSelect, onStart, glossary, setGlossary, outcome, setOutcome, busy }: {
  selected: SelectedMedia | null
  onSelect: (file: File) => void
  onStart: () => void
  glossary: string
  setGlossary: (value: string) => void
  outcome: DemoOutcome
  setOutcome: (value: DemoOutcome) => void
  busy: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const pick = () => inputRef.current?.click()
  const receive = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onSelect(file)
  }
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick() }
  }
  return <main className="center-page upload-page">
    <div className="upload-stack">
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} role="button" tabIndex={0} aria-label="강의 파일 선택 또는 드래그 앤 드롭" onClick={pick} onKeyDown={handleKey} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragging(false) }} onDrop={receive}>
        <div className="icon-tile"><UploadIcon /></div>
        <h1>{selected ? '선택한 강의 파일' : '영상을 드래그해서 올려주세요'}</h1>
        {selected ? <><strong className="file-name">{selected.file.name}</strong><p>{selected.duration === null ? '길이를 확인할 수 없어요' : formatTime(selected.duration)} · {(selected.file.size / 1024 / 1024).toFixed(1)} MB</p><span className="text-link">다른 파일 선택</span></> : <p>mp4 · mkv · mp3 · wav / 최대 90분</p>}
      </div>
      <input ref={inputRef} className="sr-only" type="file" accept=".mp4,.mkv,.mp3,.wav,video/mp4,video/x-matroska,audio/mpeg,audio/wav" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) onSelect(file); event.target.value = '' }} />
      {selected?.duration === null && <p className="inline-note" role="status">브라우저가 재생 길이를 읽지 못했습니다. 90분 제한은 확인되지 않은 상태로 데모를 진행합니다.</p>}
      <div className="upload-actions">
        <label className="select-label">용어집 <select value={glossary} onChange={(event) => setGlossary(event.target.value)}><option value="linear">선형대수</option><option value="physics">물리학</option><option value="general">일반 강의</option></select></label>
        <button className="primary" disabled={!selected || busy} onClick={onStart}>{busy ? '준비 중…' : '번역 시작'}</button>
      </div>
      <div className="demo-controls"><label>데모 결과 <select value={outcome} onChange={(event) => setOutcome(event.target.value as DemoOutcome)}><option value="complete">정상 완료</option><option value="partial">일부 번역 실패</option><option value="empty">자막 없음</option><option value="failure">처리 실패</option></select></label><p>용어집과 결과 선택은 화면 시연용이며 파일 내용에는 적용되지 않습니다.</p></div>
    </div>
  </main>
}

function ProcessingPage({ job }: { job: JobView | null }) {
  const index = job?.stageIndex ?? 0
  const progress = job?.progressPercent ?? 0
  return <main className="center-page process-page" aria-live="polite">
    <div className="process-stack">
      <div className="spinner-tile"><div className="spinner" aria-hidden="true" /></div>
      <h1>강의 자막을 만들고 있어요</h1>
      <p className="muted">데모 진행 화면입니다. 이 탭을 열어 두면 잠시 후 결과를 볼 수 있어요.</p>
      <div className="stage-grid" aria-label="데모 처리 단계">{stages.map((stage, step) => <div className={`stage ${step < index ? 'done' : step === index ? 'active' : ''}`} key={stage}><span className="stage-mark">{step < index ? '✓' : step + 1}</span><span>{stage}</span></div>)}</div>
      <div className="progress-line"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      <p className="progress-label">데모 진행률 {progress}% · {stages[index]}</p>
    </div>
  </main>
}

function ErrorPage({ error, onReset }: { error: ErrorInfo; onReset: () => void }) {
  return <main className="center-page error-page"><div className="error-stack" role="alert"><div className="error-tile"><span>!</span></div><h1>{error.title}</h1><p>{error.detail}</p><button className="primary" onClick={onReset}>다시 올리기</button></div></main>
}

function statusLabel(status: SubtitleSegment['status']) {
  if (status === 'translation_failed') return '번역 실패 · 원문 유지'
  if (status === 'low_confidence') return '부정확함'
  if (status === 'recognition_failed') return '인식 실패'
  if (status === 'source_only') return '원문 유지'
  return null
}

function CaptionText({ segment, mode }: { segment: SubtitleSegment; mode: CaptionMode }) {
  const fallback = !segment.targetText
  return <>{mode !== 'en' && <span className="caption-ko">{segment.targetText ?? segment.sourceText}</span>}{mode === 'both' && !fallback && <span className="caption-en">{segment.sourceText}</span>}{mode === 'en' && <span className="caption-en">{segment.sourceText}</span>}{fallback && mode !== 'en' && <small>영어 원문 표시</small>}</>
}

function ModeSwitch({ mode, setMode, className = '' }: { mode: CaptionMode; setMode: (mode: CaptionMode) => void; className?: string }) {
  return <div className={`mode-switch ${className}`} role="group" aria-label="자막 언어">{([['ko', '한국어'], ['en', 'English'], ['both', '한·영']] as const).map(([value, label]) => <button key={value} aria-pressed={mode === value} className={mode === value ? 'selected' : ''} onClick={() => setMode(value)}>{label}</button>)}</div>
}

function WatchPage({ selected, segments, onReset }: { selected: SelectedMedia; segments: SubtitleSegment[]; onReset: () => void }) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const manualScrollUntil = useRef(0)
  const [mode, setMode] = useState<CaptionMode>('ko')
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(selected.duration ?? 0)
  const [playing, setPlaying] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const active = segments.find((segment) => segment.startMs <= current * 1000 && current * 1000 < segment.endMs)
  const activeId = active?.id

  useEffect(() => {
    if (activeId && Date.now() > manualScrollUntil.current) cardRefs.current[activeId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  const seek = (seconds: number) => {
    const media = mediaRef.current
    if (media) { media.currentTime = seconds; setCurrent(seconds) }
  }
  const togglePlay = async () => {
    const media = mediaRef.current
    if (!media || mediaError) return
    if (media.paused) { try { await media.play() } catch { setMediaError(true) } }
    else media.pause()
  }
  const mediaProps = {
    ref: mediaRef,
    src: selected.url,
    preload: 'metadata' as const,
    onTimeUpdate: () => setCurrent(mediaRef.current?.currentTime ?? 0),
    onLoadedMetadata: () => setDuration(mediaRef.current?.duration ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setMediaError(true),
  }
  return <main className="watch-page">
    <div className="watch-toolbar"><div><h1>{selected.file.name}</h1><p>로컬 파일 재생 · 데모 자막</p></div><ModeSwitch mode={mode} setMode={setMode} className="desktop-mode" /><button className="outline" onClick={onReset}>새 파일 올리기</button></div>
    <div className="watch-layout">
      <section className="player-column" aria-label="미디어 재생">
        <div className={`player-frame ${selected.isAudio ? 'audio-frame' : ''}`}>
          {selected.isAudio ? <><div className="audio-art" aria-hidden="true">♫</div><audio {...mediaProps} /></> : <video {...mediaProps} playsInline onClick={togglePlay} />}
          {!playing && !mediaError && <button className="center-play" onClick={togglePlay} aria-label="재생">▶</button>}
          {active && !mediaError && <div className="caption-overlay" aria-live="off"><CaptionText segment={active} mode={mode} />{statusLabel(active.status) && <small className="overlay-status">{statusLabel(active.status)}</small>}</div>}
        </div>
        {mediaError && <p className="media-warning" role="alert">이 브라우저에서 파일을 재생할 수 없어요. 파일 형식 또는 코덱을 확인해 주세요. 자막 목록은 살펴볼 수 있습니다.</p>}
        <div className="playback-controls"><button className="play-control" onClick={togglePlay} disabled={mediaError} aria-label={playing ? '일시정지' : '재생'}>{playing ? 'Ⅱ' : '▶'}</button><label className="sr-only" htmlFor="seek">재생 위치</label><input id="seek" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(current, duration || 1)} onChange={(event) => seek(Number(event.target.value))} disabled={mediaError} /><span className="time-readout">{formatTime(current)} / {formatTime(duration)}</span></div>
        <ModeSwitch mode={mode} setMode={setMode} className="mobile-mode" />
        {segments.length === 0 && <div className="empty-captions" role="status"><strong>표시할 자막이 없어요</strong><p>데모의 자막 없음 결과입니다. 미디어는 계속 재생할 수 있어요.</p></div>}
      </section>
      <aside className="segment-panel" aria-label="자막 목록"><div className="panel-heading"><h2>자막 목록</h2><span>{segments.length}개 구간</span></div>{segments.length ? <div className="segment-scroll" onWheel={() => { manualScrollUntil.current = Date.now() + 3000 }} onTouchMove={() => { manualScrollUntil.current = Date.now() + 3000 }} onPointerDown={() => { manualScrollUntil.current = Date.now() + 3000 }} onKeyDown={() => { manualScrollUntil.current = Date.now() + 3000 }}>{segments.map((segment) => <button key={segment.id} ref={(node) => { cardRefs.current[segment.id] = node }} className={`segment-card ${segment.id === activeId ? 'current' : ''}`} onClick={() => seek(segment.startMs / 1000)} aria-current={segment.id === activeId ? 'true' : undefined}><span className="segment-time">{formatTime(segment.startMs / 1000)}</span><span className="segment-source">{segment.sourceText}</span><span className="segment-target">{segment.targetText ?? segment.sourceText}</span>{statusLabel(segment.status) && <span className={`status-pill ${segment.status}`}>{statusLabel(segment.status)}</span>}</button>)}</div> : <p className="panel-empty">인식된 자막 구간이 없습니다.</p>}</aside>
    </div>
  </main>
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [selected, setSelected] = useState<SelectedMedia | null>(null)
  const [glossary, setGlossary] = useState('linear')
  const [outcome, setOutcome] = useState<DemoOutcome>('complete')
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [segments, setSegments] = useState<SubtitleSegment[]>([])
  const [error, setError] = useState<ErrorInfo>({ title: '', detail: '' })
  const [busy, setBusy] = useState(false)
  const selectedRef = useRef<SelectedMedia | null>(null)
  const selectionToken = useRef(0)

  useEffect(() => () => { if (selectedRef.current) URL.revokeObjectURL(selectedRef.current.url) }, [])

  const reset = () => {
    selectionToken.current++
    if (selectedRef.current) URL.revokeObjectURL(selectedRef.current.url)
    selectedRef.current = null
    setSelected(null)
    setJobId(null)
    setJob(null)
    setSegments([])
    setBusy(false)
    setScreen('upload')
  }
  const fail = (title: string, detail: string) => { setError({ title, detail }); setScreen('error'); setBusy(false) }
  const selectFile = async (file: File) => {
    const token = ++selectionToken.current
    setBusy(true)
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!allowed.has(extension)) { fail('올릴 수 없는 파일이에요', 'mp4 · mkv · mp3 · wav 형식의 파일을 사용해 주세요.'); return }
    if (file.size === 0) { fail('빈 파일은 올릴 수 없어요', '내용이 있는 영상 또는 음성 파일을 선택해 주세요.'); return }
    const duration = await readDuration(file)
    if (token !== selectionToken.current) return
    if (duration !== null && duration > MAX_SECONDS) { fail('90분 이하 강의를 올려 주세요', '선택한 파일이 최대 길이인 90분을 초과했습니다.'); return }
    if (selectedRef.current) URL.revokeObjectURL(selectedRef.current.url)
    const next = { file, url: URL.createObjectURL(file), duration, isAudio: extension === 'mp3' || extension === 'wav' }
    selectedRef.current = next
    setSelected(next)
    setBusy(false)
  }
  const start = async () => {
    if (!selected || busy) return
    setBusy(true)
    try { const result = await mockAdapter.submitLecture(selected.file, glossary, outcome); setJobId(result.jobId); setJob(null); setScreen('processing') }
    catch { fail('자막을 만들지 못했어요', '데모 작업을 시작하지 못했습니다. 다시 올려 주세요.') }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (screen !== 'processing' || !jobId) return
    let cancelled = false
    const poll = async () => {
      try {
        const next = await mockAdapter.getJob(jobId)
        if (cancelled) return
        setJob(next)
        if (next.status === 'failed') fail('자막을 만들지 못했어요', '데모 처리 실패 상태입니다. 파일을 다시 올려 주세요.')
        if (next.status === 'completed') { setSegments(await mockAdapter.getSegments(jobId)); setScreen('watch') }
      } catch { if (!cancelled) fail('자막을 만들지 못했어요', '데모 작업 상태를 확인하지 못했습니다. 다시 올려 주세요.') }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 200)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [screen, jobId])

  return <div className="app-shell"><header className="site-header"><Logo onHome={reset} /><DemoBadge /></header>{screen === 'upload' && <UploadPage selected={selected} onSelect={selectFile} onStart={start} glossary={glossary} setGlossary={setGlossary} outcome={outcome} setOutcome={setOutcome} busy={busy} />}{screen === 'processing' && <ProcessingPage job={job} />}{screen === 'error' && <ErrorPage error={error} onReset={reset} />}{screen === 'watch' && selected && <WatchPage selected={selected} segments={segments} onReset={reset} />}</div>
}
