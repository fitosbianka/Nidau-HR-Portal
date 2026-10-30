// Serverseite: Teamevent Ordner Übersicht (Admin und Mitarbeiter Bereich).
// Eine Datei pro Seite, damit jede Route nur ihre eigene Client Komponente lädt.

import { teameventKontext, type TeBasis } from '@/lib/teamevents-kontext'
import { ladeTeamevents, ladeTeam } from '@/lib/teamevents-data'
import TeameventsClient from '../TeameventsClient'

export default async function TeameventsUebersicht({ basis }: { basis: TeBasis }) {
  const k = await teameventKontext()
  const [ordner, team] = await Promise.all([ladeTeamevents(k.admin, k.viewer), k.verwaltet ? ladeTeam(k.admin) : Promise.resolve([])])
  return <TeameventsClient ordner={ordner} verwaltet={k.verwaltet} team={team} basis={basis} />
}
