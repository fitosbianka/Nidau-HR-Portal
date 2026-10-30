// Reliable open/download of files on desktop AND mobile, including the
// portal installed as a home-screen app: window.open only works when it is
// called synchronously inside the tap handler — on the phone a window.open
// AFTER an await is silently blocked. So a placeholder tab is opened FIRST
// (still inside the tap) and pointed at the file once it is ready; if even
// that was blocked, the current tab navigates to the file instead.

export type FileWindow = {
  /** Point the placeholder tab at the ready file URL. */
  show: (url: string) => void
  /** Close the placeholder tab again (e.g. after an error). */
  cancel: () => void
}

/** Call synchronously at the START of the click handler, before any await. */
export function openFileWindow(): FileWindow {
  let win: Window | null = null
  try {
    win = window.open('', '_blank')
    win?.document.write(
      '<title>Dokument</title><p style="font-family:-apple-system,sans-serif;color:#666;padding:24px">Dokument wird geladen…</p>',
    )
  } catch { win = null }
  return {
    show(url: string) {
      if (win && !win.closed) win.location.replace(url)
      else window.location.assign(url)
    },
    cancel() { try { win?.close() } catch { /* ignore */ } },
  }
}

/** Download a generated file. Blob URLs are same-origin, so the download
 *  attribute is honoured everywhere (unlike on cross-origin storage URLs). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
