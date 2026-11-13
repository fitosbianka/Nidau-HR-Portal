'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setStatus('idle')

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      })

      // Always show success to avoid email enumeration attacks
      if (!error) {
        setStatus('success')
      } else {
        setStatus('error')
      }
    } finally {
      setLoading(false)
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-100 rounded-full">
          <svg className="w-6 h-6 text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm text-ink-2">
          Falls ein Konto mit dieser E-Mail-Adresse existiert, erhalten Sie in Kürze eine E-Mail mit einem Link zum Zurücksetzen des Passworts.
        </p>
        <Link href="/login" className="btn-secondary inline-block">
          Zurück zur Anmeldung
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-2 mb-1">
          E-Mail-Adresse
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-field"
          placeholder="name@dentalpraxis.ch"
          required
          autoComplete="email"
        />
      </div>

      {status === 'error' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Wird gesendet…' : 'Link senden'}
      </button>

      <div className="text-center">
        <Link href="/login" className="text-sm text-mint-ink hover:text-ink hover:underline">
          Zurück zur Anmeldung
        </Link>
      </div>
    </form>
  )
}
