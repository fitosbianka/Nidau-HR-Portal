'use client'

// Übersicht der Organisatorin: Zimmer, Reservation, Abendessen und Pre
// Registration pro Person, nach Zimmern gruppiert; Zeilen mit offenen
// Angaben hervorgehoben; Menü Zusammenfassung für das Restaurant.

import { useMemo, useState, useTransition } from 'react'
import { useSerial } from './useSerial'
import { useRouter } from 'next/navigation'
import { detailsSpeichern, preRegSetzen, gastEntfernen, type DetailPatch } from '@/actions/teamevent-programm'
import { detailOffen, gastId, leeresDetail, leererCheck, type TeDetail } from '@/lib/teamevent-programm'
import type { TeilnehmerZeile } from '@/lib/teamevent-programm-data'
import { Fortschritt } from './MeineCheckliste'

type Menue = { vorspeise: string[]; hauptgang: string[]; dessert: string[] }
const GAENGE: Array<[keyof Menue, string]> = [['vorspeise', 'Vorspeise'], ['hauptgang', 'Hauptgang'], ['dessert', 'Dessert']]

function Auswahl({ wert, optionen, onChange }: { wert: string; optionen: string[]; onChange: (v: string) => void }) {
  const alle = wert && !optionen.includes(wert) ? [wert, ...optionen] : optionen
  return (
    <select value={wert} onChange={e => onChange(e.target.value)} className="input-field text-sm w-full">
      <option value="">noch offen</option>
      {alle.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function EditDialog({ slug, zeile, alle, menue, onClose }: { slug: string; zeile: TeilnehmerZeile; alle: TeilnehmerZeile[]; menue: Menue; onClose: () => void }) {
  const router = useRouter()
  const d = zeile.detail
  const [f, setF] = useState<DetailPatch>({
    name: d.name ?? '', zimmer: d.zimmer, zimmerMit: d.zimmerMit, resName: d.resName ?? '', resNr: d.resNr ?? '',
    vorspeise: d.vorspeise ?? '', hauptgang: d.hauptgang ?? '', dessert: d.dessert ?? '', auchPartner: true,
  })
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const partnerWahl = alle.filter(z => z.id !== zeile.id && z.id !== '')
  const neuerGast = zeile.gast && zeile.id === ''

  function speichern() {
    setErr(null)
    startTransition(async () => {
      const id = neuerGast ? gastId(f.name ?? '') : zeile.id
      if (neuerGast && alle.some(z => z.id === id)) { setErr('Einen Gast mit diesem Namen gibt es schon.'); return }
      const r = await detailsSpeichern(slug, id, f)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh(); onClose()
    })
  }
  function entfernen() {
    if (!confirm(`Gast «${zeile.name}» entfernen?`)) return
    setErr(null)
    startTransition(async () => {
      const r = await gastEntfernen(slug, zeile.id)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh(); onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-lg p-5 my-8 space-y-4">
        <p className="text-sm font-bold text-ink">{neuerGast ? 'Gast ohne Konto hinzufügen' : `Details ${zeile.name}`}</p>
        {zeile.gast && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Name</label>
            <input value={f.name ?? ''} onChange={e => setF(x => ({ ...x, name: e.target.value }))} className="input-field text-sm" placeholder="z. B. Odette" autoFocus={neuerGast} />
            <p className="text-[11px] text-ink-4">Gäste ohne Portal Konto haben Zimmer, Reservation und Menü, aber keine Checkliste und keinen Ausweis im Portal.</p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Zimmer</p>
          <div className="flex flex-wrap gap-2">
            {([['doppel', 'Doppelzimmer'], ['einzel', 'Einzelzimmer']] as Array<['doppel' | 'einzel', string]>).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF(x => ({ ...x, zimmer: k, zimmerMit: k === 'einzel' ? null : x.zimmerMit }))}
                className={`px-3 py-1.5 rounded-ctl border text-sm ${f.zimmer === k ? 'border-mint-mid bg-mint-bg text-mint-ink font-semibold' : 'border-edge-ctl text-ink-2'}`}>{l}</button>
            ))}
          </div>
          {f.zimmer === 'doppel' && (
            <select value={f.zimmerMit ?? ''} onChange={e => setF(x => ({ ...x, zimmerMit: e.target.value || null }))} className="input-field text-sm w-full">
              <option value="">Zimmer mit …</option>
              {partnerWahl.map(z => <option key={z.id} value={z.id}>{z.name}{z.gast ? ' (Gast)' : ''}</option>)}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Reservation auf</label>
            <input value={f.resName} onChange={e => setF(x => ({ ...x, resName: e.target.value }))} className="input-field text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Reservierungs Nr.</label>
            <input value={f.resNr} onChange={e => setF(x => ({ ...x, resNr: e.target.value }))} className="input-field text-sm tnum" placeholder="z. B. H14223618" />
          </div>
        </div>
        {f.zimmer === 'doppel' && f.zimmerMit && (
          <label className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
            <input type="checkbox" className="accent-mint-mid" checked={f.auchPartner} onChange={e => setF(x => ({ ...x, auchPartner: e.target.checked }))} />
            Reservation auch bei der Zimmerpartnerin eintragen
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {GAENGE.map(([k, l]) => (
            <div key={k} className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{l}</label>
              <Auswahl wert={f[k]} optionen={menue[k]} onChange={v => setF(x => ({ ...x, [k]: v }))} />
            </div>
          ))}
        </div>

        {err && <p className="text-xs text-blush-ink">⚠ {err}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          {zeile.gast && !neuerGast ? (
            <button onClick={entfernen} disabled={isPending} className="text-[11px] text-ink-4 hover:text-red-500">Gast entfernen</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button onClick={speichern} disabled={isPending || (zeile.gast && !(f.name ?? '').trim())} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ZimmerUndMenue({ slug, zeilen, menue }: { slug: string; zeilen: TeilnehmerZeile[]; menue: Menue }) {
  const [preReg, setPreReg] = useState<Record<string, boolean>>(() => Object.fromEntries(zeilen.map(z => [z.id, z.detail.preReg])))
  const [edit, setEdit] = useState<TeilnehmerZeile | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Nach Zimmern gruppieren: gleiche Reservierungs Nr. oder gegenseitige Zuordnung
  const gruppen = useMemo(() => {
    const key = (z: TeilnehmerZeile) => z.detail.resNr ? `nr:${z.detail.resNr}` : z.detail.zimmerMit ? `p:${[z.id, z.detail.zimmerMit].sort().join('+')}` : `id:${z.id}`
    const m = new Map<string, TeilnehmerZeile[]>()
    for (const z of zeilen) m.set(key(z), [...(m.get(key(z)) ?? []), z])
    return Array.from(m.values())
      .map(g => g.sort((a, b) => a.reihenfolge - b.reihenfolge))
      .sort((a, b) => Math.min(...a.map(z => z.reihenfolge)) - Math.min(...b.map(z => z.reihenfolge)))
  }, [zeilen])

  const zaehlung = useMemo(() => GAENGE.map(([k, l]) => {
    const c = new Map<string, number>()
    for (const z of zeilen) { const v = z.detail[k]; if (v) c.set(v, (c.get(v) ?? 0) + 1) }
    const offen = zeilen.filter(z => !z.detail[k]).length
    return { k, l, eintraege: Array.from(c.entries()).sort((a, b) => b[1] - a[1]), offen }
  }), [zeilen])

  const erledigt = zeilen.filter(z => preReg[z.id]).length
  const zimmerAnzahl = gruppen.length

  const nacheinander = useSerial()
  function toggle(id: string, wert: boolean) {
    setMsg(null); setPreReg(p => ({ ...p, [id]: wert }))
    void nacheinander(async () => {
      const r = await preRegSetzen(slug, id, wert)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); setPreReg(p => ({ ...p, [id]: !wert })) }
    })
  }

  async function kopieren() {
    const text = zaehlung.map(g => [g.l, ...g.eintraege.map(([v, n]) => `${v} ${n}`), ...(g.offen ? [`noch offen ${g.offen}`] : [])].join('\n')).join('\n\n')
    try { await navigator.clipboard.writeText(`Abendessen Captain's Finest, Freitag 23. Oktober 2026, 19.00 Uhr, ${zeilen.length} Personen\n\n${text}`); setMsg({ type: 'ok', text: 'Menü Zusammenfassung kopiert.' }) }
    catch { setMsg({ type: 'err', text: 'Kopieren hat nicht geklappt.' }) }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink">Zimmer und Abendessen <span className="text-[10px] font-normal text-ink-4 ml-1">nur für die Organisatorin sichtbar</span></h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEdit({ id: '', name: '', gast: true, check: leererCheck(), ausweis: { art: null, nummer: null, ablauf: null, komplett: false, bilder: 0, status: 'fehlt' }, fotos: 0, erledigt: 0, total: 0, offen: [], detail: leeresDetail(), zimmerMitName: null, reihenfolge: 999 })}
            className="btn-secondary text-xs">Gast ohne Konto hinzufügen</button>
          <button onClick={kopieren} className="btn-secondary text-xs">Menü für Restaurant kopieren</button>
        </div>
      </div>
      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      <div className="card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs font-semibold text-ink-2 whitespace-nowrap">Pre Registration</p>
        <div className="flex-1"><Fortschritt erledigt={erledigt} total={zeilen.length} /></div>
        <p className="text-[11px] text-ink-4 tnum whitespace-nowrap">{zimmerAnzahl} Zimmer · {zeilen.length} Personen</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {zaehlung.map(g => (
          <div key={g.k} className="card px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-1.5">{g.l}</p>
            <ul className="space-y-0.5 text-[12.5px]">
              {g.eintraege.map(([v, n]) => (
                <li key={v} className="flex justify-between gap-3"><span className="text-ink-2 truncate">{v}</span><span className="font-semibold text-ink tnum">{n}</span></li>
              ))}
              {g.offen > 0 && <li className="flex justify-between gap-3 text-apricot-ink"><span>noch offen</span><span className="font-semibold tnum">{g.offen}</span></li>}
            </ul>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-4 border-b border-edge-soft">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Zimmer mit</th>
                <th className="px-3 py-2 font-semibold">Reservierungs Nr.</th>
                <th className="px-3 py-2 font-semibold">Vorspeise</th>
                <th className="px-3 py-2 font-semibold">Hauptgang</th>
                <th className="px-3 py-2 font-semibold">Dessert</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Pre Registration</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {gruppen.map((g, gi) => g.map((z, zi) => {
                const offen = detailOffen(z.detail)
                const zelle = (v: string | null) => v ? <span className="text-ink-2">{v}</span> : <span className="text-apricot-ink font-semibold">offen</span>
                return (
                  <tr key={z.id} title={offen.length ? `Offen ${offen.join(', ')}` : undefined}
                    className={`${zi === 0 && gi > 0 ? 'border-t-2 border-edge' : 'border-t border-edge-row'} ${offen.length ? 'bg-apricot-bg/40' : gi % 2 ? 'bg-surface/40' : ''}`}>
                    <td className="px-4 py-2 font-semibold text-ink whitespace-nowrap">{z.name}{z.gast && <span className="badge-gray ml-1.5 !text-[10px] !py-0">Gast</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{z.detail.zimmer === 'einzel' ? <span className="text-ink-4">Einzelzimmer</span> : z.zimmerMitName ? <span className="text-ink-2">{z.zimmerMitName}</span> : <span className="text-apricot-ink font-semibold">offen</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap tnum">{zelle(z.detail.resNr)}{z.detail.resName && <span className="block text-[10.5px] text-ink-4">{z.detail.resName}</span>}</td>
                    <td className="px-3 py-2">{zelle(z.detail.vorspeise)}</td>
                    <td className="px-3 py-2">{zelle(z.detail.hauptgang)}</td>
                    <td className="px-3 py-2">{zelle(z.detail.dessert)}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" className="accent-mint-mid w-4 h-4" checked={!!preReg[z.id]}
                        onChange={e => toggle(z.id, e.target.checked)} title="Pre Registration erledigt" />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEdit(z)} className="text-[11px] font-semibold text-mint-ink hover:underline">Bearbeiten</button>
                    </td>
                  </tr>
                )
              }))}
              {zeilen.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-ink-4">Noch keine Teilnehmenden.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-ink-4 px-1">Zeilen mit offenen Angaben sind hervorgehoben. Mit «Bearbeiten» lassen sich Zimmer, Reservation und Menü anpassen, die Zimmerpartnerin wird automatisch mitgeführt.</p>

      {edit && <EditDialog slug={slug} zeile={edit} alle={zeilen} menue={menue} onClose={() => setEdit(null)} />}
    </section>
  )
}
