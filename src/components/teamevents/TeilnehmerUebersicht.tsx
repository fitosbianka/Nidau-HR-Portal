'use client'

// Verwaltung der Organisatorin: Teilnehmende mit Ausweis ja/nein,
// Einstiegsort, Allergien und Fortschritt der Checkliste; Filter «Noch
// offen»; Anzahl pro Einstiegsort; Teilnehmende verwalten; Einstiegsort und
// Allergien pro Person direkt eintragen (auch für sich selbst, da die
// Organisatorin keine eigene Checkliste auf der Seite hat).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { teilnehmerSetzen, checkSpeichern } from '@/actions/teamevent-programm'
import type { Einstieg } from '@/lib/teamevent-programm'
import type { TeilnehmerZeile } from '@/lib/teamevent-programm-data'
import type { TeamPerson } from '@/lib/teamevents-data'
import { Fortschritt } from './MeineCheckliste'

function CheckDialog({ slug, zeile, einstieg, onClose }: { slug: string; zeile: TeilnehmerZeile; einstieg: Record<Einstieg, string>; onClose: () => void }) {
  const router = useRouter()
  const [e, setE] = useState<Einstieg | null>(zeile.check.einstieg)
  const [keine, setKeine] = useState(zeile.check.keineAllergien)
  const [text, setText] = useState(zeile.check.allergien ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function speichern() {
    setErr(null)
    startTransition(async () => {
      const r = await checkSpeichern(slug, zeile.id, { einstieg: e, allergien: keine ? '' : text, keineAllergien: keine })
      if ('error' in r && r.error) { setErr(r.error); return }
      router.refresh(); onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5 space-y-4">
        <p className="text-sm font-bold text-ink">Angaben {zeile.name}</p>
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Einstiegsort</p>
          <div className="flex flex-col sm:flex-row gap-2">
            {(Object.keys(einstieg) as Einstieg[]).map(k => (
              <button key={k} type="button" onClick={() => setE(k)}
                className={`flex-1 px-3 py-2 rounded-ctl border text-sm text-left ${e === k ? 'border-mint-mid bg-mint-bg text-mint-ink font-semibold' : 'border-edge-ctl text-ink-2 hover:bg-surface'}`}>
                {e === k ? '✓ ' : ''}{einstieg[k]}
              </button>
            ))}
          </div>
          {e && <button type="button" onClick={() => setE(null)} className="text-[11px] text-ink-4 hover:underline">Auswahl löschen</button>}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Allergien</p>
          <textarea value={text} onChange={ev => setText(ev.target.value)} rows={2} maxLength={500} disabled={keine}
            placeholder="z. B. Nussallergie, laktosefrei, vegetarisch" className="input-field text-sm w-full disabled:opacity-50" />
          <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input type="checkbox" className="accent-mint-mid w-4 h-4" checked={keine} onChange={ev => { setKeine(ev.target.checked); if (ev.target.checked) setText('') }} />
            Keine Allergien
          </label>
        </div>
        {err && <p className="text-xs text-blush-ink">⚠ {err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Abbrechen</button>
          <button onClick={speichern} disabled={isPending} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
        </div>
      </div>
    </div>
  )
}

export default function TeilnehmerUebersicht({ slug, zeilen, nichtZugeordnet, team, einstieg }: {
  slug: string; zeilen: TeilnehmerZeile[]; nichtZugeordnet: string[]; team: TeamPerson[]; einstieg: Record<Einstieg, string>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [nurOffen, setNurOffen] = useState(false)
  const [verwalten, setVerwalten] = useState(false)
  const [auswahl, setAuswahl] = useState<string[]>(zeilen.map(z => z.id))
  const [edit, setEdit] = useState<TeilnehmerZeile | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const sichtbar = useMemo(() => (nurOffen ? zeilen.filter(z => z.erledigt < z.total) : zeilen), [zeilen, nurOffen])
  const proEinstieg = useMemo(() => {
    const m: Record<string, number> = { kehrsatz: 0, bern: 0, offen: 0 }
    for (const z of zeilen) m[z.check.einstieg ?? 'offen']++
    return m
  }, [zeilen])
  const mitAusweis = zeilen.filter(z => z.ausweis.komplett).length
  const fertig = zeilen.filter(z => z.erledigt === z.total).length

  function teilnehmerSpeichern() {
    setMsg(null)
    startTransition(async () => {
      const r = await teilnehmerSetzen(slug, auswahl)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setVerwalten(false); setMsg({ type: 'ok', text: `Teilnehmerliste gespeichert (${'anzahl' in r ? r.anzahl : auswahl.length} Personen).` })
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink">Teilnehmende <span className="text-[10px] font-normal text-ink-4 ml-1">nur für die Organisatorin sichtbar</span></h2>
        <button onClick={() => { setAuswahl(zeilen.map(z => z.id)); setVerwalten(true) }} className="btn-secondary text-xs">Teilnehmende verwalten</button>
      </div>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}
      {nichtZugeordnet.length > 0 && (
        <p className="text-xs px-3 py-2 rounded-ctl bg-apricot-bg text-apricot-ink">
          Ohne Zuordnung zu einem Konto: {nichtZugeordnet.join(', ')}. Bitte über «Teilnehmende verwalten» von Hand hinzufügen, danach verschwindet dieser Hinweis.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
        {[
          ['Teilnehmende', `${zeilen.length}`], ['Ausweis da', `${mitAusweis} von ${zeilen.length}`],
          ['Kehrsatz 7.45 Uhr', `${proEinstieg.kehrsatz}`], ['Bern 8.15 Uhr', `${proEinstieg.bern}`],
          ['Einstieg offen', `${proEinstieg.offen}`], ['Alles erledigt', `${fertig}`],
        ].map(([l, v]) => (
          <div key={l} className="card px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-4 font-semibold">{l}</p>
            <p className="text-base font-bold text-ink tnum">{v}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-edge-soft flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <input type="checkbox" className="accent-mint-mid" checked={nurOffen} onChange={e => setNurOffen(e.target.checked)} />
            Noch offen <span className="text-ink-4 tnum">({zeilen.filter(z => z.erledigt < z.total).length})</span>
          </label>
          <span className="text-[11px] text-ink-4 tnum">{sichtbar.length} von {zeilen.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-4 border-b border-edge-soft">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Ausweis</th>
                <th className="px-3 py-2 font-semibold">Einstiegsort</th>
                <th className="px-3 py-2 font-semibold">Allergien</th>
                <th className="px-3 py-2 font-semibold min-w-[180px]">Checkliste</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sichtbar.map(z => (
                <tr key={z.id} className="border-b border-edge-row last:border-0 hover:bg-surface/60 align-top">
                  <td className="px-4 py-2 font-semibold text-ink whitespace-nowrap">{z.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={z.ausweis.komplett ? 'badge-green' : 'badge-red'}>{z.ausweis.komplett ? 'ja' : 'nein'}</span>
                    {z.ausweis.status === 'abgelaufen' && <span className="ml-2 text-[11px] text-blush-ink">abgelaufen</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-2 whitespace-nowrap">{z.check.einstieg ? einstieg[z.check.einstieg] : <span className="text-ink-4">offen</span>}</td>
                  <td className="px-3 py-2 text-ink-2 max-w-[260px]">
                    {z.check.keineAllergien ? <span className="text-ink-4">keine</span> : z.check.allergien ? z.check.allergien : <span className="text-ink-4">offen</span>}
                  </td>
                  <td className="px-3 py-2" title={z.offen.length ? `Offen ${z.offen.join(', ')}` : 'Alles erledigt'}>
                    <Fortschritt erledigt={z.erledigt} total={z.total} label={`${z.erledigt} von ${z.total}`} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEdit(z)} className="text-[11px] font-semibold text-mint-ink hover:underline">Bearbeiten</button>
                  </td>
                </tr>
              ))}
              {sichtbar.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-4">{nurOffen ? 'Niemand hat noch offene Punkte.' : 'Noch keine Teilnehmenden.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-ink-4 px-1">Mit «Bearbeiten» lassen sich Einstiegsort und Allergien einer Person eintragen, zum Beispiel nach einer telefonischen Meldung oder für die eigene Person.</p>

      {verwalten && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setVerwalten(false)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-lg p-5 my-8">
            <p className="text-sm font-bold text-ink mb-0.5">Teilnehmende verwalten</p>
            <p className="text-[11px] text-ink-4 mb-3">Wer mitkommt, sieht die Checkliste, die eigenen Details und die persönlichen Felder. Wer nicht angehakt ist, wird nirgends als fehlend gezählt.</p>
            <div className="rounded-ctl border border-edge-ctl p-2 max-h-72 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              {team.map(p => (
                <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface cursor-pointer text-[13px] text-ink-2">
                  <input type="checkbox" className="accent-mint-mid" checked={auswahl.includes(p.id)}
                    onChange={() => setAuswahl(a => a.includes(p.id) ? a.filter(x => x !== p.id) : [...a, p.id])} />
                  <span className="truncate">{p.full_name}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-ink-4 mt-2 tnum">{auswahl.length} Personen ausgewählt</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setVerwalten(false)} className="btn-secondary">Abbrechen</button>
              <button onClick={teilnehmerSpeichern} disabled={isPending} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}

      {edit && <CheckDialog slug={slug} zeile={edit} einstieg={einstieg} onClose={() => setEdit(null)} />}
    </section>
  )
}
