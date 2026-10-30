import Image from 'next/image'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-gray-100 flex items-center justify-center px-4">
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
          <p className="text-ink-4 text-sm tracking-wide">Passwort zurücksetzen</p>
        </div>

        <div className="card p-8">
          <h2 className="text-lg font-semibold text-ink mb-2">Neues Passwort anfordern</h2>
          <p className="text-sm text-ink-3 mb-6">
            Geben Sie Ihre E-Mail-Adresse ein. Sie erhalten einen Link zum Zurücksetzen Ihres Passworts.
          </p>
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  )
}
