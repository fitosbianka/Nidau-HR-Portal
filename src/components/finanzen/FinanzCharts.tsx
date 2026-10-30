'use client'

// Eigene, leichte SVG-Diagramme für die Geschäftsanalyse (bewusst ohne
// Chart-Bibliothek). Es werden NUR Monatswerte gezeichnet — nie
// Buchungstexte.
//
// Farben: Das nebeneinanderliegende Balkenpaar Einnahmen/Ausgaben nutzt die
// validierte Paar-Palette #00876B/#C97F2E (Farbfehlsichtigkeits-Check
// bestanden: ΔE 9.1 protan, 22.0 normal, Kontrast ≥ 3:1). Die Ergebnis-
// Linie und die Investitions-Punkte sind bewusst KEINE Hue-Identität:
// sie unterscheiden sich durch die Form (Linie/Punkt statt Balken), sind
// in der Legende beschriftet und im Tooltip benannt.

import { useState } from 'react'
import { fmtChf } from '@/lib/utils'
import { monatLabel, monatKurz } from '@/lib/finanzen/analyse'

const F_MINT = '#00876B'
const F_APRICOT = '#C97F2E'
const F_DUSK = '#55525E'
const F_STEEL = '#4F6B8F'
const F_ZIEL = '#96703F'

const fmtRp = (rp: number) => fmtChf(rp / 100)
const fmtSigniert = (rp: number) => `${rp < 0 ? '−' : ''}${fmtChf(Math.abs(rp) / 100)}`

// Achsenbeschriftung kurz: 45k, 4.5k, 850, −12k
function fmtAchse(rp: number): string {
  const chf = rp / 100
  const a = Math.abs(chf)
  if (a >= 100000) return `${chf < 0 ? '−' : ''}${Math.round(a / 1000)}k`
  if (a >= 1000) {
    const v = Math.round(a / 100) / 10
    return `${chf < 0 ? '−' : ''}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`
  }
  return `${chf < 0 ? '−' : ''}${Math.round(a)}`
}

// «Schöne» Skala mit 4–5 Schritten
function skala(min: number, max: number): { min: number; max: number; ticks: number[] } {
  if (min === max) { min -= 1; max += 1 }
  const roh = (max - min) / 4
  const zehner = Math.pow(10, Math.floor(Math.log10(roh)))
  const schritt = [1, 2, 2.5, 5, 10].map(f => f * zehner).find(s => (max - min) / s <= 5) ?? 10 * zehner
  const lo = Math.floor(min / schritt) * schritt
  const hi = Math.ceil(max / schritt) * schritt
  const ticks: number[] = []
  for (let t = lo; t <= hi + schritt / 2; t += schritt) ticks.push(Math.round(t))
  return { min: lo, max: hi, ticks }
}

// Balken mit gerundetem Datenende (oben), unten an der Nulllinie
function balkenPfad(x: number, yBoden: number, yTop: number, w: number): string {
  const h = yBoden - yTop
  if (h <= 0.5) return `M ${x} ${yBoden} h ${w} v -0.5 h ${-w} Z`
  const r = Math.min(3, w / 2, h)
  return `M ${x} ${yBoden} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${x + w - r} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + r} L ${x + w} ${yBoden} Z`
}

function LegendeChip({ farbe, label, linie, gestrichelt }: { farbe: string; label: string; linie?: boolean; gestrichelt?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
      {linie
        ? <svg width="16" height="6" aria-hidden="true"><line x1="0" y1="3" x2="16" y2="3" stroke={farbe} strokeWidth="2" strokeDasharray={gestrichelt ? '4 3' : undefined} /></svg>
        : <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: farbe }} />}
      {label}
    </span>
  )
}

const W = 760, H = 270, ML = 52, MR = 12, MT = 12, MB = 26
const plotW = W - ML - MR, plotH = H - MT - MB

function xLabels(punkte: Array<{ monat: string }>): Array<{ i: number; text: string }> {
  const n = punkte.length
  const k = Math.max(1, Math.ceil(n / 12))
  const out: Array<{ i: number; text: string }> = []
  for (let i = 0; i < n; i++) {
    if (i % k !== 0) continue
    const m = punkte[i].monat
    const jahr = (i === 0 || m.slice(5, 7) === '01') ? ` ${m.slice(2, 4)}` : ''
    out.push({ i, text: `${monatKurz(m)}${jahr}` })
  }
  return out
}

// ── Monatsverlauf: Balken Einnahmen/Ausgaben + Linie Betriebsergebnis ────

export type VerlaufPunkt = {
  monat: string
  einnahmenRp: number    // E + R, positiv
  rueckRp: number        // Anteil Rückerstattungen, positiv
  ausgabenRp: number     // A, positiv
  betriebRp: number      // B, signiert
  laufend: boolean
}

export function MonatsverlaufChart({ punkte, oe3Rp }: { punkte: VerlaufPunkt[]; oe3Rp: number | null }) {
  const [aktiv, setAktiv] = useState<number | null>(null)
  if (punkte.length === 0) return <p className="text-xs text-ink-4 py-8 text-center">Noch keine Monatsdaten im gewählten Zeitraum.</p>

  const werte = punkte.flatMap(p => [p.einnahmenRp, p.ausgabenRp, p.betriebRp])
  if (oe3Rp != null) werte.push(oe3Rp)
  const s = skala(Math.min(0, ...werte), Math.max(0, ...werte))
  const y = (rp: number) => MT + plotH - ((rp - s.min) / (s.max - s.min)) * plotH
  const n = punkte.length
  const slot = plotW / n
  const barW = Math.min(16, Math.max(3, slot * 0.28))
  const y0 = y(0)

  return (
    <div className="relative text-ink-4" onMouseLeave={() => setAktiv(null)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
        <LegendeChip farbe={F_MINT} label="Einnahmen" />
        <LegendeChip farbe={F_APRICOT} label="Ausgaben" />
        <LegendeChip farbe={F_DUSK} label="Betriebsergebnis" linie />
        {oe3Rp != null && <LegendeChip farbe={F_DUSK} label="Ø 3 Monate" linie gestrichelt />}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Monatsverlauf: Einnahmen, Ausgaben und Betriebsergebnis für ${n} Monate. Die Zahlen stehen auch in der Monatstabelle.`}>
        {s.ticks.map(t => (
          <g key={t}>
            <line x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.12} />
            <text x={ML - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" className="tnum">{fmtAchse(t)}</text>
          </g>
        ))}
        {punkte.map((p, i) => {
          const cx = ML + slot * (i + 0.5)
          const dimm = p.laufend ? 0.45 : 1
          return (
            <g key={p.monat} opacity={dimm}>
              <path d={balkenPfad(cx - barW - 1, y0, y(p.einnahmenRp), barW)} fill={F_MINT} />
              <path d={balkenPfad(cx + 1, y0, y(p.ausgabenRp), barW)} fill={F_APRICOT} />
            </g>
          )
        })}
        {oe3Rp != null && (
          <line x1={ML} x2={W - MR} y1={y(oe3Rp)} y2={y(oe3Rp)} stroke={F_DUSK} strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.55" />
        )}
        <polyline
          points={punkte.map((p, i) => `${ML + slot * (i + 0.5)},${y(p.betriebRp)}`).join(' ')}
          fill="none" stroke={F_DUSK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        />
        {punkte.map((p, i) => (
          <circle key={p.monat} cx={ML + slot * (i + 0.5)} cy={y(p.betriebRp)} r={aktiv === i ? 4.5 : 3.5}
            fill={p.laufend ? 'white' : F_DUSK} stroke={p.laufend ? F_DUSK : 'white'} strokeWidth="2" />
        ))}
        {xLabels(punkte).map(l => (
          <text key={l.i} x={ML + slot * (l.i + 0.5)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor">{l.text}</text>
        ))}
        {punkte.map((p, i) => (
          <rect key={`h${p.monat}`} x={ML + slot * i} y={MT} width={slot} height={plotH} fill="transparent"
            onMouseEnter={() => setAktiv(i)} onClick={() => setAktiv(aktiv === i ? null : i)} />
        ))}
      </svg>
      {aktiv != null && punkte[aktiv] && (
        <div className="absolute z-10 pointer-events-none bg-white border border-edge rounded-ctl shadow-lg px-3 py-2 text-[11.5px] leading-relaxed min-w-[190px]"
          style={{
            left: `${Math.min(82, Math.max(3, ((ML + slot * (aktiv + 0.5)) / W) * 100))}%`,
            top: 28, transform: 'translateX(-50%)',
          }}>
          <p className="font-bold text-ink mb-0.5">
            {monatLabel(punkte[aktiv].monat)}
            {punkte[aktiv].laufend && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-4 align-middle">laufend</span>}
          </p>
          <p className="flex justify-between gap-4"><span className="text-ink-3">Einnahmen</span><span className="tnum font-semibold text-ink">{fmtRp(punkte[aktiv].einnahmenRp)}</span></p>
          {punkte[aktiv].rueckRp > 0 && (
            <p className="flex justify-between gap-4 text-ink-4"><span>davon Rückerstattungen</span><span className="tnum">{fmtRp(punkte[aktiv].rueckRp)}</span></p>
          )}
          <p className="flex justify-between gap-4"><span className="text-ink-3">Ausgaben</span><span className="tnum font-semibold text-ink">{fmtRp(punkte[aktiv].ausgabenRp)}</span></p>
          <p className="flex justify-between gap-4 border-t border-edge-row mt-1 pt-1"><span className="text-ink-3">Betriebsergebnis</span>
            <span className={`tnum font-bold ${punkte[aktiv].betriebRp >= 0 ? 'text-mint-ink' : 'text-blush-ink'}`}>{fmtSigniert(punkte[aktiv].betriebRp)}</span></p>
        </div>
      )}
    </div>
  )
}

// ── Kontostand: Linie + Investitions-Punkte + Ziellinie ─────────────────

export type KontostandPunkt = {
  monat: string
  saldoRp: number | null
  laufend: boolean
  /** Investitionen des Monats über CHF 5'000, nur Kategorie-Name + Betrag */
  investitionen: Array<{ name: string; betragRp: number }>
}

export function KontostandChart({ punkte, zielRp }: { punkte: KontostandPunkt[]; zielRp: number | null }) {
  const [aktiv, setAktiv] = useState<number | null>(null)
  const mitSaldo = punkte.filter(p => p.saldoRp != null)
  if (mitSaldo.length === 0) return <p className="text-xs text-ink-4 py-8 text-center">Noch keine Kontostände im gewählten Zeitraum.</p>

  const werte = mitSaldo.map(p => p.saldoRp!)
  if (zielRp != null) werte.push(zielRp)
  const s = skala(Math.min(0, ...werte), Math.max(...werte))
  const y = (rp: number) => MT + plotH - ((rp - s.min) / (s.max - s.min)) * plotH
  const n = punkte.length
  const slot = plotW / n

  // Liniensegmente — Lücken (Monate ohne Saldo) unterbrechen die Linie
  const segmente: string[] = []
  let aktuelle: string[] = []
  punkte.forEach((p, i) => {
    if (p.saldoRp == null) {
      if (aktuelle.length > 0) { segmente.push(aktuelle.join(' ')); aktuelle = [] }
    } else {
      aktuelle.push(`${ML + slot * (i + 0.5)},${y(p.saldoRp)}`)
    }
  })
  if (aktuelle.length > 0) segmente.push(aktuelle.join(' '))

  return (
    <div className="relative text-ink-4" onMouseLeave={() => setAktiv(null)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
        <LegendeChip farbe={F_DUSK} label="Kontostand Monatsende" linie />
        <LegendeChip farbe={F_STEEL} label="Monat mit Investition über CHF 5'000" />
        {zielRp != null && <LegendeChip farbe={F_ZIEL} label="Zielbetrag" linie gestrichelt />}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Kontostand am Monatsende über ${n} Monate; Monate mit grösseren Investitionen sind markiert. Die Zahlen stehen auch in der Monatstabelle.`}>
        {s.ticks.map(t => (
          <g key={t}>
            <line x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.12} />
            <text x={ML - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" className="tnum">{fmtAchse(t)}</text>
          </g>
        ))}
        {zielRp != null && (
          <g>
            <line x1={ML} x2={W - MR} y1={y(zielRp)} y2={y(zielRp)} stroke={F_ZIEL} strokeWidth="1.5" strokeDasharray="6 4" />
            <text x={W - MR} y={y(zielRp) - 5} textAnchor="end" fontSize="10" fill={F_ZIEL} fontWeight="600">Ziel {fmtAchse(zielRp)}</text>
          </g>
        )}
        {segmente.map((seg, i) => (
          <polyline key={i} points={seg} fill="none" stroke={F_DUSK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {punkte.map((p, i) => {
          if (p.saldoRp == null) return null
          const cx = ML + slot * (i + 0.5)
          const invest = p.investitionen.length > 0
          return (
            <circle key={p.monat} cx={cx} cy={y(p.saldoRp)}
              r={invest ? (aktiv === i ? 6 : 5) : (aktiv === i ? 4 : 2.5)}
              fill={invest ? F_STEEL : F_DUSK}
              stroke="white" strokeWidth={invest ? 2 : 1.5}
              opacity={p.laufend ? 0.5 : 1}
            />
          )
        })}
        {xLabels(punkte).map(l => (
          <text key={l.i} x={ML + slot * (l.i + 0.5)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor">{l.text}</text>
        ))}
        {punkte.map((p, i) => (
          <rect key={`h${p.monat}`} x={ML + slot * i} y={MT} width={slot} height={plotH} fill="transparent"
            onMouseEnter={() => setAktiv(i)} onClick={() => setAktiv(aktiv === i ? null : i)} />
        ))}
      </svg>
      {aktiv != null && punkte[aktiv] && punkte[aktiv].saldoRp != null && (
        <div className="absolute z-10 pointer-events-none bg-white border border-edge rounded-ctl shadow-lg px-3 py-2 text-[11.5px] leading-relaxed min-w-[190px]"
          style={{
            left: `${Math.min(82, Math.max(3, ((ML + slot * (aktiv + 0.5)) / W) * 100))}%`,
            top: 28, transform: 'translateX(-50%)',
          }}>
          <p className="font-bold text-ink mb-0.5">{monatLabel(punkte[aktiv].monat)}</p>
          <p className="flex justify-between gap-4"><span className="text-ink-3">Kontostand</span><span className="tnum font-semibold text-ink">{fmtSigniert(punkte[aktiv].saldoRp!)}</span></p>
          {punkte[aktiv].investitionen.map((inv, j) => (
            <p key={j} className="flex justify-between gap-4 text-steel-ink"><span>{inv.name}</span><span className="tnum">−{fmtRp(inv.betragRp)}</span></p>
          ))}
        </div>
      )}
    </div>
  )
}
