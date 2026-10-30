'use client'

// Kontrolle nach der Zeitumstellung vom 25.10.2026 (Admin): alle Tage ab dem
// 25.10., an denen zwischen der Umstellung und der Korrektur im Portal
// (29.10.) Zeiten von Hand geändert oder Korrekturmeldungen erledigt wurden.
// Pro Fall die protokollierten Änderungen, die Korrekturmeldung mit der
// gewünschten Zeit und die aktuellen Stempel; jeder Stempel lässt sich mit
// einem Klick um eine Stunde nach hinten setzen (läuft über die normale
// Schnittstelle und wird protokolliert).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zeitumstellungKontrolle, type ZeitumstellungFall } from '@/actions/kontrolle'
import { zurichTimeOf } from '@/lib/zeit-log'

const fmtD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const fmtTs = (iso: string) => `${new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })} Uhr`

export default function ZeitumstellungKontrolleModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [faelle, setFaelle] = useState<ZeitumstellungFall[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [laeuft, setLaeuft] = useState<string | null>(null)

  const laden = useCallback(() => {
    zeitumstellungKontrolle()
      .then(r => { if (r.error) setError(r.error); else setFaelle(r.faelle ?? []) })
      .catch(() => setError('Die Kontrolle konnte nicht geladen werden.'))
  }, [])
  useEffect(() => { laden() }, [laden])

  async function plusStunde(f: ZeitumstellungFall, s: ZeitumstellungFall['stempel'][number]) {
    const neu = new Date(new Date(s.iso).getTime() + 3600000).toISOString()
    const art = s.typ === 'In' ? 'Einstempeln' : 'Ausstempeln'
    if (!confirm(`${art} von ${f.emp} am ${fmtD(f.datum)} von ${s.zeit} auf ${zurichTimeOf(neu)} setzen?`)) return
    setLaeuft(s.id); setMsg(null)
    try {
      const res = await fetch('/api/admin/attendance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timemoto_event_id: s.id, time_logged: neu }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) { setMsg({ ok: false, text: j.error ?? 'Fehler beim Speichern.' }); return }
      setMsg({ ok: true, text: `${f.emp}, ${fmtD(f.datum)}: ${art} ${s.zeit} → ${zurichTimeOf(neu)} gespeichert.` })
      laden(); router.refresh()
    } catch {
      setMsg({ ok: false, text: 'Netzwerkfehler. Bitte erneut versuchen.' })
    } finally { setLaeuft(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Kontrolle Zeitumstellung">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-edge-soft flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-ink">Kontrolle Zeitumstellung 25.10.2026</h3>
            <p className="text-[11.5px] text-ink-4 mt-0.5">Von Hand eingetippte Zeiten für Tage ab dem 25.10., die vor der Korrektur im Portal am 29.10. gespeichert wurden, liegen eine Stunde zu früh. Hier stehen alle Tage mit solchen Änderungen und erledigten Korrekturmeldungen, dazu die aktuellen Stempel. Automatische Stempel vom Terminal sind nicht betroffen.</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-edge-row text-ink-4 hover:text-ink-2 flex items-center justify-center text-lg leading-none flex-shrink-0" aria-label="Schliessen">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-3">
          {msg && <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.ok ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</p>}
          {faelle === null && !error && <p className="py-6 text-center text-xs text-ink-4">Wird geprüft …</p>}
          {error && <p className="py-6 text-center text-xs text-blush-ink">{error}</p>}
          {faelle !== null && faelle.length === 0 && (
            <p className="px-4 py-5 rounded-tile bg-mint-bg text-mint-ink text-sm">✓ Keine Handänderungen und keine erledigten Korrekturmeldungen im Prüffenster gefunden. Die Zeiterfassung der Mitarbeitenden ist von der Zeitumstellung nicht betroffen.</p>
          )}
          {(faelle ?? []).map(f => (
            <div key={`${f.emp}_${f.datum}`} className="rounded-xl border border-edge-soft overflow-hidden">
              <div className="px-4 py-2.5 bg-surface border-b border-edge-soft flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-semibold text-ink">{f.emp} <span className="font-normal text-ink-3 tnum">· {fmtD(f.datum)}</span></p>
                {f.nachher.length > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink" title={f.nachher.map(n => `${fmtTs(n.at)}: ${n.text}`).join('\n')}>nach der Korrektur nochmals geändert</span>}
                {f.aenderungen.length === 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-3">keine Zeitänderung protokolliert</span>}
              </div>
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-1">Im Prüffenster geändert</p>
                  {f.aenderungen.length === 0 ? <p className="text-ink-5">–</p> : (
                    <ul className="space-y-0.5">{f.aenderungen.map((a, i) => <li key={i} className="tnum text-ink-2">{a.text} <span className="text-ink-4">({fmtTs(a.at)})</span></li>)}</ul>
                  )}
                  {f.meldungen.length > 0 && (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mt-2 mb-1">Korrekturmeldung</p>
                      <ul className="space-y-0.5">{f.meldungen.map((m, i) => <li key={i} className="text-ink-2">Gewünscht <span className="font-semibold tnum">{m.zeit}</span>{m.text ? <span className="text-ink-3"> · «{m.text}»</span> : null}{m.done ? <span className="text-ink-4 tnum"> · erledigt {fmtD(m.done)}</span> : <span className="text-apricot-ink"> · offen</span>}</li>)}</ul>
                    </>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-1">Stempel jetzt</p>
                  {f.stempel.length === 0 ? <p className="text-ink-5">keine Stempel an diesem Tag</p> : (
                    <ul className="space-y-1">
                      {f.stempel.map(s => (
                        <li key={s.id} className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.typ === 'In' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{s.typ === 'In' ? 'Ein' : 'Aus'}</span>
                          <span className="tnum font-semibold text-ink">{s.zeit}</span>
                          <button onClick={() => plusStunde(f, s)} disabled={laeuft !== null} className="ml-auto px-2 py-0.5 rounded-md border border-edge-ctl bg-white text-[10.5px] font-semibold text-ink-2 hover:bg-edge-row disabled:opacity-50" title="Diesen Stempel um eine Stunde nach hinten setzen">{laeuft === s.id ? 'Wird gespeichert …' : '+1 Std.'}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="px-6 py-2.5 border-t border-edge-soft text-[10.5px] text-ink-4 flex-shrink-0">Nur die von Hand eingetippten Stempel sind betroffen; welche das sind, steht links unter «Im Prüffenster geändert». «+1 Std.» korrigiert genau diesen Stempel und wird im Protokoll festgehalten.</p>
      </div>
    </div>
  )
}
