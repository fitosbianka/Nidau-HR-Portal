'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { signIn } from '@/actions/auth'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Wird angemeldet…
        </span>
      ) : 'Anmelden'}
    </button>
  )
}

export default function LoginForm({ error }: { error?: string }) {
  return (
    <form action={signIn} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-2 mb-1.5">
          E-Mail-Adresse
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input-field"
          placeholder="name@dentalpraxis.ch"
          required
          autoComplete="email"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink-2 mb-1.5">
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input-field"
          placeholder="••••••••"
          required
          autoComplete="current-password"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {error}
        </div>
      )}

      <SubmitButton />
    </form>
  )
}
