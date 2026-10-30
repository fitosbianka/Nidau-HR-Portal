import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { modulAktiv } from '@/config/module'

/** Modul «parkplaetze» ist in dieser Installation abgeschaltet (siehe src/config/module.ts) */
export default function ModulLayout({ children }: { children: ReactNode }) {
  if (!modulAktiv('parkplaetze')) redirect('/admin')
  return <>{children}</>
}
