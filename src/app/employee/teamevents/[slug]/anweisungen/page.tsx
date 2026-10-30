import TeameventAnweisungen from '@/components/teamevents/seiten/Anweisungen'

export const dynamic = 'force-dynamic'

/** Anweisungen & Checkliste eines Teamevents. */
export default async function TeameventAnweisungenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TeameventAnweisungen basis="/employee/teamevents" slug={slug} />
}
