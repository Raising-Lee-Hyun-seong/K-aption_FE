import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { jobApiAdapter as api, ApiError } from './api/jobApiAdapter'
import type { CaptionMode, JobView, SubtitleSegment, UploadCapabilities, HealthResponse } from './types'

type Screen = 'upload' | 'processing' | 'error' | 'watch'
type SelectedMedia = { file: File; url: string; duration: number | null; isAudio: boolean }
type ErrorInfo = { title: string; detail: string }

const stages = [
  { id: 'queued', label: '대기' }, { id: 'transcribing', label: '영어 음성 인식' },
  { id: 'grouping', label: '문장 묶기' }, { id: 'translating', label: '한국어 번역' },
  { id: 'completed', label: '완료' },
]
const messageOf = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'
const STORAGE_KEY = 'kaption:last-job'
type SavedJob = { id: string; fileName: string; fileSize: number }
function readSavedJob(): SavedJob | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return value && typeof value.id === 'string' && typeof value.fileName === 'string' && typeof value.fileSize === 'number' ? value : null
  } catch { return null }
}
function storeJob(value: SavedJob | null) {
  try { if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else localStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ }
}

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

function Logo({ onHome, disabled = false }: { onHome: () => void; disabled?: boolean }) {
  return <button className="logo-button" type="button" disabled={disabled} onClick={onHome} aria-label="업로드 홈 화면으로 이동" title="홈으로 이동"><span className="logo" aria-hidden="true">K</span></button>
}

function UploadIcon() {
  return <svg className="upload-icon" viewBox="0 0 160 140" aria-hidden="true"><path d="M20 26h45l11 14h65a9 9 0 0 1 9 9v76a9 9 0 0 1-9 9H20a9 9 0 0 1-9-9V35a9 9 0 0 1 9-9Z" fill="#80a4ef" stroke="#3154ad" strokeWidth="3"/><path d="M11 49h139" stroke="#3154ad" strokeWidth="3"/><circle cx="80" cy="83" r="27" fill="#fff" stroke="#3154ad" strokeWidth="3"/><path d="M80 98V69m0 0-9 10m9-10 9 10" fill="none" stroke="#3154ad" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function UploadPage({ selected, onSelect, onStart, busy, capabilities, savedJob, onResume }: {
  selected: SelectedMedia | null
  onSelect: (file: File) => void
  onStart: () => void
  capabilities: UploadCapabilities | null
  savedJob: SavedJob | null
  onResume: () => void
  busy: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const pick = () => { if (!busy && capabilities) inputRef.current?.click() }
  const receive = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file && !busy && capabilities) onSelect(file)
  }
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick() }
  }
  return <main className="center-page upload-page">
    <div className="upload-stack">
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} role="button" tabIndex={0} aria-label="강의 파일 선택 또는 드래그 앤 드롭" onClick={pick} onKeyDown={handleKey} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragging(false) }} onDrop={receive}>
        <div className="icon-tile"><UploadIcon /></div>
        <h1>{selected ? '선택한 강의 파일' : '영상을 드래그해서 올려주세요'}</h1>
        {selected ? <><strong className="file-name">{selected.file.name}</strong><p>{selected.duration === null ? '길이 확인 불가 · 서버에서 검사' : formatTime(selected.duration)} · {(selected.file.size / 1024 / 1024).toFixed(1)} MB</p><span className="text-link">다른 파일 선택</span></> : <p>{capabilities ? `${capabilities.allowed_extensions.join(' · ')} / 최대 ${capabilities.max_duration_seconds / 60}분 · ${(capabilities.max_upload_bytes / 1024 ** 3).toFixed(1)} GiB` : '서버 업로드 규칙을 확인해 주세요'}</p>}
      </div>
      <input ref={inputRef} className="sr-only" type="file" disabled={busy || !capabilities} accept={capabilities?.allowed_extensions.join(',')} onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) onSelect(file); event.target.value = '' }} />
      {selected?.duration === null && <p className="inline-note" role="status">브라우저가 재생 길이를 읽지 못했습니다. 서버에서 길이와 음성을 검증합니다.</p>}
      <div className="upload-actions">
        <label className="select-label">용어집 <select disabled><option>서버 기본 용어집</option></select></label>
        <button className="primary" disabled={!selected || busy || !capabilities} onClick={onStart}>{busy ? '파일 확인 중…' : '번역 시작'}</button>
      </div>
      <p className="inline-note">용어집 선택은 아직 서버에서 지원하지 않습니다.</p>
      {savedJob && <button className="outline" disabled={busy} onClick={onResume}>최근 작업 다시 보기</button>}
    </div>
  </main>
}

function ProcessingPage({ job, uploading, issue, cancelling, onCancel, onRetry }: {
  job: JobView | null; uploading: boolean; issue: string; cancelling: boolean; onCancel: () => void; onRetry: () => void
}) {
  const index = stages.findIndex(stage => stage.id === job?.stage)
  const progress = job?.progressPercent
  const isCancelling = cancelling || job?.status === 'cancelling'
  return <main className="center-page process-page">
    <div className="process-stack">
      <div className="spinner-tile"><div className="spinner" aria-hidden="true" /></div>
      <h1>{uploading ? '파일을 업로드하고 있어요' : isCancelling ? '작업 취소를 기다리고 있어요' : '강의 자막을 만들고 있어요'}</h1>
      <p className="muted">{uploading ? '업로드·접수가 끝날 때까지 이 탭을 유지해 주세요.' : isCancelling ? '현재 추론 단계가 끝나면 서버가 작업을 취소합니다.' : '접수된 작업은 서버에서 계속 처리됩니다. 새로고침 후에도 최근 작업을 확인할 수 있어요.'}</p>
      <div className="stage-grid" aria-label="서버 처리 단계">{stages.map((stage, step) => <div className={`stage ${index >= 0 && step < index ? 'done' : step === index ? 'active' : ''}`} key={stage.id}><span className="stage-mark">{index >= 0 && step < index ? '✓' : step + 1}</span><span>{stage.label}</span></div>)}</div>
      {typeof progress === 'number' ? <><progress className="server-progress" max={100} value={progress} aria-label="번역 구간 진행률" /><p className="progress-label">번역 구간 진행률 {progress.toFixed(0)}% · {job?.completedSegments}/{job?.totalSegments ?? '?'} 구간</p></> : <p className="progress-label">{uploading ? '파일 전송 및 서버 검증 중' : '이 단계에서는 진행률을 제공하지 않습니다.'}</p>}
      {job && <p className="job-meta">경과 {formatTime(job.elapsedSeconds)} · 번역 실패 {job.failedSegments}개<br />작업 ID: {job.id}</p>}
      {issue && <div className="connection-warning" role="alert"><p>{issue}</p><button className="outline" onClick={onRetry}>상태 다시 확인</button></div>}
      {job && <button className="outline" disabled={isCancelling} onClick={onCancel}>{isCancelling ? '취소 요청됨' : '작업 취소'}</button>}
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

function WatchPage({ selected, segments, job, savedJob, onSelect, onReset }: {
  selected: SelectedMedia | null; segments: SubtitleSegment[]; job: JobView; savedJob: SavedJob | null
  onSelect: (file: File) => void; onReset: () => void
}) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const manualScrollUntil = useRef(0)
  const [mode, setMode] = useState<CaptionMode>('ko')
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(selected?.duration ?? 0)
  const [playing, setPlaying] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  useEffect(() => { setMediaError(false); setCurrent(0); setPlaying(false); setDuration(selected?.duration ?? 0) }, [selected])
  const download = async (format: 'srt' | 'vtt') => {
    setDownloadBusy(true); setDownloadError('')
    try {
      const blob = await api.downloadSubtitles(job.id, mode, format)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `captions-${mode}.${format}`
      document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setDownloadError(messageOf(error)) }
    finally { setDownloadBusy(false) }
  }
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
    src: selected?.url,
    preload: 'metadata' as const,
    onTimeUpdate: () => setCurrent(mediaRef.current?.currentTime ?? 0),
    onLoadedMetadata: () => setDuration(mediaRef.current?.duration ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setMediaError(true),
  }
  return <main className="watch-page">
    <div className="watch-toolbar"><div><h1>{selected?.file.name ?? savedJob?.fileName ?? '처리된 강의'}</h1><p>로컬 파일 재생 · 서버 생성 자막</p></div><ModeSwitch mode={mode} setMode={setMode} className="desktop-mode" /><button className="outline" onClick={onReset}>새 파일 올리기</button></div>
    <div className="download-toolbar"><span>{job.failedSegments > 0 ? `일부 번역 실패 ${job.failedSegments}개 · 해당 구간은 영어 원문을 표시합니다.` : '자막 처리 완료'}{job.expiresAt && ` · 보관 기한 ${new Date(job.expiresAt).toLocaleString('ko-KR')}`}</span><button className="outline" disabled={downloadBusy} onClick={() => download('srt')}>SRT 다운로드</button><button className="outline" disabled={downloadBusy} onClick={() => download('vtt')}>VTT 다운로드</button></div>
    {downloadError && <p className="media-warning" role="alert">{downloadError}</p>}
    <div className="watch-layout">
      <section className="player-column" aria-label="미디어 재생">
        <div className={`player-frame ${selected?.isAudio ? 'audio-frame' : ''}`}>
          {!selected ? <div className="missing-media"><p>자막 결과를 불러왔습니다. 재생하려면 동일한 원본 파일을 다시 선택해 주세요.</p><label>원본 파일 선택<input type="file" onChange={event => { const file = event.target.files?.[0]; if (file) onSelect(file); event.target.value = '' }} /></label></div> : selected.isAudio ? <><div className="audio-art" aria-hidden="true">♫</div><audio {...mediaProps} /></> : <video {...mediaProps} playsInline onClick={togglePlay} />}
          {selected && !playing && !mediaError && <button className="center-play" onClick={togglePlay} aria-label="재생">▶</button>}
          {selected && active && !mediaError && <div className="caption-overlay" aria-live="off"><CaptionText segment={active} mode={mode} />{statusLabel(active.status) && <small className="overlay-status">{statusLabel(active.status)}</small>}</div>}
        </div>
        {mediaError && <p className="media-warning" role="alert">이 브라우저에서 파일을 재생할 수 없어요. 파일 형식 또는 코덱을 확인해 주세요. 자막 목록은 살펴볼 수 있습니다.</p>}
        <div className="playback-controls"><button className="play-control" onClick={togglePlay} disabled={mediaError || !selected} aria-label={playing ? '일시정지' : '재생'}>{playing ? 'Ⅱ' : '▶'}</button><label className="sr-only" htmlFor="seek">재생 위치</label><input id="seek" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(current, duration || 1)} onChange={(event) => seek(Number(event.target.value))} disabled={mediaError || !selected} /><span className="time-readout">{formatTime(current)} / {formatTime(duration)}</span></div>
        <ModeSwitch mode={mode} setMode={setMode} className="mobile-mode" />
        {segments.length === 0 && <div className="empty-captions" role="status"><strong>표시할 자막이 없어요</strong><p>인식된 음성이 없습니다. 원본 파일은 계속 재생할 수 있어요.</p></div>}
      </section>
      <aside className="segment-panel" aria-label="자막 목록"><div className="panel-heading"><h2>자막 목록</h2><span>{segments.length}개 구간</span></div>{segments.length ? <div className="segment-scroll" onWheel={() => { manualScrollUntil.current = Date.now() + 3000 }} onTouchMove={() => { manualScrollUntil.current = Date.now() + 3000 }} onPointerDown={() => { manualScrollUntil.current = Date.now() + 3000 }} onKeyDown={() => { manualScrollUntil.current = Date.now() + 3000 }}>{segments.map((segment) => <button key={segment.id} ref={(node) => { cardRefs.current[segment.id] = node }} className={`segment-card ${segment.id === activeId ? 'current' : ''}`} disabled={!selected || mediaError} onClick={() => seek(Math.min(segment.startMs / 1000, duration))} aria-current={segment.id === activeId ? 'true' : undefined}><span className="segment-language-box source-box" lang="en">
          <span className="segment-box-heading"><span className="segment-time">{formatTime(segment.startMs / 1000)}</span><span>English</span></span>
          <span className="segment-source">{segment.sourceText}</span>
        </span>
        <span className="segment-language-box translation-box" lang={segment.targetText ? 'ko' : 'en'}>
          <span className="segment-box-heading">{segment.targetText ? '한국어 번역' : '영어 원문 유지'}</span>
          <span className="segment-target">{segment.targetText ?? segment.sourceText}</span>
          {statusLabel(segment.status) && <span className={`status-pill ${segment.status}`}>{statusLabel(segment.status)}</span>}
        </span></button>)}</div> : <p className="panel-empty">인식된 자막 구간이 없습니다.</p>}</aside>
    </div>
  </main>
}

export default function App() {
  const [savedJob, setSavedJob] = useState<SavedJob | null>(readSavedJob)
  const [screen, setScreen] = useState<Screen>(() => readSavedJob() ? 'processing' : 'upload')
  const [selected, setSelected] = useState<SelectedMedia | null>(null)
  const [jobId, setJobId] = useState<string | null>(() => readSavedJob()?.id ?? null)
  const [job, setJob] = useState<JobView | null>(null)
  const [segments, setSegments] = useState<SubtitleSegment[]>([])
  const [error, setError] = useState<ErrorInfo>({ title: '', detail: '' })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [issue, setIssue] = useState('')
  const [retry, setRetry] = useState(0)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [capabilities, setCapabilities] = useState<UploadCapabilities | null>(null)
  const [serverError, setServerError] = useState('')
  const [serverRetry, setServerRetry] = useState(0)
  const selectedRef = useRef<SelectedMedia | null>(null)
  const generation = useRef(0)

  useEffect(() => () => { if (selectedRef.current) URL.revokeObjectURL(selectedRef.current.url) }, [])
  useEffect(() => {
    const controller = new AbortController()
    setServerError('')
    Promise.all([api.getHealth(controller.signal), api.getCapabilities(controller.signal)])
      .then(([nextHealth, rules]) => { if (!controller.signal.aborted) { setHealth(nextHealth); setCapabilities(rules) } })
      .catch(error => { if (!controller.signal.aborted) { setServerError(messageOf(error)); setCapabilities(null); setHealth(null) } })
    return () => controller.abort()
  }, [serverRetry])

  const reset = () => {
    if (uploading) return
    generation.current++
    if (selectedRef.current) URL.revokeObjectURL(selectedRef.current.url)
    selectedRef.current = null
    setSelected(null); setJobId(null); setJob(null); setSegments([]); setBusy(false); setIssue(''); setScreen('upload')
  }
  const fail = (title: string, detail: string) => { setError({ title, detail }); setScreen('error'); setBusy(false) }
  const selectFile = async (file: File) => {
    if (!capabilities) return
    const token = ++generation.current
    setBusy(true)
    const extension = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
    if (!capabilities.allowed_extensions.includes(extension)) { fail('올릴 수 없는 파일이에요', `지원 형식: ${capabilities.allowed_extensions.join(', ')}`); return }
    if (!file.size || file.size > capabilities.max_upload_bytes) { fail('파일 크기를 확인해 주세요', `빈 파일은 올릴 수 없으며 최대 ${(capabilities.max_upload_bytes / 1024 ** 3).toFixed(1)} GiB까지 지원합니다.`); return }
    if (screen === 'watch' && savedJob && (file.name !== savedJob.fileName || file.size !== savedJob.fileSize)) { fail('원본 파일을 선택해 주세요', '최근 작업과 파일명 또는 크기가 다릅니다. 홈의 최근 작업 다시 보기에서 원본 파일을 선택해 주세요.'); return }
    const duration = await readDuration(file)
    if (token !== generation.current) return
    if (duration !== null && duration > capabilities.max_duration_seconds) { fail('강의 길이를 확인해 주세요', `최대 ${capabilities.max_duration_seconds / 60}분까지 지원합니다.`); return }
    if (selectedRef.current) URL.revokeObjectURL(selectedRef.current.url)
    const next = { file, url: URL.createObjectURL(file), duration, isAudio: ['.mp3', '.wav', '.m4a'].includes(extension) }
    selectedRef.current = next; setSelected(next); setBusy(false)
  }
  const start = async () => {
    if (!selected || busy || uploading || !capabilities) return
    const token = ++generation.current
    setUploading(true); setIssue(''); setJob(null); setJobId(null); setScreen('processing')
    try {
      const next = await api.submitLecture(selected.file)
      if (token !== generation.current) return
      const saved = { id: next.id, fileName: selected.file.name, fileSize: selected.file.size }
      storeJob(saved); setSavedJob(saved); setJob(next); setJobId(next.id)
    } catch (error) {
      if (token === generation.current) fail('작업 접수를 확인하지 못했어요', `${messageOf(error)} 연결이 끊긴 경우 서버에서 이미 접수했을 수도 있으므로 자동 재전송하지 않습니다.`)
    } finally { setUploading(false) }
  }
  useEffect(() => {
    if (screen !== 'processing' || !jobId) return
    const controller = new AbortController()
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await api.getJob(jobId, controller.signal)
        if (controller.signal.aborted) return
        setJob(next); setIssue('')
        if (next.status === 'failed' || next.status === 'cancelled') {
          fail(next.status === 'cancelled' ? '작업을 취소했어요' : '자막을 만들지 못했어요', next.error?.message ?? '다른 파일을 올리거나 다시 시도해 주세요.')
          return
        }
        if (next.status === 'completed') {
          const result = await api.getSegments(jobId, controller.signal)
          if (!controller.signal.aborted) {
            setSegments(result); setScreen('watch')
            // Refresh the initial lazy-loaded STT model status after real inference.
            void api.getHealth().then(setHealth).catch(() => {})
          }
          return
        }
        timer = window.setTimeout(poll, 2000)
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 404) {
          storeJob(null); setSavedJob(null); fail('작업을 찾을 수 없어요', messageOf(error))
        } else setIssue(messageOf(error))
      }
    }
    void poll()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [screen, jobId, retry])
  const cancel = async () => {
    if (!jobId || cancelling) return
    const token = generation.current
    setCancelling(true)
    try {
      await api.cancelJob(jobId)
      if (token === generation.current) setRetry(value => value + 1)
    } catch (error) {
      if (token === generation.current) {
        setIssue(messageOf(error))
        if (error instanceof ApiError && error.status === 409) setRetry(value => value + 1)
      }
    } finally { setCancelling(false) }
  }
  const resume = () => {
    if (!savedJob) return
    reset()
    setJobId(savedJob.id); setJob(null); setIssue(''); setScreen('processing')
  }
  return <div className="app-shell">
    <header className="site-header"><Logo onHome={reset} disabled={uploading} /><span className="demo-badge" role="status">{serverError ? '서버 연결 오류' : health ? `서버 연결됨 · 번역 모델 ${health.translation_model_loaded ? '준비됨' : '대기 중'}` : '서버 확인 중…'}</span></header>
    {serverError && <div className="connection-warning" role="alert"><p>{serverError}</p><button className="outline" onClick={() => setServerRetry(value => value + 1)}>서버 다시 확인</button></div>}
    {health && <p className="server-note">음성 인식 모델: {health.transcription_model_loaded ? '로드됨' : '첫 요청 시 준비'} · 원본 파일은 재생을 위해 현재 탭에 유지됩니다.</p>}
    {screen === 'upload' && <UploadPage selected={selected} onSelect={selectFile} onStart={start} busy={busy} capabilities={capabilities} savedJob={savedJob} onResume={resume} />}
    {screen === 'processing' && <ProcessingPage job={job} uploading={uploading} issue={issue} cancelling={cancelling} onCancel={cancel} onRetry={() => setRetry(value => value + 1)} />}
    {screen === 'error' && <ErrorPage error={error} onReset={reset} />}
    {screen === 'watch' && job && <WatchPage selected={selected} segments={segments} job={job} savedJob={savedJob} onSelect={selectFile} onReset={reset} />}
  </div>
}
