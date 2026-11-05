'use client'

// Personalakte: Ferienanteil pro Wochentag (nur Admins). Zeigt die geltende
// Regel (Standard nach Namen oder gespeichert), erlaubt das Bearbeiten in
// Perioden und listet die Ferientage im Arbeitsplan, die durch die Regel
// anders zählen als bisher (zum Beispiel ein F am Montag neu 0,5 statt 1).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ferienAnteilSpeichern, ferienAnteilZuruecksetzen } from '@/actions/ferien-anteil'
import { WOCHENTAG_KEYS, WOCHENTAG_KURZ, anteilSumme, type AnteilAuswirkung, type AnteilPeriode, type AnteilRegel, type Wochentag } from '@/lib/ferien-anteil'

type Zeile = { ab: string; bis: string; anteile: Record<Wochentag, string> }

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const fmtD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const wdVon = (d: string) => WD[(new Date(`${d}T12:00:00`).getDay() + 6) % 7]
const pz = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
const zuZeilen = (r: AnteilRegel | null): Zeile[] => (r ?? { perioden: [] }).perioden.map(p => ({
  ab: p.ab, bis: p.bis ?? '', anteile: Object.fromEntries(WOCHENTAG_KEYS.map(k => [k, String(p.anteile[k] ?? 0)])) as Record<Wochentag, string>,
}))

export default function FerienAnteilSection({ employeeId, vorname, pensum, regel, gespeichert, standard, auswirkung, heute }: {
  employeeId: string
  vorname: string
  /** Pensum in Prozent laut Profil */
  pensum: number | null
  /** Geltende Regel (gespeichert vor Standard), null = keine */
  regel: AnteilRegel | null
  /** Es liegt eine gespeicherte Zeile vor (auch «keine Regel») */
  gespeichert: boolean
  /** Standard nach Namen, falls vorhanden */
  standard: AnteilRegel | null
  /** Ferientage im Arbeitsplan, die durch die Regel anders zählen */
  auswirkung: AnteilAuswirkung[]
  heute: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [error, setError] = useState<string | null>(null)
  const sollTage = pensum != null && pensum > 0 && pensum <= 100 ? Math.round(5 * pensum) / 100 : null

  // Monate mit mindestens einem Tag, der anders zählt; die Summen zählen alle F-Tage des Monats
  const geaenderte = useMemo(() => auswirkung.filter(a => a.geaendert), [auswirkung])
  const monate = useMemo(() => {
    const m = new Map<string, AnteilAuswirkung[]>()
    for (const a of auswirkung) { const k = a.datum.slice(0, 7); m.set(k, [...(m.get(k) ?? []), a]) }
    return Array.from(m.entries()).filter(([, liste]) => liste.some(a => a.geaendert))
  }, [auswirkung])
  const monatName = (ym: string) => `${MONATE[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

  function bearbeiten() {
    setError(null)
    const basis = zuZeilen(regel)
    setZeilen(basis.length > 0 ? basis : [{ ab: `${heute.slice(0, 7)}-01`, bis: '', anteile: { '1': '1', '2': '1', '3': '1', '4': '1', '5': '1' } }])
    setEditing(true)
  }
  const setZeile = (i: number, patch: Partial<Zeile>) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const setAnteil = (i: number, k: Wochentag, v: string) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, anteile: { ...x.anteile, [k]: v } } : x)))
  const zahl = (s: string) => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) ? n : NaN }
  const zeileSumme = (z: Zeile) => { const s = WOCHENTAG_KEYS.reduce((a, k) => a + zahl(z.anteile[k]), 0); return Number.isFinite(s) ? Math.round(s * 100) / 100 : NaN }

  function speichern(perioden: AnteilPeriode[] | null) {
    setError(null)
    let liste: AnteilPeriode[] = []
    if (perioden) liste = perioden
    else {
      for (const z of zeilen) {
        const anteile = {} as Record<Wochentag, number>
        for (const k of WOCHENTAG_KEYS) {
          const n = zahl(z.anteile[k])
          if (!Number.isFinite(n) || n < 0 || n > 1) { setError(`Bitte für ${WOCHENTAG_KURZ[k]} einen Anteil zwischen 0 und 1 eingeben (zum Beispiel 0,5).`); return }
          anteile[k] = Math.round(n * 100) / 100
        }
        liste.push({ ab: z.ab, bis: z.bis || null, anteile })
      }
    }
    startTransition(async () => {
      let r: { error?: string } | { success: true }
      try { r = await ferienAnteilSpeichern(employeeId, liste) } catch { r = { error: 'Netzwerkfehler, bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setError(r.error); return }
      setEditing(false)
      router.refresh()
    })
  }
  function zuruecksetzen() {
    if (!confirm(standard ? 'Gespeicherte Regel löschen? Danach gilt wieder der Standard nach Namen.' : 'Gespeicherte Regel löschen? Danach zählt jedes F wieder einen ganzen Tag.')) return
    setError(null)
    startTransition(async () => {
      let r: { error?: string } | { success: true }
      try { r = await ferienAnteilZuruecksetzen(employeeId) } catch { r = { error: 'Netzwerkfehler, bitte erneut versuchen.' } }
      if ('error' in r && r.error) { setError(r.error); return }
      setEditing(false)
      router.refresh()
    })
  }

  const status = regel ? (gespeichert ? 'gespeichert' : 'Standard') : gespeichert ? 'keine Regel (gespeichert)' : 'keine Regel'

  return (
    <div className="card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-2">Ferienanteil pro Wochentag <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-3 align-middle">{status}</span></h2>
        {!editing && (
          <div className="flex gap-2">
            <button onClick={bearbeiten} disabled={isPending} className="btn-secondary !px-3 !py-1 !text-xs">{regel ? 'Bearbeiten' : 'Regel anlegen'}</button>
            {gespeichert && <button onClick={zuruecksetzen} disabled={isPending} className="btn-secondary !px-3 !py-1 !text-xs">{standard ? 'Auf Standard zurücksetzen' : 'Regel löschen'}</button>}
          </div>
        )}
      </div>
      <p className="text-[12px] text-ink-3">
        Ohne Regel zählt jedes F im Arbeitsplan einen ganzen Ferientag und 8.30 Stunden Gutschrift. Mit Regel zählt ein F den Anteil des Wochentags, zum Beispiel 0,5 an einem halben Tag und 0 an einem freien Tag, und die Gutschrift ist 8.30 Stunden mal Anteil. Das gilt im Arbeitszeit- und Ferienkonto, in der Zeiterfassung, in der Ferienplanung und für die Kapazität. Die Summe der Anteile sollte dem Pensum entsprechen{sollTage != null ? ` (bei ${pensum} % sind das ${pz(sollTage)} Tage pro Woche)` : ''}.
      </p>

      {!editing && regel && (
        <div className="overflow-x-auto">
          <table className="text-[12px] tnum">
            <thead><tr className="text-[10px] uppercase tracking-wider text-ink-4"><th className="text-left pr-4 py-1">Gültig ab</th><th className="text-left pr-4 py-1">Bis</th>{WOCHENTAG_KEYS.map(k => <th key={k} className="px-2 py-1">{WOCHENTAG_KURZ[k]}</th>)}<th className="pl-3 py-1 text-right">Summe</th></tr></thead>
            <tbody>
              {regel.perioden.map(p => {
                const s = anteilSumme(p.anteile)
                const passt = sollTage == null || Math.abs(s - sollTage) < 0.005
                return (
                  <tr key={p.ab} className="border-t border-edge-row">
                    <td className="pr-4 py-1">{fmtD(p.ab)}</td><td className="pr-4 py-1">{p.bis ? fmtD(p.bis) : 'offen'}</td>
                    {WOCHENTAG_KEYS.map(k => <td key={k} className="px-2 py-1 text-center">{pz(p.anteile[k] ?? 0)}</td>)}
                    <td className={`pl-3 py-1 text-right font-semibold ${passt ? 'text-mint-ink' : 'text-apricot-ink'}`} title={passt ? 'entspricht dem Pensum' : `Pensum laut Profil ${pensum ?? '?'} %`}>{pz(s)}{passt ? ' ✓' : ' ≠ Pensum'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!editing && !regel && <p className="text-[12px] text-ink-4">Für {vorname} gilt keine Regel, jedes F zählt einen ganzen Tag.</p>}

      {editing && (
        <div className="space-y-3">
          {zeilen.map((z, i) => {
            const s = zeileSumme(z)
            const passt = Number.isFinite(s) && (sollTage == null || Math.abs(s - sollTage) < 0.005)
            return (
              <div key={i} className="rounded-lg border border-edge-soft p-3 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Gültig ab</label>
                  <input type="date" value={z.ab} onChange={e => setZeile(i, { ab: e.target.value })} className="input-field text-sm w-40" /></div>
                <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Bis (leer = offen)</label>
                  <input type="date" value={z.bis} onChange={e => setZeile(i, { bis: e.target.value })} className="input-field text-sm w-40" /></div>
                {WOCHENTAG_KEYS.map(k => (
                  <div key={k} className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">{WOCHENTAG_KURZ[k]}</label>
                    <input type="text" inputMode="decimal" value={z.anteile[k]} onChange={e => setAnteil(i, k, e.target.value)} className="input-field text-sm !w-16 text-center" /></div>
                ))}
                <p className={`text-[12px] font-semibold pb-2 ${passt ? 'text-mint-ink' : 'text-apricot-ink'}`}>Summe {Number.isFinite(s) ? pz(s) : '?'}{sollTage != null ? ` von ${pz(sollTage)}` : ''}</p>
                {zeilen.length > 1 && <button onClick={() => setZeilen(x => x.filter((_, j) => j !== i))} className="text-[11px] text-ink-4 hover:text-red-500 pb-2">Periode entfernen</button>}
              </div>
            )
          })}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => speichern(null)} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">{isPending ? 'Wird gespeichert…' : 'Speichern'}</button>
            <button onClick={() => setZeilen(z => [...z, { ab: '', bis: '', anteile: { '1': '1', '2': '1', '3': '1', '4': '1', '5': '1' } }])} className="btn-secondary !px-3 !py-1.5 !text-xs">Periode hinzufügen</button>
            {standard && <button onClick={() => speichern([])} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs" title="Den Standard nach Namen ausschalten, jedes F zählt wieder einen ganzen Tag">Keine Regel</button>}
            <button onClick={() => setEditing(false)} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
          </div>
          <p className="text-[11px] text-ink-4">Bei einem Pensumwechsel die alte Periode mit «bis» abschliessen und eine neue Periode anlegen, dann bleiben frühere Monate unverändert.</p>
        </div>
      )}

      {error && <p className="text-xs px-3 py-2 rounded-ctl inline-block bg-blush-bg text-blush-ink">⚠ {error}</p>}

      {regel && (
        <div className="pt-3 border-t border-edge-soft">
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">Ferientage, die durch die Regel anders zählen</p>
          {geaenderte.length === 0 ? (
            <p className="text-[12px] text-ink-4">Keine. Alle F im Arbeitsplan seit {fmtD(regel.perioden[0].ab)} zählen schon richtig.</p>
          ) : (
            <div className="space-y-2">
              {monate.map(([ym, liste]) => {
                const alt = liste.reduce((s, a) => s + a.alt, 0), neu = liste.reduce((s, a) => s + a.neu, 0)
                return (
                  <div key={ym} className="text-[12px]">
                    <p className="font-semibold text-ink">{monatName(ym)} <span className="font-normal text-ink-3 tnum">· Ferientage im Monat bisher {pz(alt)}, neu {pz(neu)}</span></p>
                    <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-ink-2 tnum">
                      {liste.filter(a => a.geaendert).map(a => <li key={a.datum}>{wdVon(a.datum)} {fmtD(a.datum)} <span className="text-ink-4">{pz(a.alt)} →</span> <span className="font-semibold">{pz(a.neu)}</span></li>)}
                    </ul>
                  </div>
                )
              })}
              <p className="text-[11.5px] text-ink-3 pt-1">Ferientage seit {fmtD(regel.perioden[0].ab)} insgesamt bisher {pz(auswirkung.reduce((s, a) => s + a.alt, 0))}, neu {pz(auswirkung.reduce((s, a) => s + a.neu, 0))}. Konto und Zeiterfassung rechnen ab sofort mit den neuen Werten. Die bereits in den Mitarbeiter-Ordner exportierten Zeiterfassungen dieser Monate bitte neu exportieren, damit das PDF stimmt.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
