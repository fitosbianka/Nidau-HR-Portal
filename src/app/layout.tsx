import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import './globals.css'

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-archivo',
})

export const metadata: Metadata = {
  title: 'HR Portal — Dentalpraxis Nidau',
  description: 'Internes Mitarbeiterportal für Dentalpraxis Nidau',
  robots: 'noindex, nofollow', // Private app — keep out of search engines
  appleWebApp: {
    capable: true,
    title: 'HR-Portal', // name under the home-screen icon on iOS
    statusBarStyle: 'default',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <body className={`${archivo.variable} font-sans`}>{children}</body>
    </html>
  )
}
