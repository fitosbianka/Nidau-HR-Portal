'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function UpdatePasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (password !== confirm) {
      setError('Die Passwörter stimmen nicht überein.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError('Das Passwort konnte nicht aktualisiert werden. Bitte fordern Sie einen neuen Link an.')
      } else {
        // Session is already active after the invite callback — go straight to the employee portal.
        router.push('/employee')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-ink mb-2">Neues Passwort festlegen</h2>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink-2 mb-1">
          Neues Passwort
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field"
          placeholder="Mindestens 8 Zeichen"
          required
          autoComplete="new-password"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-ink-2 mb-1">
          Passwort bestätigen
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input-field"
          placeholder="Passwort wiederholen"
          required
          autoComplete="new-password"
        />
      </div>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Wird gespeichert…' : 'Passwort speichern'}
      </button>
    </form>
  )
}
