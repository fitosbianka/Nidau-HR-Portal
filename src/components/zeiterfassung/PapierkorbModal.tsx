'use client'

// Papierkorb: gelöschte Stempel-Einträge eines Monats ansehen und pro Tag
// wiederherstellen (admin only). Gelöscht wird nie endgültig — weder im
// Portal noch durch den TimeMoto-Sync.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getGeloeschteEintraege, eintraegeWiederherstellen, sucheRohEintraege, type GeloeschterTag, type RohEintrag } from '@/actions/papierkorb'

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

function fmtCH(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`
}

export default function PapierkorbModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [monat, setMonat] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }).slice(0, 7))
  const [tage, setTage] = useState<GeloeschterTag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  // Detailsuche (Forensik): alle Roh-Einträge, auch aktive
  const [sucheName, setSucheName] = useState('')
  const [sucheVon, setSucheVon] = useState('')
  const [sucheBis, setSucheBis] = useState('')
  const [sucheRows, setSucheRows] = useState<RohEintrag[] | null>(null)
  const [sucheBusy, setSucheBusy] = useState(false)
  const [sucheError, setSucheError] = useState<string | null>(null)
  const [sucheAbgeschnitten, setSucheAbgeschnitten] = useState(false)

  async function detailSuchen() {
    setSucheBusy(true); setSucheError(null); setSucheRows(null); setSucheAbgeschnitten(false)
    try {
      const res = await sucheRohEintraege(sucheName, sucheVon, sucheBis)
      if (res.error) setSucheError(res.error)
      else { setSucheRows(res.rows ?? []); setSucheAbgeschnitten(!!res.abgeschnitten) }
    } catch { setSucheError('Netzwerkfehler — bitte erneut versuchen.') }
    setSucheBusy(false)
  }

  useEffect(() => {
    let alive = true
    setTage(null); setError(null)
    getGeloeschteEintraege(monat)
      .then(res => { if (alive) { if (res.error) setError(res.error); else setTage(res.tage ?? []) } })
      .catch(() => { if (alive) setError('Netzwerkfehler — bitte erneut versuchen.') })
    return () => { alive = false }
  }, [monat])

  async function wiederherstellen(t: GeloeschterTag) {
    if (!confirm(`${t.zeiten.length} gelöschte ${t.zeiten.length === 1 ? 'Eintrag' : 'Einträge'} von ${t.name} am ${fmtCH(t.datum)} wiederherstellen?\nSie erscheinen danach wieder in allen Berichten und Konten.`)) return
    setBusyKey(`${t.name}|${t.datum}`); setError(null); setOkMsg(null)
    try {
      const res = await eintraegeWiederherstellen(t.ids)
      if (res?.error) setError(res.error)
      else {
        setOkMsg(`✓ ${t.name}, ${fmtCH(t.datum)} wiederhergestellt.`)
        const neu = await getGeloeschteEintraege(monat)
        if (!neu.error) setTage(neu.tage ?? [])
        router.refresh()
      }
    } catch { setError('Wiederherstellen fehlgeschlagen — bitte erneut versuchen.') }
    setBusyKey(null)
  }

  const [jahrStr, monStr] = monat.split('-')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-edge-soft flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-ink">Papierkorb — gelöschte Stempel-Einträge</h3>
            <p className="text-xs text-ink-4 mt-0.5">Gelöschte Zeiten bleiben in der Datenbank und lassen sich hier pro Tag zurückholen.</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none" aria-label="Schliessen">×</button>
        </div>
        <div className="px-6 py-3 border-b border-edge-soft flex items-center gap-2 flex-shrink-0">
          <select value={monStr} onChange={e => setMonat(`${jahrStr}-${e.target.value}`)}
            className="px-2.5 py-1.5 text-sm border border-edge-ctl rounded-ctl bg-white">
            {MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
          </select>
          <select value={jahrStr} onChange={e => setMonat(`${e.target.value}-${monStr}`)}
            className="px-2.5 py-1.5 text-sm border border-edge-ctl rounded-ctl bg-white">
            {['2025', '2026', '2027'].map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div className="overflow-y-auto px-6 py-3">
          {error && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink mb-2">⚠ {error}</p>}
          {okMsg && <p className="text-xs px-3 py-2 rounded-ctl bg-mint-bg text-mint-ink mb-2">{okMsg}</p>}
          {tage === null && !error ? (
            <p className="text-xs text-ink-4 py-4">Wird geladen…</p>
          ) : (tage ?? []).length === 0 ? (
            <p className="text-sm text-ink-4 py-4">In diesem Monat gibt es keine gelöschten Stempel-Einträge.</p>
          ) : (
            <ul className="divide-y divide-edge-row">
              {(tage ?? []).map(t => (
                <li key={`${t.name}|${t.datum}`} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm font-semibold text-ink">{t.name} · <span className="tnum">{fmtCH(t.datum)}</span></p>
                    <p className="text-xs text-ink-3 mt-0.5 tnum">{t.zeiten.join(' · ')}</p>
                    {t.geloeschtAm && <p className="text-[11px] text-ink-4 mt-0.5">gelöscht am {fmtCH(t.geloeschtAm)}</p>}
                    {t.konflikt && (
                      <p className="text-[11px] font-semibold text-apricot-ink mt-0.5">
                        TimeMoto-Bearbeitungs-Versuch — die Original-Zeit ist noch aktiv, Wiederherstellen würde doppelt zählen.
                      </p>
                    )}
                  </div>
                  <button onClick={() => wiederherstellen(t)}
                    disabled={busyKey === `${t.name}|${t.datum}` || t.konflikt}
                    title={t.konflikt ? 'Gesperrt: zu diesem Stempel existiert bereits eine aktive Version' : undefined}
                    className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0 disabled:opacity-50">
                    {busyKey === `${t.name}|${t.datum}` ? 'Stellt wieder her…' : 'Wiederherstellen'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* ── Detailsuche: alle Roh-Einträge (aktiv & gelöscht) ── */}
          <div className="mt-4 pt-4 border-t border-edge-soft">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-2">
              Detailsuche — alle Roh-Einträge einer Person (aktiv und gelöscht)
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <p className="field-label">Name (Teil genügt)</p>
                <input type="text" value={sucheName} onChange={e => setSucheName(e.target.value)}
                  placeholder="z.B. Zorana" className="w-full px-2.5 py-1.5 text-sm border border-edge-ctl rounded-ctl bg-white" />
              </div>
              <div>
                <p className="field-label">Von</p>
                <input type="date" value={sucheVon} onChange={e => setSucheVon(e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-edge-ctl rounded-ctl bg-white" />
              </div>
              <div>
                <p className="field-label">Bis</p>
                <input type="date" value={sucheBis} onChange={e => setSucheBis(e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-edge-ctl rounded-ctl bg-white" />
              </div>
              <button onClick={detailSuchen} disabled={sucheBusy} className="btn-secondary text-xs px-3 py-2">
                {sucheBusy ? 'Sucht…' : 'Suchen'}
              </button>
            </div>
            {sucheError && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink mt-2">⚠ {sucheError}</p>}
            {sucheAbgeschnitten && (
              <p className="text-xs px-3 py-2 rounded-ctl bg-apricot-bg text-apricot-ink mt-2">
                ⚠ Mehr als 1000 Einträge im Zeitraum — die Liste ist unvollständig (das Ende fehlt). Bitte Namen präzisieren oder den Zeitraum verkleinern.
              </p>
            )}
            {sucheRows !== null && (
              sucheRows.length === 0 ? (
                <p className="text-sm text-ink-4 mt-2">Keine Roh-Einträge in diesem Zeitraum gefunden.</p>
              ) : (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-xs tnum">
                    <thead>
                      <tr className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider border-b border-edge-soft">
                        <th className="text-left py-1.5 pr-3">Datum</th>
                        <th className="text-left py-1.5 pr-3">Zeit</th>
                        <th className="text-left py-1.5 pr-3">Typ</th>
                        <th className="text-left py-1.5 pr-3">Name</th>
                        <th className="text-left py-1.5 pr-3">Quelle</th>
                        <th className="text-left py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge-row">
                      {sucheRows.map(r => (
                        <tr key={r.id} className={r.status === 'geloescht' ? 'text-ink-4' : 'text-ink-2'}>
                          <td className="py-1.5 pr-3">{fmtCH(r.datum)}</td>
                          <td className="py-1.5 pr-3">{r.zeit}</td>
                          <td className="py-1.5 pr-3">{r.typ}</td>
                          <td className="py-1.5 pr-3">{r.name}</td>
                          <td className="py-1.5 pr-3">{r.quelle}</td>
                          <td className="py-1.5">{r.status === 'geloescht' ? 'gelöscht' : 'aktiv'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
