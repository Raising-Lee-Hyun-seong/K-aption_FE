import type { ApiClient, HealthResponse, JobView, SubtitleSegment, UploadCapabilities } from '../types'

// Empty means same origin: Vite proxies these paths to the Docker host in development.
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); this.name = 'ApiError' }
}

const messages: Record<number, string> = {
  404: '작업을 찾을 수 없거나 보관 기한이 지났습니다.',
  409: '현재 작업 상태에서는 요청을 처리할 수 없습니다.',
  413: '서버가 허용하는 파일 크기를 초과했습니다.',
  415: '서버에서 지원하지 않는 파일 형식입니다.',
  422: '파일 길이, 음성 디코딩 또는 요청 내용을 확인해 주세요.',
  500: '서버 처리 또는 저장 중 오류가 발생했습니다.',
  503: '작업자가 준비되지 않았거나 처리 대기 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('서버 응답 형식이 올바르지 않습니다.')
  return value as JsonObject
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ApiError('서버 응답의 숫자 형식이 올바르지 않습니다.')
  return value
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('서버 응답의 문자열 형식이 올바르지 않습니다.')
  return value
}

async function request(path: string, init: RequestInit = {}, timeout = 30000): Promise<Response> {
  const signal = timeout ? AbortSignal.any([AbortSignal.timeout(timeout), ...(init.signal ? [init.signal] : [])]) : init.signal
  let response: Response
  try { response = await fetch(`${apiBaseUrl}${path}`, { ...init, signal }) }
  catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApiError('서버에 연결하지 못했거나 응답 시간이 초과됐습니다. Docker 서버와 연결 주소를 확인해 주세요.')
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body = object(await response.json())
      detail = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail)
        ? body.detail.map(item => typeof item?.msg === 'string' ? item.msg : '').filter(Boolean).join(', ') : ''
    } catch { /* Non-JSON errors use the status-specific message. */ }
    throw new ApiError(`${messages[response.status] ?? '요청을 처리하지 못했습니다.'}${detail ? ` (${detail})` : ''}`, response.status)
  }
  return response
}

async function json(path: string, init?: RequestInit, timeout?: number): Promise<JsonObject> {
  const response = await request(path, init, timeout)
  try { return object(await response.json()) }
  catch { throw new ApiError('서버에서 올바른 JSON 응답을 받지 못했습니다.') }
}

export function normalizeJob(body: JsonObject): JobView {
  const status = string(body.status)
  const stage = string(body.stage)
  if (!['queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed'].includes(status) ||
      !['queued', 'transcribing', 'grouping', 'translating', 'cancelled', 'completed', 'failed'].includes(stage)) {
    throw new ApiError('지원하지 않는 작업 상태를 받았습니다. API 규격을 확인해 주세요.')
  }
  const progress = body.progress_percent == null ? null : number(body.progress_percent)
  if (progress !== null && progress > 100) throw new ApiError('서버 진행률이 허용 범위를 벗어났습니다.')
  const error = body.error == null ? null : object(body.error)
  return {
    id: string(body.job_id), status: status as JobView['status'], stage: stage as JobView['stage'],
    progressPercent: progress, completedSegments: number(body.completed_segments ?? 0),
    totalSegments: body.total_segments == null ? null : number(body.total_segments),
    failedSegments: number(body.failed_segments ?? 0), elapsedSeconds: number(body.elapsed_seconds ?? 0),
    expiresAt: body.expires_at == null ? null : string(body.expires_at),
    error: error ? { code: string(error.code), message: string(error.message) } : null,
  }
}

export function normalizeSegments(body: JsonObject): SubtitleSegment[] {
  if (!Array.isArray(body.segments)) throw new ApiError('자막 구간 배열이 없습니다.')
  return body.segments.map((value, index) => {
    const segment = object(value)
    const start = number(segment.start)
    const end = number(segment.end)
    if (end <= start) throw new ApiError('자막의 종료 시각이 시작 시각보다 늦어야 합니다.')
    const failed = segment.translation === null || segment.translation_error === 'translation_failed'
    return {
      id: `segment-${index}`, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000),
      sourceText: string(segment.text), targetText: failed ? null : string(segment.translation),
      status: failed ? 'translation_failed' : 'translated',
    }
  })
}

const jobPath = (id: string) => `/api/v1/jobs/${encodeURIComponent(id)}`

export const jobApiAdapter: ApiClient = {
  async getHealth(signal) {
    const body = await json('/health', { signal })
    if (typeof body.translation_model_loaded !== 'boolean' || typeof body.transcription_model_loaded !== 'boolean') throw new ApiError('모델 상태 응답이 올바르지 않습니다.')
    return { status: string(body.status), translation_model_loaded: body.translation_model_loaded, transcription_model_loaded: body.transcription_model_loaded } satisfies HealthResponse
  },
  async getCapabilities(signal) {
    const upload = object((await json('/api/v1/capabilities', { signal })).upload)
    if (!Array.isArray(upload.allowed_extensions) || !upload.allowed_extensions.length || !Array.isArray(upload.supported_languages)) throw new ApiError('업로드 규칙을 읽을 수 없습니다.')
    const result: UploadCapabilities = {
      allowed_extensions: upload.allowed_extensions.map(string), supported_languages: upload.supported_languages.map(string),
      max_upload_bytes: number(upload.max_upload_bytes), max_duration_seconds: number(upload.max_duration_seconds),
    }
    if (!result.max_upload_bytes || !result.max_duration_seconds || !result.supported_languages.includes('en')) throw new ApiError('서버가 영어 강의 업로드를 지원하지 않습니다.')
    return result
  },
  async submitLecture(file) {
    const body = new FormData()
    body.append('file', file)
    // Never retry POST automatically: a lost response may still have created a job.
    return normalizeJob(await json('/api/v1/jobs?language=en', { method: 'POST', body }, 0))
  },
  async getJob(id, signal) { return normalizeJob(await json(jobPath(id), { signal })) },
  async cancelJob(id) { return normalizeJob(await json(`${jobPath(id)}/cancel`, { method: 'POST' })) },
  async getSegments(id, signal) { return normalizeSegments(await json(`${jobPath(id)}/result`, { signal })) },
  async downloadSubtitles(id, language, format) {
    const response = await request(`${jobPath(id)}/subtitles?${new URLSearchParams({ language, format, download: 'true' })}`)
    return response.blob()
  },
}
