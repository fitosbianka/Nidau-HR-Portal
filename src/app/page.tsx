import { redirect } from 'next/navigation'

// Root route — middleware handles auth redirect, but as a fallback send to login
export default function RootPage() {
  redirect('/login')
}
