// ZIP Export aller Fotos eines Teamevents im Browser der Organisatorin:
// die Liste mit signierten Links kommt vom Server, die Dateien werden
// nacheinander geholt und mit JSZip verpackt (JPEG wird nicht weiter
// komprimiert). So gibt es keine Zeitlimite auf dem Server.

import { bingoZipListe } from '@/actions/teamevent-bingo'

export type ZipErgebnis = { ok: true; anzahl: number } | { ok: false; fehler: string }

export async function zipHerunterladen(slug: string, dateiname: string, onFortschritt: (text: string) => void): Promise<ZipErgebnis> {
  onFortschritt('Liste wird geholt')
  const r = await bingoZipListe(slug)
  if ('error' in r && r.error) return { ok: false, fehler: r.error }
  return zipAusDateien((r as { dateien: Array<{ pfad: string; url: string }> }).dateien, dateiname, onFortschritt)
}

/** Dateien mit signierten Links nacheinander holen und als ZIP speichern
 *  (auch für das Fotoalbum, dort für alle Mitarbeitenden). */
export async function zipAusDateien(dateien: Array<{ pfad: string; url: string }>, dateiname: string, onFortschritt: (text: string) => void): Promise<ZipErgebnis> {
  if (dateien.length === 0) return { ok: false, fehler: 'Es gibt noch keine Fotos.' }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  let n = 0, fehler = 0
  for (const d of dateien) {
    n++
    onFortschritt(`Foto ${n} von ${dateien.length}`)
    try {
      const res = await fetch(d.url)
      if (!res.ok) throw new Error(String(res.status))
      zip.file(d.pfad, await res.blob(), { compression: 'STORE' })
    } catch {
      fehler++
    }
  }
  onFortschritt('ZIP wird erstellt')
  const blob = await zip.generateAsync({ type: 'blob' })
  const obj = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = obj; a.download = dateiname; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(obj), 60_000)
  if (fehler > 0) return { ok: false, fehler: `${dateien.length - fehler} Fotos verpackt, ${fehler} konnten nicht geladen werden. Bitte nochmals versuchen.` }
  return { ok: true, anzahl: dateien.length }
}
