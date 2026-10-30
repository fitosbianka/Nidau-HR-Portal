'use client'

// Einsätze einer externen Person auf der Mitarbeiterseite (nur Admins):
// kompakte Tabelle nach Monaten mit Datum, Zeit, Art und Status. Pro
// Einsatz Erledigt oder Abgesagt setzen, Zeiten ändern (einzeln oder für
// alle Einsätze ohne Zeit), alte Einsätze der früheren Vereinbarung 2027
// entfernen.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { einsatzStatusSetzen, einsatzZeitenSetzen, alteEinsaetzeEntfernen } from '@/actions/externe-einsaetze'
import { datumLang, zeitText, istAlteVereinbarung, type ExternEinsatz, type EinsatzStatus } from '@/lib/externe-einsaetze'

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
type Filter = 'offen' | 'alle' | 'erledigt' | 'abgesagt'
const KNOPF = 'px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-50'

export default function ExternEinsaetze({ employeeId, vorname, einsaetze, heute, readOnly = false }: {
  employeeId: string
  vorname: string
  einsaetze: ExternEinsatz[]
  /** Heutiges Datum in Schweizer Zeit, YYYY-MM-DD */
  heute: string
  /** Eigene Ansicht der externen Person: dieselbe Liste ohne Erledigt, Abgesagt und Zeiten ändern */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<Filter>('offen')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [laufend, setLaufend] = useState<string | null>(null)
  const [zeiten, setZeiten] = useState<{ eintraege: Array<{ datum: string; id: string }>; von: string; bis: string; titel: string } | null>(null)

  const zaehler = useMemo(() => ({
    erledigt: einsaetze.filter(e => e.status === 'erledigt').length,
    abgesagt: einsaetze.filter(e => e.status === 'abgesagt').length,
    faellig: einsaetze.filter(e => e.status === 'offen' && e.datum < heute).length,
    geplant: einsaetze.filter(e => e.status === 'offen' && e.datum >= heute).length,
  }), [einsaetze, heute])
  const ohneZeit = useMemo(() => einsaetze.filter(e => e.status === 'offen' && !e.von), [einsaetze])
  const alte = useMemo(() => einsaetze.filter(istAlteVereinbarung).length, [einsaetze])
  const sichtbar = useMemo(() => einsaetze.filter(e => filter === 'alle' || e.status === filter), [einsaetze, filter])
  const monate = useMemo(() => {
    const m = new Map<string, ExternEinsatz[]>()
    for (const e of sichtbar) { const k = e.datum.slice(0, 7); m.set(k, [...(m.get(k) ?? []), e]) }
    return Array.from(m.entries())
  }, [sichtbar])
  const monatName = (k: string) => `${MONATE[parseInt(k.slice(5, 7), 10) - 1]} ${k.slice(0, 4)}`

  function lauf(id: string, fn: () => Promise<{ error?: string } | { success: true }>, ok?: string) {
    setMsg(null); setLaufend(id)
    startTransition(async () => {
      try {
        const r = await fn()
        if ('error' in r && r.error) setMsg({ type: 'err', text: r.error })
        else { if (ok) setMsg({ type: 'ok', text: ok }); router.refresh() }
      } catch { setMsg({ type: 'err', text: 'Verbindung unterbrochen. Bitte erneut versuchen.' }) }
      finally { setLaufend(null) }
    })
  }
  const status = (e: ExternEinsatz, s: EinsatzStatus) => lauf(e.id, () => einsatzStatusSetzen(employeeId, e.datum, e.id, s))
  function zeitenSpeichern() {
    if (!zeiten) return
    if (!zeiten.von || !zeiten.bis || zeiten.bis <= zeiten.von) { setMsg({ type: 'err', text: 'Bitte Von und Bis angeben, Bis nach Von.' }); return }
    const z = zeiten
    lauf('zeiten', async () => {
      const r = await einsatzZeitenSetzen(employeeId, z.eintraege, z.von, z.bis)
      if (!('error' in r && r.error)) setZeiten(null)
      return r
    }, `Zeit ${zeitText(z.von, z.bis)} gespeichert.`)
  }
  const zeitOeffnen = (e: ExternEinsatz) => setZeiten({ eintraege: [{ datum: e.datum, id: e.id }], von: e.von ?? '13:00', bis: e.bis ?? '17:00', titel: `Zeit am ${datumLang(e.datum)}` })
  const zeitAlleOeffnen = () => setZeiten({ eintraege: ohneZeit.map(e => ({ datum: e.datum, id: e.id })), von: '13:00', bis: '17:00', titel: `Zeit für ${ohneZeit.length} Einsätze ohne Zeit` })

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-edge-soft flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-ink-2">Einsätze <span className="ml-1 text-ink-4 font-normal tnum">({einsaetze.length})</span></h2>
        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-mint-bg text-mint-ink tnum">{zaehler.erledigt} erledigt</span>
        {zaehler.faellig > 0 && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink tnum" title="Datum vorbei, noch nicht abgehakt">{zaehler.faellig} noch abzuhaken</span>}
        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-steel-bg text-steel-ink tnum">{zaehler.geplant} geplant</span>
        {zaehler.abgesagt > 0 && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-edge-row text-ink-3 tnum">{zaehler.abgesagt} abgesagt</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {(['offen', 'alle', 'erledigt', 'abgesagt'] as const).map(k => (
            <button key={k} onClick={() => setFilter(k)} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${filter === k ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`}>
              {k === 'offen' ? 'Offen' : k === 'alle' ? 'Alle' : k === 'erledigt' ? 'Erledigt' : 'Abgesagt'}
            </button>
          ))}
        </span>
      </div>

      {!readOnly && (msg || ohneZeit.length > 0 || alte > 0 || zeiten) && (
        <div className="px-5 pt-2.5 space-y-2 text-[12px]">
          {msg && <p className={`inline-block text-xs px-3 py-1.5 rounded-ctl ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}</p>}
          {!zeiten && ohneZeit.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-ink-2">
              <span>Für {ohneZeit.length === 1 ? 'einen Einsatz' : `${ohneZeit.length} Einsätze`} ist die Zeit noch offen.</span>
              <button onClick={zeitAlleOeffnen} className={`${KNOPF} bg-white text-ink-2 border-edge-ctl hover:bg-edge-row`}>Zeit für alle setzen</button>
            </p>
          )}
          {alte > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-ink-2">
              <span>Aus der früheren Vereinbarung sind noch {alte} feste Einsätze 2027 in der Ferienplanung gespeichert.</span>
              <button onClick={() => { if (confirm(`${alte} feste Einsätze 2027 aus der Ferienplanung entfernen? ${vorname} arbeitet 2027 nur noch in Vertretungswochen.`)) lauf('alte', () => alteEinsaetzeEntfernen(employeeId), 'Alte Einsätze entfernt.') }} disabled={isPending} className={`${KNOPF} bg-white text-blush-ink border-blush-bg hover:bg-blush-bg`}>{laufend === 'alte' ? 'Wird entfernt …' : 'Entfernen'}</button>
            </p>
          )}
          {zeiten && (
            <div className="rounded-xl border border-edge-ctl bg-surface px-3 py-2 flex flex-wrap items-end gap-3">
              <span className="font-semibold text-ink self-center">{zeiten.titel}</span>
              <label className="text-[11px] text-ink-4">Von<input type="time" value={zeiten.von} onChange={e => setZeiten(z => z ? { ...z, von: e.target.value } : z)} className="input-field !w-auto !py-1 block mt-0.5" /></label>
              <label className="text-[11px] text-ink-4">Bis<input type="time" value={zeiten.bis} onChange={e => setZeiten(z => z ? { ...z, bis: e.target.value } : z)} className="input-field !w-auto !py-1 block mt-0.5" /></label>
              <button onClick={zeitenSpeichern} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">{laufend === 'zeiten' ? 'Wird gespeichert …' : 'Speichern'}</button>
              <button onClick={() => setZeiten(null)} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
            </div>
          )}
        </div>
      )}

      {einsaetze.length === 0 ? (
        <p className="text-sm text-ink-4 py-8 text-center">Keine Einsätze für {vorname} hinterlegt.</p>
      ) : monate.length === 0 ? (
        <p className="text-sm text-ink-4 py-8 text-center">Keine Einsätze mit diesem Filter.</p>
      ) : (
        <table className="w-full text-[12px] tnum mt-1">
          <tbody>
            {monate.map(([k, liste]) => (
              <Monat key={k} name={monatName(k)} liste={liste} heute={heute} isPending={isPending} laufend={laufend} zeitenOffen={!!zeiten} readOnly={readOnly}
                onStatus={status} onZeit={zeitOeffnen} />
            ))}
          </tbody>
        </table>
      )}
      <p className="px-5 py-2 text-[10.5px] text-ink-4 border-t border-edge-soft">{readOnly ? 'Vertretungswochen ergeben sich aus der Ferienplanung, Dienstag und Donnerstag 13.00 bis 17.00 Uhr. Änderungen bitte direkt mit Bianka besprechen.' : 'Vertretungswochen ergeben sich aus der Ferienplanung, Dienstag und Donnerstag 13.00 bis 17.00 Uhr. Gesetzte Zeiten gelten auch dort.'}</p>
    </div>
  )
}

function Monat({ name, liste, heute, isPending, laufend, zeitenOffen, readOnly, onStatus, onZeit }: {
  name: string; liste: ExternEinsatz[]; heute: string; isPending: boolean; laufend: string | null; zeitenOffen: boolean; readOnly: boolean
  onStatus: (e: ExternEinsatz, s: EinsatzStatus) => void; onZeit: (e: ExternEinsatz) => void
}) {
  return (
    <>
      <tr><td colSpan={5} className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{name} <span className="normal-case tracking-normal">· {liste.length} {liste.length === 1 ? 'Einsatz' : 'Einsätze'}</span></td></tr>
      {liste.map(e => {
        const faellig = e.status === 'offen' && e.datum < heute
        const busy = laufend === e.id
        const aus = e.status !== 'offen'
        return (
          <tr key={e.id} className={`border-t border-edge-row ${e.status === 'erledigt' ? 'bg-mint-bg/20' : e.status === 'abgesagt' ? 'bg-edge-row/40' : faellig ? 'bg-apricot-bg/30' : ''}`}>
            <td className={`px-5 py-1 font-semibold whitespace-nowrap ${e.status === 'abgesagt' ? 'text-ink-4 line-through' : aus ? 'text-ink-3' : 'text-ink'}`}>{datumLang(e.datum)}</td>
            <td className={`py-1 whitespace-nowrap ${aus ? 'text-ink-4' : 'text-ink-2'}`}>
              {e.von && e.bis ? zeitText(e.von, e.bis) : <span className="text-apricot-ink font-semibold">Zeit offen</span>}
              {!zeitenOffen && !readOnly && <button onClick={() => onZeit(e)} disabled={isPending} className="ml-1.5 text-ink-4 hover:text-mint-ink align-middle" title="Zeit ändern"><svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg></button>}
            </td>
            <td className="py-1"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${e.art === 'vertretung' ? 'bg-lilac-bg text-lilac-ink' : 'bg-steel-bg text-steel-ink'}`}>{e.titel}</span></td>
            <td className="py-1 whitespace-nowrap">
              {e.status === 'erledigt' ? <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">✓ erledigt</span>
                : e.status === 'abgesagt' ? <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-3">abgesagt</span>
                : faellig ? <span className="text-[10.5px] font-semibold text-apricot-ink">noch nicht abgehakt</span>
                : <span className="text-[10.5px] text-ink-4">geplant</span>}
            </td>
            <td className="px-5 py-1 text-right whitespace-nowrap">
              {readOnly ? null : busy ? <span className="text-[11px] text-ink-4">Wird gespeichert …</span> : e.status === 'offen' ? (
                <span className="inline-flex gap-1">
                  <button onClick={() => onStatus(e, 'erledigt')} disabled={isPending} className={`${KNOPF} bg-mint-ink text-white border-mint-ink hover:opacity-90`} title="Einsatz hat stattgefunden">✓ Erledigt</button>
                  <button onClick={() => onStatus(e, 'abgesagt')} disabled={isPending} className={`${KNOPF} bg-white text-ink-3 border-edge-ctl hover:bg-edge-row`} title="Einsatz findet nicht statt">Abgesagt</button>
                </span>
              ) : (
                <button onClick={() => onStatus(e, 'offen')} disabled={isPending} className="text-[11px] text-ink-4 hover:text-ink-2 hover:underline" title="Status zurücksetzen, der Einsatz ist wieder offen">Zurück</button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}
