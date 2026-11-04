import { test, expect, type Page } from '@playwright/test'

// 20초짜리 무음 WAV: 단축키로 5초 이동을 확인할 만큼 길어야 한다.
function wav(seconds = 20) {
  const bytes = 16000 * 2 * seconds
  const buffer = Buffer.alloc(44 + bytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40)
  return { name: 'ux.wav', mimeType: 'audio/wav', buffer }
}
const done = { job_id: 'ux-job', status: 'completed', stage: 'completed', progress_percent: 100, completed_segments: 3, total_segments: 3, failed_segments: 0, elapsed_seconds: 30, expires_at: null }
const result = { segments: [
  { start: 0, end: 5, text: 'Velocity is a vector.', translation: '속도는 벡터입니다.', translation_error: null },
  { start: 5, end: 10, text: 'Acceleration changes velocity.', translation: '가속도는 속도를 바꿉니다.', translation_error: null },
  { start: 10, end: 15, text: 'Mass resists acceleration.', translation: '질량은 가속에 저항합니다.', translation_error: null },
] }

async function openWatch(page: Page) {
  await page.route('**/health', route => route.fulfill({ json: { status: 'ok', translation_model_loaded: true, transcription_model_loaded: true } }))
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { upload: { allowed_extensions: ['.wav'], max_upload_bytes: 1073741824, max_duration_seconds: 5400, supported_languages: ['en'] } } }))
  await page.route('**/api/v1/jobs?language=en', route => route.fulfill({ status: 202, json: done }))
  await page.route('**/api/v1/jobs/ux-job', route => route.fulfill({ json: done }))
  await page.route('**/api/v1/jobs/ux-job/result', route => route.fulfill({ json: result }))
  await page.goto('/')
  await expect(page.getByText(/서버 연결됨/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(wav())
  await page.getByRole('button', { name: '번역 시작' }).click()
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible({ timeout: 10000 })
}
const currentTime = (page: Page) => page.locator('audio').evaluate((el: HTMLMediaElement) => el.currentTime)

test('upload area says it can be clicked before hovering', async ({ page }) => {
  await page.route('**/health', route => route.fulfill({ json: { status: 'ok', translation_model_loaded: true, transcription_model_loaded: true } }))
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { upload: { allowed_extensions: ['.wav'], max_upload_bytes: 1073741824, max_duration_seconds: 5400, supported_languages: ['en'] } } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /클릭해서 선택/ })).toBeVisible()
  await expect(page.locator('.pick-hint')).toBeVisible()
  const border = await page.locator('.dropzone').evaluate(el => getComputedStyle(el).borderTopColor)
  expect(border).not.toBe('rgba(0, 0, 0, 0)')
})

test('keyboard shortcuts seek by 5 seconds and are ignored while typing in search', async ({ page }) => {
  await openWatch(page)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => currentTime(page)).toBeCloseTo(10, 0)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0)
  await page.getByLabel('자막 검색').fill('mass')
  await page.keyboard.press('ArrowLeft')
  expect(await currentTime(page)).toBeCloseTo(5, 0)
})

test('speed, volume and mute change the media element', async ({ page }) => {
  await openWatch(page)
  await page.getByLabel('배속').selectOption('1.5')
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLMediaElement) => el.playbackRate)).toBe(1.5)
  await page.getByRole('button', { name: '음소거', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLMediaElement) => el.muted)).toBe(true)
  await page.getByRole('button', { name: '음소거 해제' }).click()
  await expect.poll(() => page.locator('audio').evaluate((el: HTMLMediaElement) => el.muted)).toBe(false)
})

test('subtitle list can be hidden, remembered and shown again', async ({ page }) => {
  await openWatch(page)
  await page.getByRole('button', { name: '자막 목록 숨기기' }).click()
  await expect(page.getByRole('heading', { name: '자막 목록' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '자막 목록 보기' })).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: '자막 목록 보기' }).click()
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible()
})

test('search filters by English or Korean text, highlights and seeks', async ({ page }) => {
  await openWatch(page)
  const search = page.getByLabel('자막 검색')
  await search.fill('VELOCITY')
  await expect(page.locator('.segment-card')).toHaveCount(2)
  await expect(page.locator('.segment-card mark').first()).toHaveText('Velocity')
  await search.fill('질량')
  await expect(page.locator('.segment-card')).toHaveCount(1)
  await page.locator('.segment-card').click()
  await expect.poll(() => currentTime(page)).toBeCloseTo(10, 0)
  await search.fill('friction')
  await expect(page.getByText("'friction'이(가) 들어간 자막이 없어요.")).toBeVisible()
  await search.press('Escape')
  await expect(page.locator('.segment-card')).toHaveCount(3)
})

test('one download button lets the user pick language and format', async ({ page }) => {
  await openWatch(page)
  let requested: URLSearchParams | null = null
  await page.route('**/subtitles?*', async route => {
    requested = new URL(route.request().url()).searchParams
    await route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n' })
  })
  await expect(page.getByRole('button', { name: 'SRT 다운로드' })).toHaveCount(0)
  await page.getByRole('button', { name: /자막 다운로드/ }).click()
  await expect(page.getByRole('button', { name: '다운로드 언어 한국어' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '다운로드 언어 한·영' }).click()
  await page.getByRole('button', { name: /^VTT/ }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '다운로드', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('captions-both.vtt')
  expect(requested!.get('language')).toBe('both')
  expect(requested!.get('format')).toBe('vtt')
  await expect(page.locator('#download-panel')).toHaveCount(0)
})

test('mobile watch page has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openWatch(page)
  await page.getByRole('button', { name: /자막 다운로드/ }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
