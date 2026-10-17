import type { ApiClient, DemoOutcome, JobView, SubtitleSegment } from '../types'

export const stages = ['음성 추출', '영어 음성 인식', '문맥·용어집 처리', '한국어 번역', '자막 생성'] as const

const baseSegments: SubtitleSegment[] = [
  { id: 's1', startMs: 0, endMs: 4500, sourceText: 'Hello everyone, and welcome to the lecture.', targetText: '여러분, 안녕하세요. 강의에 오신 것을 환영합니다.', status: 'translated' },
  { id: 's2', startMs: 4500, endMs: 9500, sourceText: "Let's plug this back into the equation.", targetText: '이 결과를 원래 식에 다시 대입해 봅시다.', status: 'translated' },
  { id: 's3', startMs: 9500, endMs: 14500, sourceText: 'The eigenvalue tells us how the vector changes.', targetText: '고유값은 벡터가 어떻게 변하는지 알려줍니다.', status: 'low_confidence' },
  { id: 's4', startMs: 14500, endMs: 19500, sourceText: "So that's the trick behind this step.", targetText: '이 단계의 핵심은 바로 이것입니다.', status: 'translated' },
  { id: 's5', startMs: 19500, endMs: 24500, sourceText: 'Now we can move on to the next example.', targetText: '이제 다음 예제로 넘어가겠습니다.', status: 'translated' },
]

type MockJob = { createdAt: number; outcome: DemoOutcome; glossaryId: string; fileName: string }
const jobs = new Map<string, MockJob>()
const STAGE_MS = 1250

function segmentsFor(outcome: DemoOutcome): SubtitleSegment[] {
  if (outcome === 'empty') return []
  const segments = baseSegments.map((segment) => ({ ...segment }))
  if (outcome === 'partial') {
    segments[3] = { ...segments[3], targetText: null, status: 'translation_failed' }
  }
  return segments
}

export const mockAdapter: ApiClient = {
  mode: 'demo',
  async submitLecture(file, glossaryId, outcome) {
    const jobId = crypto.randomUUID()
    jobs.set(jobId, { createdAt: Date.now(), outcome, glossaryId, fileName: file.name })
    return { jobId }
  },
  async getJob(jobId): Promise<JobView> {
    const job = jobs.get(jobId)
    if (!job) throw new Error('데모 작업을 찾을 수 없어요. 파일을 다시 올려 주세요.')
    const elapsed = Date.now() - job.createdAt
    const stageIndex = Math.min(stages.length - 1, Math.floor(elapsed / STAGE_MS))
    const progressPercent = Math.min(100, Math.round((elapsed / (stages.length * STAGE_MS)) * 100))
    const finished = progressPercent === 100
    return {
      id: jobId,
      status: finished ? (job.outcome === 'failure' ? 'failed' : 'completed') : 'processing',
      stageIndex,
      progressPercent,
      segments: finished ? segmentsFor(job.outcome) : [],
    }
  },
  async getSegments(jobId) {
    const job = jobs.get(jobId)
    if (!job) throw new Error('데모 작업을 찾을 수 없어요. 파일을 다시 올려 주세요.')
    return segmentsFor(job.outcome)
  },
}
