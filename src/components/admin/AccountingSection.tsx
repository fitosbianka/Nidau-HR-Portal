'use client'

import { useState, useTransition } from 'react'
import { updateAccountingDetails } from '@/actions/employees'
import type { Profile } from '@/lib/supabase/types'

const MARITAL_STATUSES = [
  'Ledig', 'Verheiratet', 'Eingetragene Partnerschaft', 'Getrennt', 'Geschieden', 'Verwitwet',
]

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">{label}</p>
      <p className="text-sm text-ink mt-1">{value || '—'}</p>
    </div>
  )
}

export default function AccountingSection({ employee }: { employee: Profile }) {
  const [editing, setEditing]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await updateAccountingDetails(formData)
      if (result.error) { setError(result.error) } else { setEditing(false) }
    })
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-ink-2">Buchhaltung</h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1.5 px-3">
            Bearbeiten
          </button>
        )}
      </div>

      {editing ? (
        <form action={handleSubmit} className="space-y-4">
          <input type="hidden" name="id" value={employee.id} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-ink-2 mb-1">AHV-Nummer</label>
              <input name="ahv_nummer" defaultValue={employee.ahv_nummer ?? ''} className="input-field"
                placeholder="756.XXXX.XXXX.XX" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Anzahl Kinder</label>
              <input name="children_count" type="number" min="0" max="20"
                defaultValue={employee.children_count ?? ''} className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Zivilstand</label>
              <select name="marital_status" defaultValue={employee.marital_status ?? ''} className="select-field text-sm">
                <option value="">— keine —</option>
                {MARITAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
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
          <Field label="AHV-Nummer"    value={employee.ahv_nummer ?? ''} />
          <Field label="Anzahl Kinder" value={employee.children_count != null ? String(employee.children_count) : ''} />
          <Field label="Zivilstand"    value={employee.marital_status ?? ''} />
        </div>
      )}
    </div>
  )
}
