'use client'

// Ein Teamevent-Ordner: Kopf mit Datum und Sichtbarkeit, darunter die
// Unterordner «Fotos» (Upload, Galerie) und «Anweisungen & Checkliste»
// (Infos und persönliche Checkliste).

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { teameventLoeschen } from '@/actions/teamevents'
import { datumKurz, illustration } from '@/lib/teamevents'
import TitelbildKnopf from './TitelbildKnopf'
import type { OrdnerUebersicht, TeamPerson } from '@/lib/teamevents-data'
import { SichtbarkeitDialog, sichtbarText } from './SichtbarkeitWahl'

const OrdnerIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

export type SpieleInfo = { sichtbar: boolean; beschreibung: string; veroeffentlicht: boolean; albumGesperrt: boolean }

export default function OrdnerClient({ ordner, verwaltet, team, basis = '/admin/teamevents', albumSichtbar = true, spiele = null }: {
  ordner: OrdnerUebersicht; verwaltet: boolean; team: TeamPerson[]; basis?: string
  /** Fotoalbum Kachel anzeigen (bei einem Anlass mit Fotobingo erst nach der Freigabe) */
  albumSichtbar?: boolean
  /** Kachel Spiele (Fotobingo), null = dieser Anlass hat keine Spiele */
  spiele?: SpieleInfo | null
}) {
  const album = !!spiele
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [sichtbarEdit, setSichtbarEdit] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function loeschen() {
    if (!confirm(`Leeren Ordner «${ordner.name}» entfernen?`)) return
    setErr(null)
    startTransition(async () => {
      const r = await teameventLoeschen(ordner.slug)
      if ('error' in r && r.error) { setErr(r.error); return }
      router.push(basis); router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-ink-4">
            <Link href={basis} className="hover:text-ink-2">Teamevents</Link>
            <span className="mx-1.5">/</span>
            <span className="text-ink-2">{ordner.name}</span>
          </p>
          <h1 className="page-title mt-1">{ordner.name}</h1>
          <p className="page-subtitle tnum">
            {ordner.datum ? `Anlass am ${datumKurz(ordner.datum)} · ` : ''}{ordner.anzahl} Foto{ordner.anzahl !== 1 ? 's' : ''}
          </p>
          {verwaltet && (
            <p className="text-[11px] text-ink-4 mt-1 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>
              <span>Sichtbar für: {sichtbarText(ordner.sichtbar, team)}</span>
              <button onClick={() => setSichtbarEdit(true)} className="text-mint-ink hover:underline font-semibold">Ändern</button>
            </p>
          )}
        </div>
        {verwaltet && ordner.anzahl === 0 && (
          <button onClick={loeschen} disabled={isPending} className="btn-secondary text-xs">Leeren Ordner entfernen</button>
        )}
      </div>

      {err && <p className="text-xs px-3 py-2 rounded-ctl inline-block bg-blush-bg text-blush-ink">⚠ {err}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Unterordner Fotos bzw. Fotoalbum */}
        {albumSichtbar && (
        <Link href={`${basis}/${ordner.slug}/fotos`} className="card overflow-hidden group block hover:shadow-md transition-shadow relative">
          {album && verwaltet && spiele?.albumGesperrt && <span className="absolute top-2 left-2 z-10 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-ink-3 border border-edge">Für Mitarbeitende gesperrt</span>}
          <div className="aspect-[4/3] bg-surface flex items-center justify-center overflow-hidden">
            {(ordner.vorschau ?? ordner.cover ?? illustration(ordner.slug, 'ordner')) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={(ordner.vorschau ?? ordner.cover ?? illustration(ordner.slug, 'ordner')) as string} alt="" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-12 h-12 text-ink-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-9 8" />
              </svg>
            )}
          </div>
          <div className="px-4 py-3">
            <p className="text-sm font-bold text-ink flex items-center gap-2"><OrdnerIcon className="w-4 h-4 text-ink-4" /> {album ? 'Fotoalbum' : 'Fotos'}</p>
            <p className="text-[11px] text-ink-4 tnum mt-0.5">
              {ordner.anzahl === 0 ? (album ? 'Alle Fotos vom Ausflug, hier hochladen' : 'Noch keine Fotos, hier hochladen') : `${ordner.anzahl} Foto${ordner.anzahl !== 1 ? 's' : ''}${ordner.neuestes ? ` · zuletzt ${datumKurz(ordner.neuestes)}` : ''}`}
            </p>
          </div>
        </Link>
        )}

        {/* Unterordner Anweisungen & Checkliste */}
        <Link href={`${basis}/${ordner.slug}/anweisungen`} className="card overflow-hidden group block hover:shadow-md transition-shadow">
          <div className="aspect-[4/3] bg-surface flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ordner.coverAnweisungen ?? (illustration(ordner.slug, 'anweisungen') as string)} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="px-4 py-3">
            <p className="text-sm font-bold text-ink flex items-center gap-2"><OrdnerIcon className="w-4 h-4 text-ink-4" /> Anweisungen &amp; Checkliste</p>
            <p className="text-[11px] text-ink-4 mt-0.5">Ablauf, Abfahrt, Apps, persönliche Details und Checkliste</p>
          </div>
        </Link>

        {/* Unterordner Spiele (Fotobingo) */}
        {spiele?.sichtbar && (
          <Link href={`${basis}/${ordner.slug}/spiele`} className="card overflow-hidden group block hover:shadow-md transition-shadow relative">
            {verwaltet && !spiele.veroeffentlicht && <span className="absolute top-2 left-2 z-10 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-ink-3 border border-edge">Nicht veröffentlicht</span>}
            <div className="aspect-[4/3] bg-surface flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/teamevents/spiele.svg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="px-4 py-3">
              <p className="text-sm font-bold text-ink flex items-center gap-2"><OrdnerIcon className="w-4 h-4 text-ink-4" /> Spiele</p>
              <p className="text-[11px] text-ink-4 mt-0.5">{spiele.beschreibung}</p>
            </div>
          </Link>
        )}
      </div>
      {verwaltet && (
        <p className="text-[11px] text-ink-4 flex flex-wrap gap-x-5 gap-y-1 px-1">
          <span>Kachel Fotos <TitelbildKnopf slug={ordner.slug} ziel="ordner" vorhanden={!!ordner.cover} /></span>
          <span>Kachel Anweisungen <TitelbildKnopf slug={ordner.slug} ziel="anweisungen" vorhanden={!!ordner.coverAnweisungen} /></span>
        </p>
      )}

      {sichtbarEdit && (
        <SichtbarkeitDialog slug={ordner.slug} name={ordner.name} wert={ordner.sichtbar} team={team} onClose={() => setSichtbarEdit(false)} />
      )}
    </div>
  )
}
