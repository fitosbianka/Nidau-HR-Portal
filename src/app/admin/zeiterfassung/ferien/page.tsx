import { redirect } from 'next/navigation'

export default function FerienIndexPage() {
  redirect('/admin/zeiterfassung/ferien/planung')
}
