'use client'

// Unterordner «Anweisungen & Checkliste» eines Teamevents. Für alle gleich
// aufgebaut: Infos oben, darunter die persönlichen Details und die eigene
// Checkliste. Die Organisatorin sieht statt der persönlichen Checkliste die
// Verwaltung: Teilnehmende, Ausweisdaten, Zimmer und Abendessen sowie ihre
// Admin Checkliste; diese Daten erhält auch nur sie vom Server.

import Link from 'next/link'
import type { ProgrammDaten } from '@/lib/teamevent-programm-data'
import InfoBloecke from './InfoBloecke'
import MeineDetails from './MeineDetails'
import MeineCheckliste from './MeineCheckliste'
import TeilnehmerUebersicht from './TeilnehmerUebersicht'
import AusweisTabelle from './AusweisTabelle'
import ZimmerUndMenue from './ZimmerUndMenue'
import AdminCheckliste from './AdminCheckliste'

export default function ProgrammClient({ daten, meinId, meinName, verwaltet, heute, basis = '/admin/teamevents' }: {
  daten: ProgrammDaten; meinId: string; meinName: string; verwaltet: boolean; heute: string; basis?: string
}) {
  const { ordner } = daten
  const fotosHref = `${basis}/${ordner.slug}/fotos`
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-ink-4">
          <Link href={basis} className="hover:text-ink-2">Teamevents</Link>
          <span className="mx-1.5">/</span>
          <Link href={`${basis}/${ordner.slug}`} className="hover:text-ink-2">{ordner.name}</Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-2">Anweisungen &amp; Checkliste</span>
        </p>
        <h1 className="page-title mt-1">{ordner.name}</h1>
        <p className="page-subtitle">Alles Wichtige zum Anlass und die persönliche Checkliste</p>
      </div>

      <InfoBloecke slug={ordner.slug} bloecke={daten.bloecke} verwaltet={verwaltet} platzhalter={daten.platzhalter} />

      {daten.binTeilnehmer && daten.mein ? (
        <>
          <MeineDetails detail={daten.mein.detail} zimmerMitName={daten.mein.zimmerMitName} />
          {!verwaltet && <MeineCheckliste
            slug={ordner.slug} profileId={meinId} personName={meinName}
            check={daten.mein.check} ausweis={daten.mein.ausweis} fotos={daten.mein.fotos}
            checkliste={daten.checkliste} einstieg={daten.einstieg} bloecke={daten.bloecke}
            heute={heute} jetzt={daten.jetzt} verwaltet={verwaltet} fotosHref={fotosHref}
          />}
        </>
      ) : (
        <p className="text-xs text-ink-4 px-1">Für diesen Anlass ist keine Teilnahme eingetragen. Die Checkliste erscheint, sobald die Person auf der Teilnehmerliste steht.</p>
      )}

      {daten.verwaltung && (
        <>
          <TeilnehmerUebersicht slug={ordner.slug} zeilen={daten.verwaltung.teilnehmer} nichtZugeordnet={daten.verwaltung.nichtZugeordnet}
            team={daten.verwaltung.team} einstieg={daten.einstieg} />
          <AusweisTabelle slug={ordner.slug} zeilen={daten.verwaltung.teilnehmer} heute={heute} />
          <ZimmerUndMenue slug={ordner.slug} zeilen={[...daten.verwaltung.teilnehmer, ...daten.verwaltung.gaeste]} menue={daten.menue} />
          <AdminCheckliste slug={ordner.slug} phasen={daten.verwaltung.adminPhasen} adminCheck={daten.verwaltung.adminCheck} />
        </>
      )}
    </div>
  )
}
