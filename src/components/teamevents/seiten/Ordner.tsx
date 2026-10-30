// Serverseite: ein Teamevent Ordner mit seinen Unterordnern.

import { notFound } from 'next/navigation'
import { teameventKontext, TE_SLUG_RE, type TeBasis } from '@/lib/teamevents-kontext'
import { ladeOrdnerUebersicht, ladeTeam } from '@/lib/teamevents-data'
import { hatBingo, bingoRolle, darfBingoSehen, spieleBeschreibung } from '@/lib/teamevent-bingo'
import { ladeEinstellungen } from '@/lib/teamevent-bingo-data'
import OrdnerClient from '../OrdnerClient'

export default async function TeameventOrdner({ basis, slug }: { basis: TeBasis; slug: string }) {
  const k = await teameventKontext()
  if (!TE_SLUG_RE.test(slug)) notFound()
  const [ordner, team, e] = await Promise.all([
    ladeOrdnerUebersicht(k.admin, slug, k.viewer),
    k.verwaltet ? ladeTeam(k.admin) : Promise.resolve([]),
    hatBingo(slug) ? ladeEinstellungen(k.admin, slug) : Promise.resolve(null),
  ])
  if (!ordner) notFound()
  // Anlass mit Fotobingo: Fotoalbum und Spiele hängen an den Schaltern der
  // Organisatorin; nur Admins sehen beides als Vorschau, Mitarbeitende
  // (auch die Jury) erst nach der Veröffentlichung
  const rolle = bingoRolle(k.role, k.name)
  const albumSichtbar = !e || !e.albumGesperrt || rolle.admin || rolle.verwaltet
  const spiele = e ? { sichtbar: darfBingoSehen(e, rolle), beschreibung: spieleBeschreibung(e), veroeffentlicht: e.veroeffentlicht, albumGesperrt: e.albumGesperrt } : null
  return <OrdnerClient ordner={ordner} verwaltet={k.verwaltet} team={team} basis={basis} albumSichtbar={albumSichtbar} spiele={spiele} />
}
