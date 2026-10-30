'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ChangePasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

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
        setError('Passwort konnte nicht geändert werden. Bitte versuchen Sie es erneut.')
      } else {
        setSuccess(true)
        setPassword('')
        setConfirm('')
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center w-12 h-12 bg-brand-100 rounded-full mx-auto">
          <svg className="w-6 h-6 text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-center">
          <p className="font-semibold text-ink">Passwort geändert</p>
          <p className="text-sm text-ink-3 mt-1">Ihr neues Passwort wurde erfolgreich gespeichert.</p>
        </div>
        <button
          onClick={() => setSuccess(false)}
          className="btn-secondary w-full"
        >
          Weiteres Passwort festlegen
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="cp-password" className="block text-sm font-medium text-ink-2 mb-1">
          Neues Passwort
        </label>
        <input
          id="cp-password"
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
        <label htmlFor="cp-confirm" className="block text-sm font-medium text-ink-2 mb-1">
          Passwort bestätigen
        </label>
        <input
          id="cp-confirm"
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
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Wird gespeichert…' : 'Passwort speichern'}
      </button>
    </form>
  )
}
