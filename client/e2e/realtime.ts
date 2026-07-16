import type { Page } from '@playwright/test'

export async function waitForRealtimeReady(page: Page, timeoutMs = 5_000) {
  await page.evaluate(
    (timeout) =>
      new Promise<void>((resolve, reject) => {
        const currentWindow = window as typeof window & { __mayeleRealtimeReadyAt?: number }

        if (currentWindow.__mayeleRealtimeReadyAt) {
          resolve()
          return
        }

        const timeoutId = window.setTimeout(() => {
          window.removeEventListener('mayele:realtime-ready', handleReady)
          reject(new Error('Realtime ready not observed'))
        }, timeout)

        function handleReady() {
          window.clearTimeout(timeoutId)
          window.removeEventListener('mayele:realtime-ready', handleReady)
          resolve()
        }

        window.addEventListener('mayele:realtime-ready', handleReady)
      }),
    timeoutMs,
  )
}
