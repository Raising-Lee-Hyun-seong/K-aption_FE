export type CaptionMode = 'ko' | 'en' | 'both'
export type SegmentStatus = 'translated' | 'low_confidence' | 'recognition_failed' | 'translation_failed' | 'source_only'

export interface SubtitleSegment {
  id: string
  startMs: number
  endMs: number
  sourceText: string
  targetText: string | null
  status: SegmentStatus
}

export interface JobView {
  id: string
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  stage: 'queued' | 'transcribing' | 'grouping' | 'translating' | 'cancelled' | 'completed' | 'failed'
  progressPercent: number | null
  completedSegments: number
  totalSegments: number | null
  failedSegments: number
  elapsedSeconds: number
  expiresAt: string | null
  error: { code: string; message: string } | null
}

export interface HealthResponse {
  status: string
  translation_model_loaded: boolean
  transcription_model_loaded: boolean
}

export interface UploadCapabilities {
  allowed_extensions: string[]
  max_upload_bytes: number
  max_duration_seconds: number
  supported_languages: string[]
}

export interface ApiClient {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>
  getCapabilities(signal?: AbortSignal): Promise<UploadCapabilities>
  submitLecture(file: File): Promise<JobView>
  getJob(jobId: string, signal?: AbortSignal): Promise<JobView>
  cancelJob(jobId: string): Promise<JobView>
  getSegments(jobId: string, signal?: AbortSignal): Promise<SubtitleSegment[]>
  downloadSubtitles(jobId: string, language: CaptionMode, format: 'srt' | 'vtt'): Promise<Blob>
}
