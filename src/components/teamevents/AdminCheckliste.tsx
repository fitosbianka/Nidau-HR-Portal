'use client'

// Admin Checkliste der Organisatorin (nur sie sieht sie). Vorgegebene
// Punkte auf Englisch, nach Phasen gruppiert, Frist neben der Phase,
// Fortschritt für die ganze Liste. Eigene Punkte lassen sich in jeder
// Phase und unter «Weitere Punkte» ergänzen und wieder entfernen. Haken
// erscheinen sofort und werden gebündelt nacheinander gespeichert, die
// Liste bleibt dabei bedienbar.

import { useRef, useState } from 'react'
import { adminCheckSpeichern, adminItemHinzufuegen, adminItemLoeschen } from '@/actions/teamevent-programm'
import { adminErledigt, phasenMitEigenen, type AdminPhase, type TeAdminCheck, type EigenerPunkt } from '@/lib/teamevent-programm'
import { Fortschritt } from './MeineCheckliste'
import { useSerial } from './useSerial'

export default function AdminCheckliste({ slug, phasen, adminCheck }: { slug: string; phasen: AdminPhase[]; adminCheck: TeAdminCheck }) {
  const [ticks, setTicks] = useState<Record<string, boolean>>(adminCheck.ticks)
  const [eigene, setEigene] = useState<EigenerPunkt[]>(adminCheck.eigene)
  const [zu, setZu] = useState<Set<string>>(new Set())
  const [neu, setNeu] = useState<{ phase: string; titel: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const nacheinander = useSerial()
  const letzte = useRef(adminCheck.ticks)
  const bestaetigt = useRef(adminCheck.ticks)
  const geplant = useRef(false)

  const a: TeAdminCheck = { ticks, eigene }
  const alle = phasenMitEigenen(phasen, eigene)
  const items = alle.flatMap(p => p.items)
  const erledigt = items.filter(i => adminErledigt(i, a)).length

  function toggle(id: string, wert: boolean) {
    setErr(null)
    const next = { ...letzte.current, [id]: wert }
    letzte.current = next
    setTicks(next)
    if (geplant.current) return
    geplant.current = true
    void nacheinander(async () => {
      geplant.current = false
      const r = await adminCheckSpeichern(slug, letzte.current)
      if ('error' in r && r.error) { setErr(r.error); letzte.current = bestaetigt.current; setTicks(bestaetigt.current); return }
      if ('ticks' in r && r.ticks) bestaetigt.current = r.ticks
    })
  }

  async function hinzufuegen() {
    if (!neu) return
    setErr(null); setBusy('neu')
    try {
      const r = await adminItemHinzufuegen(slug, neu.phase, neu.titel, neu.text)
      if ('error' in r && r.error) { setErr(r.error); return }
      if ('eigene' in r && r.eigene) setEigene(r.eigene)
      setNeu(null)
    } finally { setBusy(null) }
  }
  async function entfernen(id: string) {
    if (!confirm('Diesen eigenen Punkt entfernen?')) return
    setErr(null); setBusy(id)
    try {
      const r = await adminItemLoeschen(slug, id)
      if ('error' in r && r.error) { setErr(r.error); return }
      if ('eigene' in r && r.eigene) setEigene(r.eigene)
    } finally { setBusy(null) }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink">Admin Checkliste <span className="text-[10px] font-normal text-ink-4 ml-1">nur für die Organisatorin sichtbar</span></h2>
        <div className="w-full sm:w-72"><Fortschritt erledigt={erledigt} total={items.length} /></div>
      </div>
      {err && <p className="text-xs px-3 py-2 rounded-ctl inline-block bg-blush-bg text-blush-ink">⚠ {err}</p>}
      <div className="space-y-2">
        {alle.map(ph => {
          const offenInPhase = ph.items.filter(i => !adminErledigt(i, a)).length
          const auf = !zu.has(ph.id)
          const formular = neu?.phase === ph.id
          return (
            <div key={ph.id} className="card overflow-hidden">
              <div className="flex items-center">
                <button onClick={() => setZu(s => { const n = new Set(s); if (n.has(ph.id)) n.delete(ph.id); else n.add(ph.id); return n })}
                  className="flex-1 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-left hover:bg-surface/60" aria-expanded={auf}>
                  <span className="min-w-0">
                    <span className="text-sm font-semibold text-ink">{ph.titel}</span>
                    <span className="text-[12px] text-apricot-ink font-semibold ml-2">{ph.frist}</span>
                  </span>
                  <span className="flex items-center gap-2 text-ink-4 flex-shrink-0">
                    <span className={`text-[11px] tnum ${ph.items.length > 0 && offenInPhase === 0 ? 'text-mint-ink font-semibold' : ''}`}>
                      {ph.items.length === 0 ? 'noch leer' : offenInPhase === 0 ? 'alles erledigt' : `${offenInPhase} offen`}
                    </span>
                    <svg className={`w-4 h-4 transition-transform ${auf ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
                  </span>
                </button>
                <button onClick={() => { setZu(s => { const n = new Set(s); n.delete(ph.id); return n }); setNeu(formular ? null : { phase: ph.id, titel: '', text: '' }) }}
                  className="px-3 py-3 text-[11px] font-semibold text-mint-ink hover:underline flex-shrink-0" title="Eigenen Punkt in dieser Phase ergänzen">
                  {formular ? 'Abbrechen' : '+ Punkt'}
                </button>
              </div>
              {auf && (
                <ol className="divide-y divide-edge-soft border-t border-edge-soft">
                  {ph.items.map((it, idx) => {
                    const done = adminErledigt(it, a)
                    return (
                      <li key={it.id} className="flex items-start gap-3 px-4 sm:px-5 py-2.5">
                        <button onClick={() => toggle(it.id, !done)} aria-pressed={done}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${done ? 'bg-mint-mid border-mint-mid text-white' : 'border-edge-ctl bg-white text-transparent hover:border-mint-mid'}`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" /></svg>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] font-semibold leading-snug ${done ? 'text-ink-3 line-through decoration-ink-5' : 'text-ink'}`}>
                            <span className="text-ink-4 tnum mr-1.5">{idx + 1}.</span>{it.titel}
                            {it.eigen && <span className="ml-2 badge-gray !text-[10px] !py-0">eigen</span>}
                          </p>
                          {it.text && <p className="text-[12px] text-ink-4 leading-snug mt-0.5">{it.text}</p>}
                        </div>
                        {it.eigen && (
                          <button onClick={() => entfernen(it.id)} disabled={busy === it.id} className="text-ink-4 hover:text-red-500 text-xs flex-shrink-0" title="Eigenen Punkt entfernen">✕</button>
                        )}
                      </li>
                    )
                  })}
                  {formular && (
                    <li className="px-4 sm:px-5 py-3 bg-surface/50 space-y-2">
                      <input value={neu.titel} onChange={e => setNeu({ ...neu, titel: e.target.value })} maxLength={160} autoFocus
                        placeholder="Titel des Punkts" className="input-field text-sm w-full"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); hinzufuegen() } }} />
                      <input value={neu.text} onChange={e => setNeu({ ...neu, text: e.target.value })} maxLength={600}
                        placeholder="Beschreibung (optional)" className="input-field text-sm w-full"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); hinzufuegen() } }} />
                      <div className="flex gap-2">
                        <button onClick={hinzufuegen} disabled={busy === 'neu' || neu.titel.trim().length < 2} className="btn-primary text-xs">{busy === 'neu' ? 'Speichert…' : 'Hinzufügen'}</button>
                        <button onClick={() => setNeu(null)} className="btn-secondary text-xs">Abbrechen</button>
                      </div>
                    </li>
                  )}
                </ol>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
