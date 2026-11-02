import { test, expect, type Page } from '@playwright/test'

const HOUR = 3600000
const base = Date.parse('2026-11-01T01:00:00Z')
function wav() {
  const buffer = Buffer.alloc(44 + 32000)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(32000, 40)
  return { name: 'cached.wav', mimeType: 'audio/wav', buffer }
}
async function prepare(page: Page, getState: () => object) {
  await page.clock.install({ time: base })
  await page.context().route('**/health', route => route.fulfill({ json: { status: 'ok', translation_model_loaded: true, transcription_model_loaded: true } }))
  await page.context().route('**/api/v1/capabilities', route => route.fulfill({ json: { upload: { allowed_extensions: ['.wav'], max_upload_bytes: 1073741824, max_duration_seconds: 5400, supported_languages: ['en'] } } }))
  await page.context().route('**/api/v1/jobs?language=en', route => route.fulfill({ status: 202, json: getState() }))
  await page.context().route('**/api/v1/jobs/cache-job', route => route.fulfill({ json: getState() }))
  await page.context().route('**/api/v1/jobs/cache-job/result', route => route.fulfill({ json: { segments: [{ start: 0, end: 1, text: 'Hello.', translation: '안녕하세요.', translation_error: null }] } }))
  await page.goto('/')
  await expect(page.getByText(/서버 연결됨/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(wav())
  await page.getByRole('button', { name: '번역 시작' }).click()
}
const state = (status = 'completed', updated = base) => ({ job_id: 'cache-job', status, stage: status === 'running' ? 'transcribing' : status, updated_at: new Date(updated).toISOString(), progress_percent: status === 'completed' ? 100 : null })
async function rows(page: Page) {
  return page.evaluate(() => new Promise<{ metadata: { deleteAt: number | null }[]; count: number }>((resolve, reject) => {
    const request = indexedDB.open('kaption-media', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['metadata', 'media'], 'readonly')
      const metadata = tx.objectStore('metadata').getAll(), count = tx.objectStore('media').count()
      tx.oncomplete = () => { db.close(); resolve({ metadata: metadata.result, count: count.result }) }
    }
  }))
}

test('keeping a tab open preserves media for hours and refresh restores it', async ({ page }) => {
  await prepare(page, () => state())
  await expect(page.locator('audio')).toHaveCount(1)
  await page.clock.fastForward(3 * HOUR)
  expect((await rows(page)).count).toBe(1)
  await page.reload()
  await expect(page.locator('audio')).toHaveCount(1)
  expect((await rows(page)).count).toBe(1)
})

test('return within 30 minutes restores media and cancels the old countdown', async ({ page }) => {
  await prepare(page, () => state())
  await expect(page.locator('audio')).toHaveCount(1)
  await page.goto('about:blank')
  await page.clock.setSystemTime(base + 20 * 60000)
  await page.goto('/')
  await expect(page.locator('audio')).toHaveCount(1)
  await page.clock.fastForward(HOUR)
  expect((await rows(page)).count).toBe(1)
  await page.goto('about:blank')
  await page.clock.setSystemTime(base + 100 * 60000)
  await page.goto('/')
  await expect(page.locator('audio')).toHaveCount(1)
})

test('return after last tab has been closed for 30 minutes deletes before restoration', async ({ page }) => {
  await prepare(page, () => state())
  await expect(page.locator('audio')).toHaveCount(1)
  await page.goto('about:blank')
  await page.clock.setSystemTime(base + 31 * 60000)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible()
  expect((await rows(page)).count).toBe(0)
  await expect(page.locator('audio')).toHaveCount(0)
})

test('closing one tab does not expire media while another tab is still open', async ({ page, context }) => {
  await prepare(page, () => state())
  await expect(page.locator('audio')).toHaveCount(1)
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.locator('audio')).toHaveCount(1)
  await page.goto('about:blank')
  await other.clock.fastForward(2 * HOUR)
  await page.goto('/')
  await expect(page.locator('audio')).toHaveCount(1)
  expect((await rows(page)).count).toBe(1)
  await other.close()
})

test('closed during translation still uses the last-tab-close deadline', async ({ page }) => {
  let current = state('running')
  await prepare(page, () => current)
  await expect.poll(async () => (await rows(page)).count).toBe(1)
  await page.goto('about:blank')
  current = state('completed', base + 10000)
  await page.clock.setSystemTime(base + HOUR)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible()
  expect((await rows(page)).count).toBe(0)
})

test('cancelled job removes original immediately', async ({ page }) => {
  let current = state('running')
  await prepare(page, () => current)
  await expect.poll(async () => (await rows(page)).count).toBe(1)
  current = state('cancelled')
  await page.clock.fastForward(30000)
  await expect(page.getByRole('heading', { name: '작업을 취소했어요' })).toBeVisible()
  expect((await rows(page)).count).toBe(0)
})

test('unavailable browser storage shows warning without blocking translation', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Storage disabled', 'QuotaExceededError') } })
  await prepare(page, () => state())
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(page.getByText(/저장하지 못했습니다|Storage disabled|저장소에 접근하지 못했습니다/)).toBeVisible()
})
