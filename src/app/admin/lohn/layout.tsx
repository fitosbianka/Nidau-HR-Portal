import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { modulAktiv } from '@/config/module'

/** Modul «lohn» ist in dieser Installation abgeschaltet (siehe src/config/module.ts) */
export default function ModulLayout({ children }: { children: ReactNode }) {
  if (!modulAktiv('lohn')) redirect('/admin')
  return <>{children}</>
}
