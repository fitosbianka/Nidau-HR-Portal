// Serverseite: Fotogalerie eines Teamevents (bei einem Anlass mit Fotobingo
// das Fotoalbum). Für alle mit Zugang zum Ordner offen; die Organisatorin
// kann das Album sperren, Admins sehen es dann weiterhin.

import { notFound } from 'next/navigation'
import { teameventKontext, TE_SLUG_RE, type TeBasis } from '@/lib/teamevents-kontext'
import { ladeGalerie, ladeTeam } from '@/lib/teamevents-data'
import { hatBingo, bingoRolle } from '@/lib/teamevent-bingo'
import { ladeEinstellungen } from '@/lib/teamevent-bingo-data'
import GalerieClient from '../GalerieClient'

export default async function TeameventGalerie({ basis, slug }: { basis: TeBasis; slug: string }) {
  const k = await teameventKontext()
  if (!TE_SLUG_RE.test(slug)) notFound()
  const [g, team, e] = await Promise.all([
    ladeGalerie(k.admin, slug, k.viewer),
    k.verwaltet ? ladeTeam(k.admin) : Promise.resolve([]),
    hatBingo(slug) ? ladeEinstellungen(k.admin, slug) : Promise.resolve(null),
  ])
  if (!g) notFound()
  const rolle = bingoRolle(k.role, k.name)
  if (e?.albumGesperrt && !rolle.admin && !rolle.verwaltet) notFound()
  return <GalerieClient ordner={g.ordner} fotos={g.fotos} verwaltet={k.verwaltet} meinName={k.name} team={team} basis={basis} album={!!e} gesperrt={!!e?.albumGesperrt} />
}
