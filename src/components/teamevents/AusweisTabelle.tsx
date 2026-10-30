'use client'

// Übersicht der Organisatorin: die eingegebenen Ausweisdaten aller
// Teilnehmenden (Dokument, Nummer, Ablaufdatum, Bilder, Status), Einsicht
// und Erfassung im Dialog, Liste für die Hotel Vorregistrierung, Löschen
// nach der Reise. Daten kommen nur zu ihr.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ausweisDetails } from '@/actions/ausweise'
import { sensibleDatenLoeschen } from '@/actions/teamevent-programm'
import { AUSWEIS_ART_LABEL } from '@/lib/ausweise'
import { datumKurz } from '@/lib/teamevents'
import type { TeilnehmerZeile } from '@/lib/teamevent-programm-data'
import type { AusweisMitBildern } from '@/lib/ausweise-data'
import AusweisClient, { AusweisStatusBadge } from './AusweisClient'

export default function AusweisTabelle({ slug, zeilen, heute }: { slug: string; zeilen: TeilnehmerZeile[]; heute: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [offen, setOffen] = useState<{ zeile: TeilnehmerZeile; daten: AusweisMitBildern } | null>(null)
  const [loeschDialog, setLoeschDialog] = useState(false)
  const [bestaetigung, setBestaetigung] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const komplett = zeilen.filter(z => z.ausweis.komplett).length
  const problem = zeilen.filter(z => z.ausweis.status === 'abgelaufen' || z.ausweis.status === 'bald').length

  const hotelZeilen = () => zeilen.map(z => [z.name, z.ausweis.art ? AUSWEIS_ART_LABEL[z.ausweis.art] : '', z.ausweis.nummer ?? '', z.ausweis.ablauf ? datumKurz(z.ausweis.ablauf) : ''])
  async function kopieren() {
    const text = [['Name', 'Dokument', 'Nummer', 'Gültig bis'], ...hotelZeilen()].map(r => r.join('\t')).join('\n')
    try { await navigator.clipboard.writeText(text); setMsg({ type: 'ok', text: `Liste mit ${zeilen.length} Personen kopiert.` }) }
    catch { setMsg({ type: 'err', text: 'Kopieren hat nicht geklappt, bitte CSV herunterladen.' }) }
  }
  function csv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const text = [['Name', 'Dokument', 'Nummer', 'Gültig bis'], ...hotelZeilen()].map(r => r.map(esc).join(';')).join('\r\n')
    const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `Vorregistrierung_${slug}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
  }
  async function oeffnen(z: TeilnehmerZeile) {
    setBusy(z.id); setMsg(null)
    try {
      const r = await ausweisDetails(z.id)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      if ('ausweis' in r && r.ausweis) setOffen({ zeile: z, daten: r.ausweis })
    } finally { setBusy(null) }
  }
  function schliessen() { setOffen(null); router.refresh() }
  function loeschen() {
    setMsg(null)
    startTransition(async () => {
      const r = await sensibleDatenLoeschen(slug, bestaetigung)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      const ok = r as { ausweise: number; allergien: number; bilder: number }
      setLoeschDialog(false); setBestaetigung('')
      setMsg({ type: 'ok', text: `Gelöscht: ${ok.ausweise} Ausweiseinträge, ${ok.bilder} Bilder, ${ok.allergien} Allergieangaben.` })
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink">Ausweisdaten <span className="text-[10px] font-normal text-ink-4 ml-1">nur für die Organisatorin sichtbar</span></h2>
          <p className="text-[11px] text-ink-4 tnum">{komplett} von {zeilen.length} vollständig{problem > 0 ? ` · ${problem} abgelaufen oder bald ablaufend` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={kopieren} className="btn-secondary text-xs">Liste für Hotel kopieren</button>
          <button onClick={csv} className="btn-secondary text-xs">CSV herunterladen</button>
          <button onClick={() => setLoeschDialog(true)} className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50">Ausweis und Allergien löschen</button>
        </div>
      </div>
      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-4 border-b border-edge-soft">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Dokument</th>
                <th className="px-3 py-2 font-semibold">Nummer</th>
                <th className="px-3 py-2 font-semibold">Gültig bis</th>
                <th className="px-3 py-2 font-semibold">Bilder</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {zeilen.map(z => (
                <tr key={z.id} className={`border-b border-edge-row last:border-0 hover:bg-surface/60 ${z.ausweis.komplett ? '' : 'bg-apricot-bg/30'}`}>
                  <td className="px-4 py-2 font-semibold text-ink whitespace-nowrap">{z.name}</td>
                  <td className="px-3 py-2 text-ink-2 whitespace-nowrap">{z.ausweis.art ? AUSWEIS_ART_LABEL[z.ausweis.art] : <span className="text-ink-4">offen</span>}</td>
                  <td className="px-3 py-2 text-ink-2 tnum whitespace-nowrap">{z.ausweis.nummer ?? <span className="text-ink-4">offen</span>}</td>
                  <td className="px-3 py-2 text-ink-2 tnum whitespace-nowrap">{z.ausweis.ablauf ? datumKurz(z.ausweis.ablauf) : <span className="text-ink-4">offen</span>}</td>
                  <td className="px-3 py-2 text-ink-2 tnum">{z.ausweis.bilder || <span className="text-ink-4">0</span>}</td>
                  <td className="px-3 py-2"><AusweisStatusBadge status={z.ausweis.status} /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => oeffnen(z)} disabled={busy !== null} className="text-[11px] font-semibold text-mint-ink hover:underline">
                      {busy === z.id ? 'Lädt…' : z.ausweis.nummer || z.ausweis.bilder > 0 ? 'Ansehen' : 'Erfassen'}
                    </button>
                  </td>
                </tr>
              ))}
              {zeilen.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-ink-4">Noch keine Teilnehmenden.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-ink-4 px-1">Zeilen ohne vollständige Angaben sind hervorgehoben. Über «Ansehen» lassen sich Angaben und Bilder einsehen und als Organisatorin auch nach dem Eingabeschluss ergänzen.</p>

      {offen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={schliessen} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-2xl p-5 my-8">
            <div className="flex items-start justify-between gap-3 mb-4">
              <p className="text-sm font-bold text-ink">Ausweis von {offen.zeile.name}</p>
              <button onClick={schliessen} className="w-8 h-8 rounded-lg hover:bg-surface text-ink-4 text-sm" title="Schliessen">✕</button>
            </div>
            <AusweisClient profileId={offen.zeile.id} initial={offen.daten} heute={heute} personName={offen.zeile.name} eigene={false} />
          </div>
        </div>
      )}

      {loeschDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setLoeschDialog(false)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5">
            <p className="text-sm font-bold text-ink mb-1">Ausweis und Allergieangaben löschen</p>
            <p className="text-[12px] text-ink-2 mb-3">
              Löscht bei allen {zeilen.length} Teilnehmenden die Ausweisnummern, Ablaufdaten und Ausweisbilder sowie die Allergieangaben. Haken und Einstiegsort bleiben. Das lässt sich nicht rückgängig machen.
            </p>
            <label className="text-[11px] font-semibold text-ink-4 uppercase tracking-wider">Zur Bestätigung «löschen» eingeben</label>
            <input value={bestaetigung} onChange={e => setBestaetigung(e.target.value)} className="input-field text-sm w-full mt-1" autoFocus />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setLoeschDialog(false); setBestaetigung('') }} className="btn-secondary">Abbrechen</button>
              <button onClick={loeschen} disabled={isPending || bestaetigung.trim().toLowerCase() !== 'löschen'} className="btn-primary bg-red-600 hover:bg-red-700 border-red-600">
                {isPending ? 'Löscht…' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
