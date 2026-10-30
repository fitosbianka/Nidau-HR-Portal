import TeameventGalerie from '@/components/teamevents/seiten/Galerie'

export const dynamic = 'force-dynamic'

export default async function TeameventGaleriePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TeameventGalerie basis="/employee/teamevents" slug={slug} />
}
