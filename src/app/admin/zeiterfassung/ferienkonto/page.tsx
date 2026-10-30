import { redirect } from 'next/navigation'

// Ferienkonto was renamed to "Ferien" with sub-pages. Keep the old URL working.
export default function LegacyFerienkontoRedirect() {
  redirect('/admin/zeiterfassung/ferien/konto')
}
