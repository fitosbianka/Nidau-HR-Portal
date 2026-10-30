import { redirect } from 'next/navigation'

// The Arbeitszeit- und Ferienkonto moved to its own menu point under Berichte.
export default function OldKontoPage() {
  redirect('/admin/zeiterfassung/konto')
}
