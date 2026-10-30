// Serverseite: Anweisungen & Checkliste eines Teamevents. Datengrenze: der
// Browser erhält nur die eigenen Checklisten, Details und Ausweisdaten der
// angemeldeten Person; die Organisatorin zusätzlich die Verwaltung.

import { notFound } from 'next/navigation'
import { zurichToday } from '@/lib/salary-sync'
import { teameventKontext, TE_SLUG_RE, type TeBasis } from '@/lib/teamevents-kontext'
import { ladeProgramm } from '@/lib/teamevent-programm-data'
import ProgrammClient from '../ProgrammClient'

export default async function TeameventAnweisungen({ basis, slug }: { basis: TeBasis; slug: string }) {
  const k = await teameventKontext()
  if (!TE_SLUG_RE.test(slug)) notFound()
  const daten = await ladeProgramm(k.admin, slug, { ...k.viewer, name: k.name })
  if (!daten) notFound()
  return <ProgrammClient daten={daten} meinId={k.user.id} meinName={k.name} verwaltet={k.verwaltet} heute={zurichToday()} basis={basis} />
}
