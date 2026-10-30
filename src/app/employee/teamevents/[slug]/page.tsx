import TeameventOrdner from '@/components/teamevents/seiten/Ordner'

export const dynamic = 'force-dynamic'

/** Ein Teamevent-Ordner mit seinen Unterordnern (Fotos, Anweisungen & Checkliste). */
export default async function TeameventOrdnerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TeameventOrdner basis="/employee/teamevents" slug={slug} />
}
