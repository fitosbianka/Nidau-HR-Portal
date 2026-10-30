// Serverseite: Ordner Spiele eines Teamevents (Fotobingo). Datengrenze:
// der Browser erhält nur die eigene Karte mit den eigenen Fotos, von den
// anderen Teams nur Teamname und Haken. Vor der Freigabe ist der Ordner für
// Mitarbeitende nicht erreichbar, auch nicht über einen direkten Link.

import { notFound } from 'next/navigation'
import { teameventKontext, TE_SLUG_RE, type TeBasis } from '@/lib/teamevents-kontext'
import { hatBingo } from '@/lib/teamevent-bingo'
import { ladeBingoSeite } from '@/lib/teamevent-bingo-data'
import BingoClient from '../bingo/BingoClient'

export default async function TeameventSpiele({ basis, slug }: { basis: TeBasis; slug: string }) {
  const k = await teameventKontext()
  if (!TE_SLUG_RE.test(slug) || !hatBingo(slug)) notFound()
  const daten = await ladeBingoSeite(k.admin, slug, { id: k.user.id, name: k.name, role: k.role })
  if (!daten || 'gesperrt' in daten) notFound()
  return <BingoClient daten={daten} meinId={k.user.id} basis={basis} />
}
