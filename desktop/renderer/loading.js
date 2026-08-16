/**
 * Loading / offline screen logic. Talks to the main process through the
 * `window.dshDesktop` bridge; when the backend is ready the main process
 * replaces this page with the DSH web UI.
 */

'use strict'

const statusEl = document.getElementById('status')
const dotsEl = document.getElementById('dots')
const retryEl = document.getElementById('retry')
const hintEl = document.getElementById('hint')

const dsh = window.dshDesktop

function render(status) {
  const busy = status.status === 'starting'
  const failed = status.status === 'error' || status.status === 'blocked'

  statusEl.textContent = status.message || status.status
  statusEl.classList.toggle('error', failed)
  dotsEl.hidden = !busy
  retryEl.hidden = !failed
  hintEl.hidden = !failed
  if (failed && status.status === 'blocked') {
    hintEl.textContent = '请关闭占用端口的程序后重试'
  } else if (failed) {
    hintEl.textContent = '可查看 D:\\path\\to\\deepseek-harness\\logs\\desktop-background.log'
  }
}

dsh.backend.onStatus(render)
dsh.backend.status().then(render).catch(() => {})
retryEl.addEventListener('click', () => {
  statusEl.classList.remove('error')
  dsh.backend.retry()
})
