'use client'

// Konto-Seite: Prüfung der Ferientage von Teilzeit seit Beginn der live
// gerechneten Monate. Pro Person und Woche: ganze Wochen F (zählen neu nach
// Pensum), mehr F-Tage als das Pensum ergibt, F an freien Tagen laut
// Standardwoche. Reine Anzeige, korrigiert wird im Arbeitsplan.

import { useState } from 'react'
import { PRUEF_ART_LABEL, type FerienPruefungPerson } from '@/lib/ferien-pensumwoche'

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const fmtD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const wdVon = (d: string) => WD[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]
const pz = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
const kw = (montag: string) => { const d = new Date(`${montag}T12:00:00Z`); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t.getTime() - j.getTime()) / 86400000 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) }

export default function FerienPruefungKarte({ liste, von, bis }: { liste: FerienPruefungPerson[]; von: string; bis: string }) {
  const [offen, setOffen] = useState(false)
  const personen = liste.filter(p => p.wochen.length > 0)
  const anzahl = personen.reduce((s, p) => s + p.wochen.length, 0)
  return (
    <div className="card overflow-hidden no-print mt-4">
      <button onClick={() => setOffen(o => !o)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-hovrow text-left">
        <div>
          <p className="text-sm font-semibold text-ink">Prüfung Ferientage Teilzeit <span className="text-ink-4 font-normal">({fmtD(von)} bis {fmtD(bis)})</span></p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">
            {anzahl === 0
              ? 'Keine Auffälligkeiten. Alle F-Tage der Teilzeit liegen an Arbeitstagen und innerhalb des Pensums.'
              : `${anzahl} ${anzahl === 1 ? 'Woche' : 'Wochen'} bei ${personen.length} ${personen.length === 1 ? 'Person' : 'Personen'} zum Anschauen.`}
          </p>
        </div>
        <span className={`text-ink-4 transition-transform ${offen ? 'rotate-90' : ''}`}>›</span>
      </button>
      {offen && (
        <div className="px-6 pb-4 border-t border-edge-soft space-y-4">
          <p className="text-[11.5px] text-ink-3 pt-3">
            Eine Kalenderwoche, die an allen Arbeitstagen F trägt, zählt bei Teilzeit automatisch Pensum mal Arbeitstage (bei 50 % also 2,5 Tage und 21.15 Stunden), einzelne F-Tage zählen je einen Tag. Wochen mit mehr F-Tagen, als das Pensum ergibt, und F an freien Tagen laut Standardwoche zählen weiterhin so, wie sie eingetragen sind, und stehen hier zur Kontrolle. Korrigiert wird im Arbeitsplan oder mit «angerechnet» im Ferienkalender.
          </p>
          {personen.length === 0 && <p className="text-[12px] text-ink-4">Nichts zu prüfen.</p>}
          {personen.map(p => (
            <div key={p.id}>
              <p className="text-[12.5px] font-semibold text-ink">{p.name} <span className="font-normal text-ink-4">· {p.pensumLabel}</span></p>
              <ul className="mt-1 space-y-1.5">
                {p.wochen.map(w => (
                  <li key={w.montag} className="rounded-lg border border-edge-soft px-3 py-2 text-[12px]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-ink tnum">KW {kw(w.montag)} · {fmtD(w.montag)}</span>
                      {w.arten.map(a => (
                        <span key={a} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${a === 'pensumwoche' ? 'bg-mint-bg text-mint-ink' : a === 'zuviel' ? 'bg-apricot-bg text-apricot-ink' : 'bg-blush-bg text-blush-ink'}`}>{PRUEF_ART_LABEL[a]}</span>
                      ))}
                      <span className="text-ink-3 tnum">{w.tage.length} F-Tage, Pensum ergibt höchstens {w.erlaubt} · gezählt bisher {pz(w.bisher)}, neu {pz(w.neu)}</span>
                    </div>
                    <p className="mt-1 text-ink-2 tnum flex flex-wrap gap-x-3">
                      {w.tage.map(t => (
                        <span key={t.datum} className={t.frei ? 'text-blush-ink font-semibold' : ''} title={t.frei ? 'laut Standardwoche frei' : undefined}>
                          {wdVon(t.datum)} {fmtD(t.datum)} {t.entry}{Math.abs(t.neu - t.bisher) > 1e-9 ? ` (${pz(t.bisher)} → ${pz(t.neu)})` : ''}{t.frei ? ' · frei' : ''}
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
