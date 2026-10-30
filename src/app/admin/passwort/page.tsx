import ChangePasswordForm from '@/components/auth/ChangePasswordForm'

export default function AdminChangePasswordPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Passwort ändern</h1>
        <p className="page-subtitle">Legen Sie ein neues Passwort für Ihr Administratorkonto fest.</p>
      </div>

      <div className="card p-6 max-w-md">
        <ChangePasswordForm />
      </div>
    </div>
  )
}
