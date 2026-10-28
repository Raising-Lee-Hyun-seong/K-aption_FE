import { test, expect, type Page } from '@playwright/test'

const health = { status: 'ok', translation_model_loaded: true, transcription_model_loaded: false }
const capabilities = { upload: { allowed_extensions: ['.wav', '.mp4'], max_upload_bytes: 1073741824, max_duration_seconds: 5400, supported_languages: ['en'] } }
const status = (overrides = {}) => ({ job_id: 'job-test', status: 'running', stage: 'transcribing', progress_percent: null, completed_segments: 0, total_segments: null, failed_segments: 0, elapsed_seconds: 12, expires_at: null, ...overrides })
const result = { segments: [
  { start: 0, end: 1.5, text: 'The velocity is constant.', translation: '속도는 일정합니다.', translation_error: null },
  { start: 1.5, end: 3, text: 'The net force is zero.', translation: null, translation_error: 'translation_failed' },
] }

function wav() {
  const buffer = Buffer.alloc(44 + 16000 * 2 * 4)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40)
  return { name: 'lecture.wav', mimeType: 'audio/wav', buffer }
}
async function setup(page: Page) {
  await page.route('**/health', route => route.fulfill({ json: health }))
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: capabilities }))
  await page.goto('/')
  await expect(page.getByText(/서버 연결됨/)).toBeVisible()
}
async function upload(page: Page) {
  await page.locator('input[type=file]').setInputFiles(wav())
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeEnabled()
  await page.getByRole('button', { name: '번역 시작' }).click()
}

test('upload, nullable progress, partial results, seek, mode, download and restore', async ({ page }) => {
  let completed = false
  await setup(page)
  await page.route('**/api/v1/jobs?language=en', async route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=')
    expect(route.request().postDataBuffer()?.toString()).toContain('lecture.wav')
    await route.fulfill({ status: 202, json: status() })
  })
  await page.route('**/api/v1/jobs/job-test', route => route.fulfill({ json: completed ? status({ status: 'completed', stage: 'completed', progress_percent: 100, failed_segments: 1 }) : status() }))
  await page.route('**/api/v1/jobs/job-test/result', route => route.fulfill({ json: result }))
  await upload(page)
  await expect(page.getByText('이 단계에서는 진행률을 제공하지 않습니다.')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  completed = true
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: /00:01/ }).click()
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLMediaElement) => el.currentTime)).toBeCloseTo(1.5, 1)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('.caption-overlay')).toContainText('The net force is zero.')
  await expect(page.locator('.segment-card.current')).toContainText('원문 유지')
  await page.route('**/subtitles?*', async route => {
    expect(new URL(route.request().url()).searchParams.get('language')).toBe('en')
    await route.fulfill({ contentType: 'application/x-subrip', body: '1\n00:00:00,000 --> 00:00:01,500\nThe velocity is constant.\n' })
  })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SRT 다운로드' }).click()
  expect((await download).suggestedFilename()).toBe('captions-en.srt')
  await page.reload()
  await expect(page.getByText('재생하려면 동일한 원본 파일', { exact: false })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(wav())
  await expect(page.locator('audio')).toHaveCount(1)
})

test('cancelling waits for server confirmation', async ({ page }) => {
  await setup(page)
  let state = status()
  await page.route('**/api/v1/jobs?language=en', route => route.fulfill({ status: 202, json: state }))
  await page.route('**/api/v1/jobs/job-test', route => route.fulfill({ json: state }))
  await page.route('**/api/v1/jobs/job-test/cancel', route => {
    state = status({ status: 'cancelling' })
    return route.fulfill({ status: 202, json: state })
  })
  await upload(page)
  await page.getByRole('button', { name: '작업 취소', exact: true }).click()
  await expect(page.getByRole('heading', { name: '작업 취소를 기다리고 있어요' })).toBeVisible()
  state = status({ status: 'cancelled', stage: 'cancelled' })
  await expect(page.getByRole('heading', { name: '작업을 취소했어요' })).toBeVisible({ timeout: 10000 })
})

test('connection failure retains job and manual retry does not resubmit', async ({ page }) => {
  await setup(page)
  let submissions = 0, broken = true
  await page.route('**/api/v1/jobs?language=en', route => { submissions++; return route.fulfill({ status: 202, json: status() }) })
  await page.route('**/api/v1/jobs/job-test', route => broken ? route.abort() : route.fulfill({ json: status({ status: 'completed', stage: 'completed' }) }))
  await page.route('**/api/v1/jobs/job-test/result', route => route.fulfill({ json: { segments: [] } }))
  await upload(page)
  await expect(page.getByRole('button', { name: '상태 다시 확인' })).toBeVisible()
  broken = false
  await page.getByRole('button', { name: '상태 다시 확인' }).click()
  await expect(page.getByText('표시할 자막이 없어요')).toBeVisible()
  expect(submissions).toBe(1)
})

for (const [code, detail] of [[413, { detail: 'Too large' }], [422, { detail: [{ msg: 'Invalid audio' }] }], [503, 'Unavailable']] as const) {
  test(`HTTP ${code} errors are readable and never automatically resubmitted`, async ({ page }) => {
    await setup(page)
    let count = 0
    await page.route('**/api/v1/jobs?language=en', route => { count++; return route.fulfill({ status: code, body: typeof detail === 'string' ? detail : JSON.stringify(detail) }) })
    await upload(page)
    await expect(page.getByRole('heading', { name: '작업 접수를 확인하지 못했어요' })).toBeVisible()
    expect(count).toBe(1)
    await page.getByRole('button', { name: '다시 올리기' }).click()
    await expect(page.getByRole('button', { name: '번역 시작' })).toBeDisabled()
  })
}

test('mobile upload does not overflow and uses server extension rules', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') })
  await expect(page.getByRole('heading', { name: '올릴 수 없는 파일이에요' })).toBeVisible()
})

test('43 long subtitle pairs grow without clipping and keep English then Korean order', async ({ page }, testInfo) => {
  await setup(page)
  const segments = Array.from({ length: 43 }, (_, index) => ({
    start: index * 10, end: index * 10 + 9,
    text: index === 1 ? 'Short sentence.' : `${index + 1}. The following content is provided under a Creative Commons license. Your support will help MIT OpenCourseWare continue to offer high quality educational resources for free.\nVisit https://example.org/${'long-path'.repeat(12)}`,
    translation: index === 1 ? '짧은 문장입니다.' : `${index + 1}. 다음 내용은 크리에이티브 커먼즈 라이선스 하에 제공됩니다. 여러분의 후원은 양질의 교육 자료를 무료로 제공하는 데 도움이 됩니다.\n긴 자막도 마지막 문장까지 순서대로 표시되어야 합니다.`,
    translation_error: null,
  }))
  await page.route('**/api/v1/jobs?language=en', route => route.fulfill({ status: 202, json: status({ status: 'completed', stage: 'completed' }) }))
  await page.route('**/api/v1/jobs/job-test', route => route.fulfill({ json: status({ status: 'completed', stage: 'completed' }) }))
  await page.route('**/api/v1/jobs/job-test/result', route => route.fulfill({ json: { segments } }))
  await upload(page)
  await expect(page.locator('.segment-language-box')).toHaveCount(86)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await page.locator('.segment-scroll').evaluate(list => {
      const cards = [...list.querySelectorAll('.segment-card')]
      const boxes = [...list.querySelectorAll('.segment-language-box')]
      return {
        ordered: cards.every(card => card.children[0].classList.contains('source-box') && card.children[1].classList.contains('translation-box')),
        contained: boxes.every(box => [...box.children].every(child => {
          const outer = box.getBoundingClientRect(), inner = child.getBoundingClientRect()
          return inner.bottom <= outer.bottom + 1 && inner.right <= outer.right + 1
        })),
        noOverlap: cards.every((card, index) => index === 0 || card.getBoundingClientRect().top >= cards[index - 1].getBoundingClientRect().bottom),
        variedHeight: cards[0].getBoundingClientRect().height > cards[1].getBoundingClientRect().height,
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
      }
    })
    expect(layout).toEqual({ ordered: true, contained: true, noOverlap: true, variedHeight: true, noPageOverflow: true })
    await page.locator('.segment-card').last().scrollIntoViewIfNeeded()
    await expect(page.locator('.segment-card').last().locator('.segment-target')).toBeInViewport()
    await page.locator('.segment-card').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`subtitle-pairs-${width}.png`) })
  }
})
