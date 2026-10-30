import TeameventSpiele from '@/components/teamevents/seiten/Spiele'

export const dynamic = 'force-dynamic'

/** Ordner Spiele eines Teamevents (Fotobingo). */
export default async function TeameventSpielePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TeameventSpiele basis="/admin/teamevents" slug={slug} />
}
