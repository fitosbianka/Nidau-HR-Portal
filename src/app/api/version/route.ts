import { NextResponse } from 'next/server'

// Aktuelle Build-Kennung des Servers — der VersionsWaechter im Browser
// vergleicht sie mit seiner einkompilierten Kennung. Bewusst ohne Auth:
// die Kennung ist nur ein Build-Zeitstempel ohne jeden Inhalt.
export const dynamic = 'force-dynamic'

export async function GET() {
  // Zur Laufzeit direkt den Commit des Deployments nehmen (immer korrekt),
  // die einkompilierte Kennung nur als Rückfallebene
  return NextResponse.json(
    { build: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_PORTAL_BUILD ?? '' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
