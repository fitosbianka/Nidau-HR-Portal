import TeameventsUebersicht from '@/components/teamevents/seiten/Uebersicht'

export const dynamic = 'force-dynamic'

/** Teamevents: Ordner pro Anlass. Zugriff siehe TE_FREIGABE in src/lib/teamevents.ts. */
export default function TeameventsPage() {
  return <TeameventsUebersicht basis="/employee/teamevents" />
}
