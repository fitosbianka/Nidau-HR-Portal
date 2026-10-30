// Serverseite: Jurybereich des Fotobingos (nur Bianka und Noah). Alle
// Fotos, Wertungen, Live Punkte, Jurypreis, Siegerehrung und Protokoll.

import { notFound } from 'next/navigation'
import { teameventKontext, TE_SLUG_RE, type TeBasis } from '@/lib/teamevents-kontext'
import { hatBingo } from '@/lib/teamevent-bingo'
import { ladeJury } from '@/lib/teamevent-bingo-data'
import JuryClient from '../bingo/JuryClient'

export default async function TeameventJury({ basis, slug }: { basis: TeBasis; slug: string }) {
  const k = await teameventKontext()
  if (!TE_SLUG_RE.test(slug) || !hatBingo(slug)) notFound()
  const daten = await ladeJury(k.admin, slug, { id: k.user.id, name: k.name, role: k.role })
  if (!daten) notFound()
  return <JuryClient daten={daten} basis={basis} />
}
