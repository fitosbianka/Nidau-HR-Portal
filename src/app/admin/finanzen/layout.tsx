import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { modulAktiv } from '@/config/module'

/** Modul «finanzen» ist in dieser Installation abgeschaltet (siehe src/config/module.ts) */
export default function ModulLayout({ children }: { children: ReactNode }) {
  if (!modulAktiv('finanzen')) redirect('/admin')
  return <>{children}</>
}
