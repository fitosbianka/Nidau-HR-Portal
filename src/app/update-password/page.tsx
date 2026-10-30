import Image from 'next/image'
import UpdatePasswordForm from '@/components/auth/UpdatePasswordForm'

export default function UpdatePasswordPage() {
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
          <p className="text-ink-4 text-sm tracking-wide">Neues Passwort festlegen</p>
        </div>
        <div className="card p-8">
          <UpdatePasswordForm />
        </div>
      </div>
    </div>
  )
}
