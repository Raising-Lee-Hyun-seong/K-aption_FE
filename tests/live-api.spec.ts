import { test, expect } from '@playwright/test'

// Opt-in: sends a real file to the configured Docker backend and runs inference.
test('Docker backend: upload -> job -> real subtitles -> download', async ({ page }, testInfo) => {
  test.skip(!process.env.KAPTION_LIVE_MEDIA, 'Set KAPTION_LIVE_MEDIA to an English audio/video file to run real inference.')
  test.setTimeout(360000)
  await page.goto('/')
  await expect(page.getByText(/서버 연결됨/)).toBeVisible({ timeout: 30000 })
  await page.screenshot({ path: testInfo.outputPath('upload.png'), fullPage: true })
  await page.locator('input[type=file]').setInputFiles(process.env.KAPTION_LIVE_MEDIA!)
  const submitted = page.waitForResponse(response => response.url().includes('/api/v1/jobs?') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '번역 시작' }).click()
  const response = await submitted
  expect(response.status()).toBe(202)
  const received = await response.json()
  await testInfo.attach('submitted-job', { body: JSON.stringify(received, null, 2), contentType: 'application/json' })
  const terminal = page.getByRole('heading', { name: /자막 목록|자막을 만들지 못했어요|작업을 찾을 수 없어요/ })
  await expect(terminal).toBeVisible({ timeout: 300000 })
  await expect(page.getByRole('heading', { name: '자막 목록' })).toBeVisible()
  const result = await page.request.get(`/api/v1/jobs/${received.job_id}/result`)
  expect(result.ok()).toBe(true)
  const payload = await result.json()
  expect(payload.segments.length).toBeGreaterThan(0)
  await testInfo.attach('actual-result', { body: JSON.stringify(payload, null, 2), contentType: 'application/json' })
  await page.screenshot({ path: testInfo.outputPath('watch-desktop.png'), fullPage: true })
  for (const format of ['SRT', 'VTT']) {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: `${format} 다운로드` }).click()
    expect((await download).suggestedFilename()).toBe(`captions-ko.${format.toLowerCase()}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('watch-mobile.png'), fullPage: true })
})
