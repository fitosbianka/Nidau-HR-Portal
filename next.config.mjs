// Build-Kennung für den VersionsWaechter: MUSS deterministisch sein, weil
// next.config beim Bauen mehrfach ausgewertet wird — ein Zeitstempel
// (new Date()) ergäbe dann im Client- und im Server-Teil DESSELBEN Builds
// verschiedene Werte, und der Wächter meldete dauernd fälschlich eine neue
// Version. Auf Vercel ist der Git-Commit die eindeutige Kennung des
// Deployments; lokal genügt 'dev'.
const PORTAL_BUILD = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_PORTAL_BUILD: PORTAL_BUILD,
  },
  // Ausweisbilder werden über eine Server Action hochgeladen (serverseitig
  // verschlüsselt), darum ein höheres Limit als die 1 MB Vorgabe
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
    // Dynamische Seiten nie aus dem Client Cache zeigen (sonst erscheinen
    // z. B. gesetzte Haken nach einem Zurück-Klick kurz wieder ungesetzt)
    staleTimes: { dynamic: 0 },
  },
  // Allow PDF files to be served inline
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ]
  },
}

export default nextConfig
