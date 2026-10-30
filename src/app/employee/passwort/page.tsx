import ChangePasswordForm from '@/components/auth/ChangePasswordForm'

export default function ChangePasswordPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Passwort ändern</h1>
        <p className="text-sm text-ink-3 mt-1">Legen Sie ein neues Passwort für Ihr Konto fest.</p>
      </div>

      <div className="card p-6 max-w-md">
        <ChangePasswordForm />
      </div>
    </div>
  )
}
