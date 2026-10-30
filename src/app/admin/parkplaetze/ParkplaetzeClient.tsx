'use client'

// Parkplatz-Vermietung (admin only): Übersicht (payment grid per year with
// summary) and Mieterinnen (participant management).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  savePpTeilnehmer, deletePpTeilnehmer, setPpZahlung, clearPpZahlung,
  setPpAussetzung, setPpBisherigeBezahlt, setPpJahrBezahlt,
} from '@/actions/parkplatz'
import { openFileWindow, downloadBlob } from '@/lib/client-files'
import {
  PP_PLAETZE, PP_KOSTEN_PRO_PLATZ, PP_METHODEN, fmtChf, ppMonthKey, ppActiveMonths, ppSoll,
  type PpTeilnehmer, type PpZahlung, type PpMethode,
} from '@/lib/parkplatz'

const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const fmtCH = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const methodeLabel = (m: PpMethode) => PP_METHODEN.find(x => x.key === m)?.label ?? m

function zurichToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
}

type Profile = { id: string; full_name: string; pensum: number | null }

// ── Payment cell edit dialog state ──
type CellEdit = {
  t: PpTeilnehmer
  monat: string          // YYYY-MM
  monatLabel: string
  zahlung: PpZahlung | null
  autoBezahlt: boolean   // shown paid via automatic Lohnabzug (no row)
  am: string
  notiz: string
  betrag: string         // bezahlter Betrag (CHF) — Eingabe
  soll: string           // Monatsbetrag (Soll) für genau diesen Monat — Eingabe
}

/** Abweichender Monatsbetrag aus dem Dialog (null = Standard der Mieterin). */
function sollOverride(c: CellEdit): number | null {
  const v = parseFloat(c.soll.replace(',', '.'))
  return !isNaN(v) && v >= 0 && Math.abs(v - c.t.betrag) > 0.004 ? Math.round(v * 100) / 100 : null
}
/** Bezahlter Betrag aus dem Dialog (leer → Monatsbetrag). */
function betragWert(c: CellEdit): number {
  const v = parseFloat(c.betrag.replace(',', '.'))
  return isNaN(v) || v < 0 ? (sollOverride(c) ?? c.t.betrag) : Math.round(v * 100) / 100
}

// ── Rechnung dialog state (Jahresrechnung) ──
type RechnungEdit = { t: PpTeilnehmer; name: string; adresse: string; bezahltAm: string | null }

export default function ParkplaetzeClient({
  teilnehmer, zahlungen, profiles,
}: {
  teilnehmer: PpTeilnehmer[]
  zahlungen: Record<string, Record<string, PpZahlung>>
  profiles: Profile[]
}) {
  const router = useRouter()
  const heute = zurichToday()
  const currentYear = Number(heute.slice(0, 4))
  const currentYM = heute.slice(0, 7)

  const [tab, setTab] = useState<'uebersicht' | 'mieter'>('uebersicht')
  const [jahr, setJahr] = useState(currentYear)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cell, setCell] = useState<CellEdit | null>(null)
  const [rechnung, setRechnung] = useState<RechnungEdit | null>(null)
  const [rechnungBusy, setRechnungBusy] = useState<string | null>(null)
  // Notiz zur Mieterin direkt aus der Übersicht bearbeiten
  const [notizEdit, setNotizEdit] = useState<{ t: PpTeilnehmer; text: string } | null>(null)

  async function run(fn: () => Promise<{ error?: string } | undefined>) {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (r?.error) setError(r.error)
      else router.refresh()
    } catch {
      setError('Netzwerkfehler — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  // Rows of the selected year: everyone whose active range touches the year
  const jahresTeilnehmer = useMemo(
    () => teilnehmer.filter(t => ppActiveMonths(t, jahr).length > 0),
    [teilnehmer, jahr],
  )

  /** Effective payment state of one participant-month. */
  function zahlungFuer(t: PpTeilnehmer, m: number): { bezahlt: boolean; z: PpZahlung | null; auto: boolean } {
    const ym = ppMonthKey(jahr, m)
    const z = zahlungen[t.id]?.[ym] ?? null
    // eine Zeile mit Zahlungsdatum = bezahlt; Zeilen nur mit abweichendem
    // Monatsbetrag (soll) oder Notiz sind weiterhin unbezahlt
    if (z && !z.ausgesetzt && z.am) return { bezahlt: true, z, auto: false }
    if (z?.ausgesetzt) return { bezahlt: false, z, auto: false }
    // automatic Lohnabzug: elapsed months count as paid via payroll
    if (t.methode === 'lohnabzug' && t.autoLohn && ym <= currentYM) {
      return { bezahlt: true, z: null, auto: true }
    }
    return { bezahlt: false, z, auto: false }
  }
  /** Geschuldeter Betrag des Monats (abweichender Monatsbetrag oder Standard). */
  function sollFuer(t: PpTeilnehmer, m: number): number {
    return ppSoll(t, zahlungen[t.id]?.[ppMonthKey(jahr, m)])
  }
  /** Eingegangener Betrag eines als bezahlt geltenden Monats. */
  function bezahltBetrag(t: PpTeilnehmer, m: number, st: { z: PpZahlung | null }): number {
    return st.z?.am ? st.z.betrag : sollFuer(t, m)
  }
  /** Monat → Posten für die Sammel-Aktionen (Betrag je Monat, ggf. abweichend). */
  function posten(t: PpTeilnehmer, monate: number[]) {
    return monate.map(m => ({ monat: ppMonthKey(jahr, m), betrag: sollFuer(t, m), soll: zahlungen[t.id]?.[ppMonthKey(jahr, m)]?.soll ?? null }))
  }

  // ── Summary numbers ──
  const summe = useMemo(() => {
    let erwartet = 0
    let eingegangen = 0
    for (const t of jahresTeilnehmer) {
      for (const m of ppActiveMonths(t, jahr)) {
        erwartet += sollFuer(t, m)
        const st = zahlungFuer(t, m)
        if (st.bezahlt) eingegangen += bezahltBetrag(t, m, st)
      }
    }
    return { erwartet, eingegangen, offen: Math.max(0, erwartet - eingegangen) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahresTeilnehmer, zahlungen, jahr])

  function openCell(t: PpTeilnehmer, m: number) {
    const ym = ppMonthKey(jahr, m)
    const st = zahlungFuer(t, m)
    setCell({
      t,
      monat: ym,
      monatLabel: `${MONATE_KURZ[m - 1]} ${jahr}`,
      zahlung: st.z,
      autoBezahlt: st.auto,
      am: st.z?.am ?? heute,
      notiz: st.z?.notiz ?? '',
      betrag: String(st.z?.am ? st.z.betrag : ppSoll(t, st.z)),
      soll: String(ppSoll(t, st.z)),
    })
  }

  function toggleCell(t: PpTeilnehmer, m: number) {
    const ym = ppMonthKey(jahr, m)
    const st = zahlungFuer(t, m)
    if (!st.bezahlt) {
      // suspended auto month → re-enable; otherwise pay today
      if (st.z?.ausgesetzt && t.methode === 'lohnabzug' && t.autoLohn) {
        run(() => setPpAussetzung(t.id, ym, false, st.z?.soll ?? null))
      } else {
        run(() => setPpZahlung(t.id, ym, heute, ppSoll(t, st.z), st.z?.notiz ?? null, t.methode === 'lohnabzug' ? 'lohnabzug' : 'monat', st.z?.soll ?? null))
      }
    } else {
      openCell(t, m)   // details / entfernen via dialog — no accidental clearing
    }
  }

  async function openRechnungPdf(r: RechnungEdit, dl: boolean) {
    setRechnungBusy(dl ? 'dl' : 'open')
    setError(null)
    const fw = dl ? null : openFileWindow()
    try {
      // persist the (possibly edited) address on the participant
      await savePpTeilnehmer({ ...r.t, adresse: r.adresse })
      const res = await fetch('/api/admin/parkplatz-rechnung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jahr, name: r.name, adresse: r.adresse, monatsbetrag: r.t.betrag, bezahltAm: r.bezahltAm }),
      })
      if (!res.ok) throw new Error('PDF-Erstellung fehlgeschlagen')
      const blob = await res.blob()
      if (dl) downloadBlob(blob, `Rechnung Parkplatz ${jahr} ${r.name}.pdf`)
      else {
        const url = URL.createObjectURL(blob)
        fw!.show(url)
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
      router.refresh()
    } catch (err) {
      fw?.cancel()
      setError(err instanceof Error ? err.message : 'PDF-Erstellung fehlgeschlagen')
    } finally {
      setRechnungBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Parkplätze</h1>
          <p className="page-subtitle">Vermietung der Einstellhallen-Parkplätze und Zahlungskontrolle</p>
        </div>
        <div className="flex items-center gap-1 bg-surface border border-edge-ctl rounded-xl p-1">
          <button onClick={() => setTab('uebersicht')}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'uebersicht' ? 'bg-white shadow-sm text-ink' : 'text-ink-4 hover:text-ink-2'}`}>
            Übersicht
          </button>
          <button onClick={() => setTab('mieter')}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'mieter' ? 'bg-white shadow-sm text-ink' : 'text-ink-4 hover:text-ink-2'}`}>
            Mieterinnen
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {error}</p>
      )}

      {tab === 'uebersicht' ? (
        <>
          {/* ── Summary ── */}
          <div className="card p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <p className="text-sm font-bold text-ink">Jahr {jahr}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setJahr(j => j - 1)} className="w-[30px] h-[30px] rounded-ctl border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row transition-colors">‹</button>
                <span className="text-sm font-bold text-ink tnum w-12 text-center">{jahr}</span>
                <button onClick={() => setJahr(j => j + 1)} className="w-[30px] h-[30px] rounded-ctl border border-edge-ctl bg-white text-ink-2 hover:bg-edge-row transition-colors">›</button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-surface border border-edge rounded-tile p-4">
                <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-[.12em]">Kosten Praxis</p>
                <p className="text-lg font-bold text-ink tnum mt-1">{fmtChf(PP_PLAETZE * PP_KOSTEN_PRO_PLATZ)}<span className="text-xs font-semibold text-ink-4"> / Monat</span></p>
                <p className="text-[11px] text-ink-4 tnum">{PP_PLAETZE} Plätze × {fmtChf(PP_KOSTEN_PRO_PLATZ)} · {fmtChf(PP_PLAETZE * PP_KOSTEN_PRO_PLATZ * 12)} / Jahr</p>
              </div>
              <div className="bg-surface border border-edge rounded-tile p-4">
                <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-[.12em]">Erwartet {jahr}</p>
                <p className="text-lg font-bold text-ink tnum mt-1">{fmtChf(summe.erwartet)}</p>
                <p className="text-[11px] text-ink-4">{jahresTeilnehmer.length} Mieterin{jahresTeilnehmer.length !== 1 ? 'nen' : ''}</p>
              </div>
              <div className="bg-mint-bg border border-mint-ink/20 rounded-tile p-4">
                <p className="text-[10px] font-semibold text-mint-ink uppercase tracking-[.12em]">Eingegangen</p>
                <p className="text-lg font-bold text-mint-ink tnum mt-1">{fmtChf(summe.eingegangen)}</p>
              </div>
              <div className={`rounded-tile p-4 border ${summe.offen > 0 ? 'bg-apricot-bg border-apricot-ink/20' : 'bg-surface border-edge'}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-[.12em] ${summe.offen > 0 ? 'text-apricot-ink' : 'text-ink-4'}`}>Offen</p>
                <p className={`text-lg font-bold tnum mt-1 ${summe.offen > 0 ? 'text-apricot-ink' : 'text-ink'}`}>{fmtChf(summe.offen)}</p>
              </div>
            </div>
          </div>

          {/* ── Grid ── */}
          <div className="card overflow-hidden">
            {jahresTeilnehmer.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-semibold text-ink-2">Keine Mieterinnen im Jahr {jahr}</p>
                <p className="text-xs text-ink-4 mt-1">Unter «Mieterinnen» könnt ihr Personen hinzufügen.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-edge-soft bg-surface">
                      <th className="px-4 py-2.5 text-left font-semibold text-ink-4 uppercase tracking-wider text-[10px] whitespace-nowrap">Mieterin</th>
                      {MONATE_KURZ.map(m => (
                        <th key={m} className="px-1 py-2.5 text-center font-semibold text-ink-4 text-[10px] uppercase">{m}</th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-semibold text-ink-4 uppercase tracking-wider text-[10px] whitespace-nowrap">Bezahlt / Erwartet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge-row">
                    {jahresTeilnehmer.map(t => {
                      const aktiveMonate = ppActiveMonths(t, jahr)
                      const erwartetRow = aktiveMonate.reduce((s, m) => s + sollFuer(t, m), 0)
                      let bezahltRow = 0
                      for (const m of aktiveMonate) {
                        const st = zahlungFuer(t, m)
                        if (st.bezahlt) bezahltRow += bezahltBetrag(t, m, st)
                      }
                      const beendet = !!t.bis && t.bis < currentYM
                      const jahresMonate = aktiveMonate.map(m => ppMonthKey(jahr, m))
                      const jahrBezahlt = t.methode === 'jahresrechnung'
                        && aktiveMonate.length > 0
                        && aktiveMonate.every(m => zahlungFuer(t, m).bezahlt)
                      const jahrAm = jahrBezahlt ? (zahlungen[t.id]?.[jahresMonate[0]]?.am ?? null) : null
                      const offeneBisherige = aktiveMonate.filter(m => ppMonthKey(jahr, m) <= currentYM && !zahlungFuer(t, m).bezahlt)

                      return (
                        <tr key={t.id} className="hover:bg-hovrow">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <p className="font-bold text-ink text-[12.5px]">{t.name}{beendet && <span className="ml-1.5 text-[10px] font-semibold text-ink-4">(beendet)</span>}</p>
                            <p className="text-[10.5px] text-ink-4 tnum">{methodeLabel(t.methode)} · {fmtChf(t.betrag)}/Mt.</p>
                            {t.notiz && (
                              <p className="text-[10.5px] text-ink-3 mt-0.5 max-w-[240px] whitespace-pre-line line-clamp-2" title={t.notiz}>{t.notiz}</p>
                            )}
                            <button
                              onClick={() => setNotizEdit({ t, text: t.notiz ?? '' })}
                              className="mt-1 mr-3 text-[10px] font-semibold text-steel-ink hover:underline underline-offset-2"
                              title={t.notiz ? 'Notiz bearbeiten' : 'Notiz zu dieser Mieterin erfassen'}
                            >✎ Notiz</button>
                            {t.methode !== 'jahresrechnung' && offeneBisherige.length > 0 && (
                              <button
                                onClick={() => { if (confirm(`${t.name}: alle ${offeneBisherige.length} bisherigen offenen Monate ${jahr} als heute bezahlt abhaken?`)) run(() => setPpBisherigeBezahlt(t.id, posten(t, offeneBisherige))) }}
                                disabled={busy}
                                className="mt-1 text-[10px] font-semibold text-mint-ink hover:underline underline-offset-2 disabled:opacity-50"
                              >✓ Alle bisherigen abhaken</button>
                            )}
                          </td>

                          {t.methode === 'jahresrechnung' ? (
                            <td colSpan={12} className="px-3 py-2.5">
                              <div className="flex items-center gap-3 flex-wrap">
                                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={jahrBezahlt}
                                    disabled={busy}
                                    onChange={e => {
                                      if (e.target.checked) run(() => setPpJahrBezahlt(t.id, jahr, heute, posten(t, aktiveMonate)))
                                      else if (confirm(`Jahreszahlung ${jahr} von ${t.name} wieder entfernen?`)) run(() => setPpJahrBezahlt(t.id, jahr, null, posten(t, aktiveMonate)))
                                    }}
                                    className="w-4 h-4 accent-[#3F6B62]"
                                  />
                                  <span className="text-[12px] font-semibold text-ink">
                                    Jahresbetrag {fmtChf(erwartetRow)}
                                    {jahrBezahlt && jahrAm ? <span className="text-mint-ink"> — bezahlt am {fmtCH(jahrAm)}</span> : ' bezahlt'}
                                  </span>
                                </label>
                                <button
                                  onClick={() => setRechnung({ t, name: t.name, adresse: t.adresse ?? '', bezahltAm: jahrAm })}
                                  className="btn-secondary text-[11px] py-1 px-2.5"
                                >Rechnung erstellen (PDF)</button>
                              </div>
                            </td>
                          ) : (
                            MONATE_KURZ.map((_, i) => {
                              const m = i + 1
                              const ym = ppMonthKey(jahr, m)
                              const aktiv = aktiveMonate.includes(m)
                              if (!aktiv) return <td key={m} className="px-1 py-2.5 text-center bg-surface/60" />
                              const st = zahlungFuer(t, m)
                              const ueberfaellig = !st.bezahlt && ym < currentYM
                              const soll = sollFuer(t, m)
                              const abweichend = Math.abs(soll - t.betrag) > 0.004 || (!!st.z?.am && Math.abs(st.z.betrag - soll) > 0.004)
                              return (
                                <td key={m} className={`px-1 py-2.5 text-center ${ueberfaellig ? 'bg-apricot-bg/60' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={st.bezahlt}
                                    disabled={busy}
                                    onChange={() => toggleCell(t, m)}
                                    title={st.bezahlt
                                      ? (st.auto ? 'Lohnabzug (automatisch) — klicken für Details' : `Bezahlt am ${st.z?.am ? fmtCH(st.z.am) : ''} — klicken für Details`)
                                      : (ueberfaellig ? 'Überfällig — klicken zum Abhaken' : 'Klicken zum Abhaken')}
                                    className={`w-4 h-4 cursor-pointer ${st.auto ? 'accent-[#4F6B8F]' : 'accent-[#3F6B62]'}`}
                                  />
                                  {abweichend && (
                                    <p className="text-[9px] text-ink-3 tnum leading-none mt-0.5"
                                      title={`Monatsbetrag ${fmtChf(soll)}${st.z?.am ? ` · bezahlt ${fmtChf(st.z.betrag)}` : ''}`}>
                                      {st.z?.am ? st.z.betrag : soll}
                                    </p>
                                  )}
                                </td>
                              )
                            })
                          )}

                          <td className="px-4 py-2.5 text-right whitespace-nowrap tnum">
                            <span className={`font-bold ${bezahltRow >= erwartetRow ? 'text-mint-ink' : 'text-ink'}`}>{fmtChf(bezahltRow)}</span>
                            <span className="text-ink-4"> / {fmtChf(erwartetRow)}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-edge-ctl bg-surface">
                      <td className="px-4 py-2.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Total pro Monat</td>
                      {MONATE_KURZ.map((_, i) => {
                        const m = i + 1
                        let tot = 0
                        for (const t of jahresTeilnehmer) {
                          if (!ppActiveMonths(t, jahr).includes(m)) continue
                          const st = zahlungFuer(t, m)
                          if (st.bezahlt) tot += bezahltBetrag(t, m, st)
                        }
                        return <td key={m} className="px-1 py-2.5 text-center text-[10px] font-bold text-ink-2 tnum">{tot > 0 ? tot : '–'}</td>
                      })}
                      <td className="px-4 py-2.5 text-right text-[11px] font-bold text-ink tnum">
                        {fmtChf(summe.eingegangen)} / {fmtChf(summe.erwartet)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-ink-4 leading-relaxed max-w-[76ch]">
            Häkchen = Monat bezahlt. Ein Klick auf ein gesetztes Häkchen zeigt Datum und Notiz der
            Zahlung (dort lässt sie sich auch entfernen). Orange hinterlegte Monate sind überfällig.
            Bei «Lohnabzug» mit Automatik werden vergangene Monate automatisch als bezahlt gezeigt
            (blaues Häkchen) — einzelne Monate lassen sich im Detail-Fenster als Ausnahme aussetzen.
            Bei «Jahresrechnung» zählt der ganze Jahresbetrag mit einem Häkchen; die Rechnung und
            nach der Zahlung die Zahlungsbestätigung kommen aus «Rechnung erstellen (PDF)».
            Im Detail-Fenster eines Monats lassen sich der bezahlte Betrag und ein abweichender
            Monatsbetrag (z. B. halber Monat) erfassen — abweichende Beträge stehen klein unter dem
            Häkchen. «✎ Notiz» hält Abmachungen zur Mieterin fest.
          </p>
        </>
      ) : (
        <MieterTab
          teilnehmer={teilnehmer}
          profiles={profiles}
          busy={busy}
          run={run}
          currentYM={currentYM}
        />
      )}

      {/* ── Cell detail dialog ── */}
      {cell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setCell(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-sm p-5">
            <p className="text-sm font-bold text-ink mb-0.5">{cell.t.name} — {cell.monatLabel}</p>
            <p className="text-[11px] text-ink-4 mb-4 tnum">{methodeLabel(cell.t.methode)} · Standard {fmtChf(cell.t.betrag)}/Monat</p>

            {cell.autoBezahlt ? (
              <>
                <p className="text-xs text-ink-3 mb-3">
                  Dieser Monat gilt automatisch als bezahlt (Lohnabzug über die Lohnabrechnung).
                </p>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-ink-2 mb-1">Monatsbetrag (Soll) CHF</label>
                  <input type="number" min={0} step="0.05" value={cell.soll}
                    onChange={e => setCell({ ...cell, soll: e.target.value })} className="input-field text-sm" />
                  <p className="text-[10px] text-ink-4 mt-0.5">Standard {fmtChf(cell.t.betrag)} — hier abweichend, wenn in diesem Monat ein anderer Betrag über den Lohn läuft.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setCell(null)} className="btn-secondary flex-1">Schliessen</button>
                  <button
                    onClick={() => { run(() => setPpAussetzung(cell.t.id, cell.monat, true, sollOverride(cell))); setCell(null) }}
                    disabled={busy}
                    className="btn-secondary flex-1 text-blush-ink"
                  >Als unbezahlt aussetzen</button>
                  <button
                    onClick={() => { run(() => setPpZahlung(cell.t.id, cell.monat, null, 0, cell.notiz || null, 'lohnabzug', sollOverride(cell))); setCell(null) }}
                    disabled={busy}
                    className="btn-primary flex-1"
                  >Speichern</button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">Bezahlt am</label>
                      <input type="date" value={cell.am} onChange={e => setCell({ ...cell, am: e.target.value })} className="input-field text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">Betrag bezahlt CHF</label>
                      <input type="number" min={0} step="0.05" value={cell.betrag}
                        onChange={e => setCell({ ...cell, betrag: e.target.value })} className="input-field text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-2 mb-1">Monatsbetrag (Soll) CHF</label>
                    <input type="number" min={0} step="0.05" value={cell.soll}
                      onChange={e => {
                        const v = e.target.value
                        // bezahlter Betrag folgt dem Soll, solange er nicht separat angepasst wurde
                        setCell({ ...cell, soll: v, betrag: cell.betrag === cell.soll ? v : cell.betrag })
                      }}
                      className="input-field text-sm" />
                    <p className="text-[10px] text-ink-4 mt-0.5">
                      Standard {fmtChf(cell.t.betrag)} — hier abweichend, wenn für diesen Monat ein anderer Betrag gilt (z. B. halber Monat).
                      Ohne Zahlungsdatum wird nur der Monatsbetrag gespeichert, der Monat bleibt offen.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-2 mb-1">Notiz (optional)</label>
                    <input type="text" value={cell.notiz} maxLength={300} onChange={e => setCell({ ...cell, notiz: e.target.value })}
                      placeholder="z. B. bar erhalten" className="input-field text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 mt-5 flex-wrap">
                  <button onClick={() => setCell(null)} className="btn-secondary flex-1">Abbrechen</button>
                  {cell.zahlung?.am && !cell.zahlung.ausgesetzt && (
                    <button
                      onClick={() => { run(() => clearPpZahlung(cell.t.id, cell.monat, sollOverride(cell))); setCell(null) }}
                      disabled={busy}
                      className="btn-secondary flex-1 text-blush-ink"
                    >Zahlung entfernen</button>
                  )}
                  <button
                    onClick={() => {
                      run(() => setPpZahlung(cell.t.id, cell.monat, cell.am || null, betragWert(cell), cell.notiz || null, cell.t.methode === 'lohnabzug' ? 'lohnabzug' : 'monat', sollOverride(cell)))
                      setCell(null)
                    }}
                    disabled={busy}
                    className="btn-primary flex-1"
                  >{cell.am ? 'Speichern' : 'Monatsbetrag speichern (offen)'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Notiz dialog ── */}
      {notizEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setNotizEdit(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5">
            <p className="text-sm font-bold text-ink mb-0.5">Notiz — {notizEdit.t.name}</p>
            <p className="text-[11px] text-ink-4 mb-3">Abmachungen, Besonderheiten oder Erinnerungen zu dieser Mieterin. Nur für Admins sichtbar.</p>
            <textarea value={notizEdit.text} rows={5} maxLength={1000}
              onChange={e => setNotizEdit({ ...notizEdit, text: e.target.value })}
              placeholder="z. B. zahlt jeweils Anfang Quartal bar · Platz Nr. 4"
              className="input-field text-sm resize-y" />
            <p className="text-[10px] text-ink-4 mt-1 text-right tnum">{notizEdit.text.length} / 1000</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setNotizEdit(null)} className="btn-secondary flex-1">Abbrechen</button>
              <button
                onClick={() => { const { t, text } = notizEdit; run(() => savePpTeilnehmer({ ...t, notiz: text.trim() || null })); setNotizEdit(null) }}
                disabled={busy}
                className="btn-primary flex-1"
              >Speichern</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rechnung dialog ── */}
      {rechnung && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setRechnung(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5">
            <p className="text-sm font-bold text-ink mb-1">Jahresrechnung {jahr} — {rechnung.t.name}</p>
            <p className="text-[11px] text-ink-4 mb-4 tnum">
              Miete Parkplatz Einstellhalle · 01.01.{jahr} – 31.12.{jahr} · {fmtChf(rechnung.t.betrag)}/Monat · Total {fmtChf(rechnung.t.betrag * 12)}
              {rechnung.bezahltAm && <span className="text-mint-ink"> · bezahlt am {fmtCH(rechnung.bezahltAm)} (wird als Zahlungsbestätigung ausgewiesen)</span>}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Empfängerin / Empfänger</label>
                <input type="text" value={rechnung.name} onChange={e => setRechnung({ ...rechnung, name: e.target.value })} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Adresse</label>
                <textarea value={rechnung.adresse} rows={3} onChange={e => setRechnung({ ...rechnung, adresse: e.target.value })}
                  placeholder={'Musterstrasse 1\n3122 Kehrsatz'} className="input-field text-sm resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-5 flex-wrap">
              <button onClick={() => setRechnung(null)} className="btn-secondary flex-1">Schliessen</button>
              <button onClick={() => openRechnungPdf(rechnung, true)} disabled={!!rechnungBusy} className="btn-secondary flex-1">
                {rechnungBusy === 'dl' ? 'Wird erstellt…' : '↓ Herunterladen'}
              </button>
              <button onClick={() => openRechnungPdf(rechnung, false)} disabled={!!rechnungBusy} className="btn-primary flex-1">
                {rechnungBusy === 'open' ? 'Wird erstellt…' : '⎙ PDF öffnen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════ Mieterinnen tab ════════════════════════════════════

type FormState = {
  id: string
  name: string
  pensum: string
  betrag: string
  betragManuell: boolean
  methode: PpMethode
  von: string
  bis: string
  autoLohn: boolean
  notiz: string
  adresse: string
  isNew: boolean
}

function MieterTab({
  teilnehmer, profiles, busy, run, currentYM,
}: {
  teilnehmer: PpTeilnehmer[]
  profiles: Profile[]
  busy: boolean
  run: (fn: () => Promise<{ error?: string } | undefined>) => Promise<void>
  currentYM: string
}) {
  const [form, setForm] = useState<FormState | null>(null)
  const vorhandene = new Set(teilnehmer.map(t => t.id))
  const auswahl = profiles.filter(p => !vorhandene.has(p.id))

  function neu() {
    setForm({
      id: '', name: '', pensum: '100', betrag: '100', betragManuell: false,
      methode: 'bar', von: currentYM, bis: '', autoLohn: true, notiz: '', adresse: '', isNew: true,
    })
  }
  function bearbeiten(t: PpTeilnehmer) {
    setForm({
      id: t.id, name: t.name, pensum: String(t.pensum), betrag: String(t.betrag),
      betragManuell: Math.round(t.pensum) !== Math.round(t.betrag),
      methode: t.methode, von: t.von, bis: t.bis ?? '', autoLohn: t.autoLohn,
      notiz: t.notiz ?? '', adresse: t.adresse ?? '', isNew: false,
    })
  }

  function setPensum(f: FormState, pensum: string): FormState {
    const p = parseFloat(pensum)
    // CHF 100 bei 100 % Pensum, anteilig — solange nicht manuell übersteuert
    const betrag = !f.betragManuell && !isNaN(p) ? String(Math.round(p)) : f.betrag
    return { ...f, pensum, betrag }
  }

  function speichern() {
    if (!form) return
    const pensum = parseFloat(form.pensum)
    const betrag = parseFloat(form.betrag)
    run(() => savePpTeilnehmer({
      id: form.id,
      name: form.name,
      pensum: isNaN(pensum) ? 100 : pensum,
      betrag: isNaN(betrag) ? 100 : betrag,
      methode: form.methode,
      von: form.von,
      bis: form.bis || null,
      autoLohn: form.autoLohn,
      notiz: form.notiz || null,
      adresse: form.adresse || null,
    })).then(() => setForm(null))
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={neu} className="btn-primary">＋ Mieterin hinzufügen</button>
      </div>

      <div className="card overflow-hidden">
        {teilnehmer.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-ink-2">Noch keine Mieterinnen erfasst</p>
            <p className="text-xs text-ink-4 mt-1">Mit «Mieterin hinzufügen» die erste Person erfassen.</p>
          </div>
        ) : (
          <ul className="divide-y divide-edge-row">
            {teilnehmer.map(t => {
              const beendet = !!t.bis && t.bis < currentYM
              return (
                <li key={t.id} className="px-5 py-3.5 flex items-center gap-4 flex-wrap hover:bg-hovrow">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm font-bold text-ink">
                      {t.name}
                      {beendet
                        ? <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-4">beendet {t.bis!.slice(5, 7)}.{t.bis!.slice(0, 4)}</span>
                        : <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">aktiv</span>}
                    </p>
                    <p className="text-[11.5px] text-ink-4 tnum mt-0.5">
                      {methodeLabel(t.methode)}{t.methode === 'lohnabzug' && t.autoLohn ? ' (automatisch)' : ''} · Pensum {t.pensum}% · {fmtChf(t.betrag)}/Monat ·
                      seit {t.von.slice(5, 7)}.{t.von.slice(0, 4)}
                    </p>
                    {t.notiz && <p className="text-[11px] text-ink-4 mt-0.5 whitespace-pre-line">{t.notiz}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => bearbeiten(t)} className="btn-secondary text-xs py-1.5 px-3">Bearbeiten</button>
                    {!t.bis && (
                      <button
                        onClick={() => { if (confirm(`Vermietung von ${t.name} per Ende dieses Monats beenden?\nAlle bisherigen Zahlungen bleiben erhalten.`)) run(() => savePpTeilnehmer({ ...t, bis: currentYM })) }}
                        disabled={busy}
                        className="btn-secondary text-xs py-1.5 px-3 text-blush-ink"
                      >Beenden</button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* ── Form dialog ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-lg p-5 my-8">
            <p className="text-sm font-bold text-ink mb-4">{form.isNew ? 'Mieterin hinzufügen' : `${form.name} bearbeiten`}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {form.isNew && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-ink-2 mb-1">Mitarbeiterin *</label>
                  <select
                    value={form.id}
                    onChange={e => {
                      const p = auswahl.find(x => x.id === e.target.value)
                      if (!p) return
                      const pensum = p.pensum != null ? String(p.pensum) : '100'
                      setForm(setPensum({ ...form, id: p.id, name: p.full_name, pensum }, pensum))
                    }}
                    className="select-field text-sm"
                  >
                    <option value="">— wählen —</option>
                    {auswahl.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Pensum %</label>
                <input type="number" min={1} max={100} value={form.pensum}
                  onChange={e => setForm(setPensum(form, e.target.value))} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Betrag CHF / Monat</label>
                <input type="number" min={0} step="0.05" value={form.betrag}
                  onChange={e => setForm({ ...form, betrag: e.target.value, betragManuell: true })} className="input-field text-sm" />
                <p className="text-[10px] text-ink-4 mt-0.5">Automatisch CHF 100 × Pensum — hier übersteuerbar.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Zahlungsweise</label>
                <select value={form.methode} onChange={e => setForm({ ...form, methode: e.target.value as PpMethode })} className="select-field text-sm">
                  {PP_METHODEN.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              {form.methode === 'lohnabzug' && (
                <div className="flex items-end pb-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-ink-2 font-medium">
                    <input type="checkbox" checked={form.autoLohn} onChange={e => setForm({ ...form, autoLohn: e.target.checked })} className="w-4 h-4 accent-[#4F6B8F]" />
                    automatisch als bezahlt markieren
                  </label>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Aktiv ab (Monat) *</label>
                <input type="month" value={form.von} onChange={e => setForm({ ...form, von: e.target.value })} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Aktiv bis (Monat, optional)</label>
                <input type="month" value={form.bis} onChange={e => setForm({ ...form, bis: e.target.value })} className="input-field text-sm" />
              </div>
              {form.methode === 'jahresrechnung' && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-ink-2 mb-1">Rechnungsadresse</label>
                  <textarea value={form.adresse} rows={2} onChange={e => setForm({ ...form, adresse: e.target.value })}
                    placeholder={'Musterstrasse 1\n3122 Kehrsatz'} className="input-field text-sm resize-none" />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-2 mb-1">Notiz (optional)</label>
                <textarea value={form.notiz} rows={3} maxLength={1000} onChange={e => setForm({ ...form, notiz: e.target.value })}
                  placeholder="Abmachungen, Besonderheiten, Erinnerungen" className="input-field text-sm resize-y" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              {!form.isNew && (
                <button
                  onClick={() => { if (confirm(`${form.name} komplett entfernen? (Nur möglich, solange keine Zahlungen erfasst sind.)`)) { run(() => deletePpTeilnehmer(form.id)); setForm(null) } }}
                  disabled={busy}
                  className="btn-secondary text-blush-ink"
                >Entfernen</button>
              )}
              <div className="flex-1" />
              <button onClick={() => setForm(null)} className="btn-secondary">Abbrechen</button>
              <button onClick={speichern} disabled={busy || (form.isNew && !form.id)} className="btn-primary">
                {busy ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
