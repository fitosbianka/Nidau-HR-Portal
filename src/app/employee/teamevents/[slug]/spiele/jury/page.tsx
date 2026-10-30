import TeameventJury from '@/components/teamevents/seiten/Jury'

export const dynamic = 'force-dynamic'

/** Jurybereich des Fotobingos (nur Bianka und Noah). */
export default async function TeameventJuryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TeameventJury basis="/employee/teamevents" slug={slug} />
}
