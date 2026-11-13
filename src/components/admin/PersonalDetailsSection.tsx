'use client'

import { useState, useTransition } from 'react'
import { updatePersonalDetails } from '@/actions/employees'
import { formatDateOptional } from '@/lib/utils'
import type { Profile } from '@/lib/supabase/types'
import { FUNKTIONEN } from '@/lib/funktionen'

const JOB_CATEGORIES: readonly string[] = FUNKTIONEN

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">{label}</p>
      <p className="text-sm text-ink mt-1 break-words">{value || '—'}</p>
    </div>
  )
}

export default function PersonalDetailsSection({ employee }: { employee: Profile }) {
  const [editing, setEditing]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await updatePersonalDetails(formData)
      if (result.error) { setError(result.error) } else { setEditing(false) }
    })
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-ink-2">Persönliche Angaben</h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1.5 px-3">
            Bearbeiten
          </button>
        )}
      </div>

      {editing ? (
        <form action={handleSubmit} className="space-y-4">
          <input type="hidden" name="id" value={employee.id} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Vollständiger Name *</label>
              <input name="full_name" defaultValue={employee.full_name} className="input-field" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Funktion</label>
              <select name="job_title" defaultValue={employee.job_title ?? ''} className="select-field text-sm">
                <option value="">— keine —</option>
                {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Login-E-Mail</label>
              <input name="email" type="email" defaultValue={employee.email} className="input-field"
                placeholder="name@beispiel.ch" />
              <p className="text-[10.5px] text-ink-4 mt-1">
                Ändert auch die Anmeldung — das Passwort bleibt unverändert.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Geburtsdatum</label>
              <input name="birthday" type="date" defaultValue={employee.birthday ?? ''} className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Telefon</label>
              <input name="phone" type="tel" defaultValue={employee.phone ?? ''} className="input-field"
                placeholder="+41 79 123 45 67" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Adresse</label>
            <textarea name="address" defaultValue={employee.address ?? ''} className="input-field resize-none" rows={2}
              placeholder="Musterstrasse 1, 3000 Bern" />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { setEditing(false); setError(null) }}
              className="btn-secondary flex-1 sm:flex-none sm:px-5">Abbrechen</button>
            <button type="submit" disabled={isPending}
              className="btn-primary flex-1 sm:flex-none sm:px-5">
              {isPending ? 'Speichern…' : 'Speichern'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <Field label="Name"         value={employee.full_name} />
          <Field label="Funktion"     value={employee.job_title ?? ''} />
          <Field label="Geburtsdatum" value={formatDateOptional(employee.birthday)} />
          <Field label="E-Mail"       value={employee.email} />
          <Field label="Telefon"      value={employee.phone ?? ''} />
          <Field label="Adresse"      value={employee.address ?? ''} />
        </div>
      )}
    </div>
  )
}
