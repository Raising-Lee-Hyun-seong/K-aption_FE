export type CaptionMode = 'ko' | 'en' | 'both'
export type DemoOutcome = 'complete' | 'partial' | 'empty' | 'failure'
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
  status: 'processing' | 'completed' | 'failed'
  stageIndex: number
  progressPercent: number
  segments: SubtitleSegment[]
}

export interface SubmitResult {
  jobId: string
}

export interface ApiClient {
  readonly mode: 'demo'
  submitLecture(file: File, glossaryId: string, outcome: DemoOutcome): Promise<SubmitResult>
  getJob(jobId: string): Promise<JobView>
  getSegments(jobId: string): Promise<SubtitleSegment[]>
}
