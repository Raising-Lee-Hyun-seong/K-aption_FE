import type { JobView } from '../types'
import { apiBaseUrl } from '../api/jobApiAdapter'

export const MEDIA_TTL_MS = 30 * 60 * 1000
const DB_NAME = 'kaption-media'
const EVENT = 'kaption:media-cache'
export interface MediaData { file: File; duration: number | null; isAudio: boolean }
interface Metadata { key: string; jobId: string; origin: string }
const keyFor = (id: string) => `${apiBaseUrl}|${id}`

// Keep metadata separate: expiry scans must not load potentially 1 GiB blobs.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('metadata', { keyPath: 'key' })
      request.result.createObjectStore('media')
    }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('브라우저 저장소를 열 수 없습니다. 다른 탭을 확인해 주세요.'))
  })
}

async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, value: (value: T) => void) => void): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    let value: T
    const tx = db.transaction(['metadata', 'media'], mode)
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('원본 저장에 실패했습니다.')) }
    tx.onerror = () => { /* onabort handles failure; never report success before commit. */ }
    try { run(tx, result => { value = result }) } catch (error) { tx.abort(); reject(error) }
  })
}

function announce(id: string, deleted: boolean) {
  const detail = { id, deleted, origin: apiBaseUrl, nonce: crypto.randomUUID() }
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
  try { localStorage.setItem(EVENT, JSON.stringify(detail)) } catch { /* Same-tab events still work. */ }
}

export async function removeMedia(id: string): Promise<void> {
  await transaction<void>('readwrite', tx => {
    tx.objectStore('metadata').delete(keyFor(id))
    tx.objectStore('media').delete(keyFor(id))
  })
  announce(id, true)
}

const ACTIVITY_KEY = 'kaption:media-last-active'
const SESSION_LOCK = 'kaption:media-open-tab'
const INIT_LOCK = 'kaption:media-session-init'
let session: Promise<void> | null = null
let releaseSession: (() => void) | null = null
let heartbeat: number | undefined
let listenersInstalled = false

function touch() { localStorage.setItem(ACTIVITY_KEY, String(Date.now())) }

async function clearStoredMedia() {
  const records = await transaction<Metadata[]>('readwrite', (tx, done) => {
    const store = tx.objectStore('metadata')
    const read = store.getAll()
    read.onsuccess = () => done(read.result as Metadata[])
    store.clear(); tx.objectStore('media').clear()
  })
  for (const record of records) if (record.origin === apiBaseUrl) announce(record.jobId, true)
}

// Web Locks track live documents even when background timers are throttled.
// Initialization is serialized across tabs, before any cached blob can be read.
function ensureSession(): Promise<void> {
  if (session) return session
  session = (async () => {
    if (!navigator.locks) throw new Error('이 브라우저에서는 안전한 원본 캐시 보관을 지원하지 않습니다.')
    await navigator.locks.request(INIT_LOCK, async () => {
      const locks = await navigator.locks.query()
      const anotherTabOpen = locks.held?.some(lock => lock.name === SESSION_LOCK) ?? false
      const last = Number(localStorage.getItem(ACTIVITY_KEY))
      if (!anotherTabOpen && last > 0 && Date.now() - last >= MEDIA_TTL_MS) await clearStoredMedia()
      touch() // Failure disables caching instead of persisting files without an expiry marker.
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request(SESSION_LOCK, { mode: 'shared' }, () => new Promise<void>(release => {
          releaseSession = release; resolve()
        })).catch(reject)
      })
      heartbeat = window.setInterval(() => { try { touch() } catch { /* Existing timestamp remains. */ } }, 15000)
    })
  })().catch(error => { session = null; throw error })
  if (!listenersInstalled) {
    listenersInstalled = true
    window.addEventListener('pagehide', () => {
      try { touch() } catch { /* Crash/unavailable storage falls back to last heartbeat. */ }
      window.clearInterval(heartbeat)
      releaseSession?.(); releaseSession = null; session = null
    })
    window.addEventListener('pageshow', event => {
      if (event.persisted) void ensureSession().catch(() => {})
    })
  }
  return session
}

export async function saveMedia(job: JobView, media: MediaData): Promise<boolean> {
  await ensureSession()
  if (job.status === 'failed' || job.status === 'cancelled') return false
  await transaction<void>('readwrite', tx => {
    tx.objectStore('metadata').put({ key: keyFor(job.id), jobId: job.id, origin: apiBaseUrl } satisfies Metadata)
    tx.objectStore('media').put(media, keyFor(job.id))
  })
  announce(job.id, false)
  return true
}

export async function syncMediaJob(job: JobView): Promise<void> {
  await ensureSession()
  if (job.status === 'failed' || job.status === 'cancelled') await removeMedia(job.id)
}

export async function loadMedia(id: string): Promise<MediaData | null> {
  await ensureSession()
  return transaction<MediaData | null>('readonly', (tx, done) => {
    const file = tx.objectStore('media').get(keyFor(id))
    file.onsuccess = () => done(file.result ?? null)
  })
}

// Keep the document session alive across React re-renders and screen changes.
// Only pagehide releases it; closing another tab must never interrupt playback.
export function maintainMediaCache(onDelete: (id: string) => void, onError: (error: unknown) => void): () => void {
  let stopped = false
  const change = (detail: { id: string; origin: string; deleted: boolean }) => {
    if (detail.origin === apiBaseUrl && detail.deleted) onDelete(detail.id)
  }
  const local = (event: Event) => change((event as CustomEvent).detail)
  const remote = (event: StorageEvent) => {
    if (event.key === EVENT && event.newValue) { try { change(JSON.parse(event.newValue)) } catch { /* Ignore invalid cross-tab messages. */ } }
  }
  const wake = () => { void ensureSession().catch(error => { if (!stopped) onError(error) }) }
  window.addEventListener(EVENT, local); window.addEventListener('storage', remote)
  window.addEventListener('pageshow', wake)
  wake()
  return () => {
    stopped = true
    window.removeEventListener(EVENT, local); window.removeEventListener('storage', remote)
    window.removeEventListener('pageshow', wake)
  }
}
