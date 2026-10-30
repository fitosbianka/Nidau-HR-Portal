'use client'

// Mitarbeiter-Anekdoten fürs Teamevent (befristet bis 16.10.). Gleiche Box
// für die Leitenden (auf ihrer Startseite) und den Admin (Startseite,
// sieht alle Einträge). Sichtbarkeit pro Eintrag: alle Leitenden oder nur
// der Admin. Erfasserin und Datum stehen bei jedem Eintrag.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addAnekdote, deleteAnekdote, deleteAnekdotenNachExport } from '@/actions/anekdoten'
import type { Anekdote, AnekdoteSicht } from '@/lib/anekdoten'

function fmtCH(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`
}

export default function AnekdotenBox({
  items, meId, isAdmin, nameVorschlaege,
}: {
  items: Anekdote[]
  meId: string
  isAdmin: boolean
  nameVorschlaege: string[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [ueber, setUeber] = useState('')
  const [text, setText] = useState('')
  const [sicht, setSicht] = useState<AnekdoteSicht>('leitende')
  const [busy, setBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  /** Alle Anekdoten als PDF herunterladen, danach genau diese Einträge von der Seite entfernen. */
  async function exportieren() {
    if (busy || exportBusy || items.length === 0) return
    if (!confirm(`${items.length} Anekdote${items.length === 1 ? '' : 'n'} als PDF herunterladen? Nach dem Download werden sie von dieser Seite entfernt.`)) return
    setExportBusy(true); setError(null); setOkMsg(null)
    try {
      const r = await fetch('/api/anekdoten-pdf', { cache: 'no-store' })
      if (!r.ok) throw new Error('http')
      const keys = (r.headers.get('X-Anekdoten-Keys') ?? '').split(',').filter(Boolean)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Anekdoten_Teamevent_${new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      const res = await deleteAnekdotenNachExport(keys)
      if ('error' in res && res.error) setError(`PDF heruntergeladen, aber das Entfernen ist fehlgeschlagen: ${res.error}`)
      else { setOkMsg(`✓ PDF heruntergeladen, ${(res as { anzahl: number }).anzahl} Anekdote${(res as { anzahl: number }).anzahl === 1 ? '' : 'n'} von der Seite entfernt.`); router.refresh() }
    } catch {
      setError('Der Export ist fehlgeschlagen, es wurde nichts entfernt. Bitte erneut versuchen.')
    }
    setExportBusy(false)
  }

  function speichern() {
    if (busy) return
    setBusy(true); setError(null); setOkMsg(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try { res = await addAnekdote(ueber, text, sicht) }
      catch { res = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (res?.error) setError(res.error)
      else {
        setUeber(''); setText(''); setSicht('leitende')
        setOkMsg('✓ Anekdote gespeichert — danke!')
        router.refresh()
      }
      setBusy(false)
    })
  }

  function loeschen(a: Anekdote) {
    if (!confirm(`Anekdote über ${a.ueber} wirklich löschen?`)) return
    setBusy(true); setError(null); setOkMsg(null)
    startTransition(async () => {
      let res: { error?: string } | undefined
      try { res = await deleteAnekdote(a.key) }
      catch { res = { error: 'Netzwerkfehler — bitte erneut versuchen.' } }
      if (res?.error) setError(res.error)
      else router.refresh()
      setBusy(false)
    })
  }

  const inputCls = 'w-full px-2.5 py-2 text-sm border border-edge-ctl rounded-ctl bg-white focus:outline-none focus:ring-1 focus:ring-dusk placeholder:text-ink-5'

  return (
    <div className="card overflow-hidden border-lilac-ink/25">
      <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink-2">Mitarbeiter-Anekdoten fürs Teamevent</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && items.length > 0 && (
            <button onClick={exportieren} disabled={exportBusy || busy} className="btn-secondary !px-3 !py-1.5 !text-xs"
              title="Alle Anekdoten als PDF herunterladen. Nach dem Download werden sie von der Seite entfernt.">
              {exportBusy ? 'Exportiert…' : '⬇ Als PDF exportieren und entfernen'}
            </button>
          )}
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-lilac-bg text-lilac-ink text-[11px] font-semibold">
            Befristete Aufgabe — bis 16.10.
          </span>
        </div>
      </div>

      <div className="px-6 py-4 space-y-3 border-b border-edge-soft bg-surface">
        <p className="text-xs text-ink-3">
          An unserem Teamevent im Oktober spielen wir ein Spiel darüber, wie gut sich die
          Teammitglieder gegenseitig kennen. Dafür brauchen wir besondere Anekdoten,
          Eigenschaften und Gewohnheiten der einzelnen Mitarbeiterinnen — alles, was sie
          unverwechselbar macht. Bitte pro Eintrag angeben, über wen er ist, und wählen,
          wer ihn sehen darf.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="field-label">Über wen?</p>
            <input type="text" value={ueber} onChange={e => setUeber(e.target.value)}
              placeholder="Name der Mitarbeiterin" maxLength={80} list="anekdote-namen" className={inputCls} />
            <datalist id="anekdote-namen">
              {nameVorschlaege.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <p className="field-label">Wer darf sie sehen?</p>
            <div className="flex flex-col gap-1.5 py-1 text-sm text-ink-2">
              <label className="flex items-center gap-2">
                <input type="radio" name="anekdote-sicht" checked={sicht === 'leitende'} onChange={() => setSicht('leitende')} />
                Alle Leitenden und Bianka
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="anekdote-sicht" checked={sicht === 'admin'} onChange={() => setSicht('admin')} />
                Nur Bianka (Admin)
              </label>
            </div>
          </div>
        </div>
        <div>
          <p className="field-label">Anekdote</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={1000}
            placeholder="z.B. Wer trägt in der Praxis immer Birkenstock? (Laura) — Wer ist die Königin des Birchermüsli? (Valérie)" className={inputCls} />
        </div>
        {error && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink">⚠ {error}</p>}
        {okMsg && <p className="text-xs px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink">{okMsg}</p>}
        <button onClick={speichern} disabled={busy || !ueber.trim() || !text.trim()} className="btn-primary text-xs px-4 py-2">
          {busy ? 'Speichert…' : 'Anekdote speichern'}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="px-6 py-4 text-sm text-ink-4">Noch keine {isAdmin ? 'Anekdoten erfasst.' : 'sichtbaren Anekdoten.'}</p>
      ) : (
        <ul className="divide-y divide-edge-row">
          {items.map(a => (
            <li key={a.key} className="px-6 py-3.5">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {a.ueber}
                    <span className={`ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold align-middle ${a.sicht === 'admin' ? 'bg-blush-bg text-blush-ink' : 'bg-mint-bg text-mint-ink'}`}>
                      {a.sicht === 'admin' ? 'nur Bianka' : 'alle Leitenden'}
                    </span>
                  </p>
                  <p className="text-sm text-ink-2 mt-1 whitespace-pre-wrap break-words">{a.text}</p>
                  <p className="text-[11px] text-ink-4 mt-1.5">von {a.von} · am {fmtCH(a.am)}</p>
                </div>
                {(isAdmin || a.vonId === meId) && (
                  <button onClick={() => loeschen(a)} disabled={busy}
                    className="p-1.5 rounded-lg border border-edge-ctl bg-white text-ink-4 hover:text-red-500 hover:bg-edge-row transition-colors flex-shrink-0"
                    title="Anekdote löschen">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
