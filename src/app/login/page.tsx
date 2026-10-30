import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import LoginForm from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    redirect((profile as { role: string } | null)?.role === 'admin' ? '/admin' : '/employee')
  }

  const params = await searchParams
  const errorMessage =
    params.error === 'credentials'
      ? 'E-Mail-Adresse oder Passwort ist falsch. Bitte versuchen Sie es erneut.'
      : params.error === 'account_disabled'
        ? 'Ihr Konto wurde deaktiviert. Bitte wenden Sie sich an die Administration.'
        : params.error === 'invite_invalid'
          ? 'Der Einladungslink ist ungültig oder abgelaufen. Bitte wenden Sie sich an die Administration.'
          : undefined

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/logo.png"
            alt="Dentalpraxis Nidau"
            width={180}
            height={125}
            className="w-44 h-auto mb-3"
            priority
          />
          <p className="text-[10px] tracking-[.28em] text-ink-4 font-medium">MITARBEITERPORTAL</p>
        </div>

        <div className="card p-8">
          <h2 className="text-lg font-semibold text-ink mb-6">Anmelden</h2>
          <LoginForm error={errorMessage} />
        </div>
      </div>
    </div>
  )
}
