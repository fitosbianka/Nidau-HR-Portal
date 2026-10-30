import type { MetadataRoute } from 'next'

// Web-app manifest: gives the portal its icon and name when it is added to
// the home screen (Android and iOS) and makes it open full-screen like an
// app (display: standalone).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HR Portal — Dentalpraxis Nidau',
    short_name: 'HR-Portal',
    description: 'Internes Mitarbeiterportal für Dentalpraxis Nidau',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F4F1',
    theme_color: '#F5F4F1',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
