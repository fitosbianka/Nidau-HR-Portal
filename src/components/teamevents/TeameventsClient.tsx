'use client'

// Teamevent-Ordner: Übersicht als Kacheln (immer oben), neuer Ordner mit
// Sichtbarkeit (nur Organisatorin). Pro Ordner die Unterordner Fotos und
// Anweisungen & Checkliste.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { teameventAnlegen, teameventLoeschen } from '@/actions/teamevents'
import { datumKurz, illustration, TE_FREIGABE, type TeSichtbar } from '@/lib/teamevents'
import TitelbildKnopf from './TitelbildKnopf'
import type { OrdnerUebersicht, TeamPerson } from '@/lib/teamevents-data'
import { SichtbarkeitWahl, SichtbarkeitDialog, sichtbarText } from './SichtbarkeitWahl'

export default function TeameventsClient({ ordner, verwaltet, team, basis = '/admin/teamevents' }: {
  ordner: OrdnerUebersicht[]
  verwaltet: boolean
  team: TeamPerson[]
  basis?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [neu, setNeu] = useState(false)
  const [name, setName] = useState('')
  const [datum, setDatum] = useState('')
  const [sichtbar, setSichtbar] = useState<TeSichtbar>('alle')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [sichtbarEdit, setSichtbarEdit] = useState<OrdnerUebersicht | null>(null)

  function anlegen() {
    setMsg(null)
    startTransition(async () => {
      const r = await teameventAnlegen(name, datum || null, sichtbar)
      if ('error' in r && r.error) {
        setMsg({ type: 'err', text: r.error })
        router.refresh() // falls der Ordner existiert, aber (noch) nicht angezeigt wurde
        return
      }
      setNeu(false); setName(''); setDatum(''); setSichtbar('alle')
      setMsg({ type: 'ok', text: `Ordner «${name.trim()}» angelegt.` })
      router.refresh()
    })
  }

  function loeschen(o: OrdnerUebersicht) {
    if (!confirm(`Leeren Ordner «${o.name}» entfernen?`)) return
    setMsg(null)
    startTransition(async () => {
      const r = await teameventLoeschen(o.slug)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      router.refresh()
    })
  }

  const kannAnlegen = name.trim().length >= 2 && (sichtbar === 'alle' || sichtbar.length > 0)

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Teamevents</h1>
          <p className="page-subtitle">Pro Teamevent ein Ordner mit den Fotos und den Anweisungen mit Checkliste</p>
        </div>
        {verwaltet && !neu && (
          <button onClick={() => { setNeu(true); setMsg(null) }} className="btn-primary">＋ Teamevent anlegen</button>
        )}
      </div>

      {verwaltet && TE_FREIGABE !== 'alle' && (
        <p className="text-[11px] text-ink-4">
          Zurzeit nur für die Organisatorin sichtbar. Nach der Freigabe sehen alle Mitarbeitenden die Seite, die Sichtbarkeit pro Ordner gilt dann sofort.
        </p>
      )}

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      {neu && (
        <div className="card p-5 space-y-4">
          <p className="text-sm font-semibold text-ink">Neues Teamevent</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Weihnachtsessen 2026" className="input-field text-sm w-64" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Datum des Anlasses <span className="normal-case font-normal">(optional)</span></label>
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)} className="input-field text-sm w-44" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Wer darf den Ordner sehen?</span>
            <SichtbarkeitWahl wert={sichtbar} onChange={setSichtbar} team={team} />
          </div>
          <div className="flex gap-2">
            <button onClick={anlegen} disabled={isPending || !kannAnlegen} className="btn-primary">{isPending ? 'Legt an…' : 'Ordner anlegen'}</button>
            <button onClick={() => { setNeu(false); setMsg(null) }} className="btn-secondary">Abbrechen</button>
          </div>
        </div>
      )}

      {ordner.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink-2">{verwaltet ? 'Noch keine Teamevents' : 'Noch kein Teamevent freigegeben'}</p>
          <p className="text-xs text-ink-4 mt-1">{verwaltet ? 'Mit «Teamevent anlegen» den ersten Ordner erstellen.' : 'Sobald ein Ordner freigegeben ist, erscheint er hier.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {ordner.map(o => (
            <div key={o.slug} className="card overflow-hidden group relative hover:shadow-md transition-shadow">
              {/* Der Link liegt als Fläche über der ganzen Kachel, so öffnet jeder Tipp den Ordner */}
              <Link href={`${basis}/${o.slug}`} className="absolute inset-0 z-[1] rounded-card" aria-label={`${o.name} öffnen`} />
              <div className="aspect-[4/3] bg-surface flex items-center justify-center overflow-hidden">
                {(o.cover ?? o.vorschau ?? illustration(o.slug, 'ordner')) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={(o.cover ?? o.vorschau ?? illustration(o.slug, 'ordner')) as string} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-12 h-12 text-ink-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                )}
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-bold text-ink truncate">{o.name}</p>
                <p className="text-[11px] text-ink-4 tnum mt-0.5">
                  {o.datum ? `${datumKurz(o.datum)} · ` : ''}
                  {o.anzahl} Foto{o.anzahl !== 1 ? 's' : ''}
                  {o.neuestes ? ` · zuletzt ${datumKurz(o.neuestes)}` : ''}
                </p>
                <p className="text-[10px] text-ink-5 mt-1">Fotos · Anweisungen &amp; Checkliste</p>
              </div>
              {verwaltet && (
                <div className="relative z-[2] px-4 pb-3 -mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-ink-4 bg-white">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>
                    <span className="truncate" title={sichtbarText(o.sichtbar, team)}>Sichtbar {sichtbarText(o.sichtbar, team, true)}</span>
                    <button onClick={() => setSichtbarEdit(o)} className="text-mint-ink hover:underline font-semibold flex-shrink-0">Ändern</button>
                  </span>
                  <TitelbildKnopf slug={o.slug} ziel="ordner" vorhanden={!!o.cover} className="ml-auto" />
                </div>
              )}
              {verwaltet && o.anzahl === 0 && (
                <button onClick={() => loeschen(o)} disabled={isPending}
                  className="absolute top-2 right-2 z-[2] w-7 h-7 rounded-full bg-white/90 border border-edge text-ink-4 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  title="Leeren Ordner entfernen">✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {sichtbarEdit && (
        <SichtbarkeitDialog slug={sichtbarEdit.slug} name={sichtbarEdit.name} wert={sichtbarEdit.sichtbar} team={team} onClose={() => setSichtbarEdit(null)} />
      )}
    </div>
  )
}
