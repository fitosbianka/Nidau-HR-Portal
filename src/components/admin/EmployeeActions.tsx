'use client'

import { useTransition, useState } from 'react'
import { deactivateEmployee, reactivateEmployee } from '@/actions/employees'
import type { Profile } from '@/lib/supabase/types'

export default function EmployeeActions({ employee }: { employee: Profile }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    if (!confirm(
      employee.is_active
        ? `Konto von ${employee.full_name} wirklich deaktivieren?`
        : `Konto von ${employee.full_name} wieder aktivieren?`
    )) return

    startTransition(async () => {
      const result = employee.is_active
        ? await deactivateEmployee(employee.id)
        : await reactivateEmployee(employee.id)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={handleToggle}
        disabled={isPending}
        className={`flex items-center gap-1.5 text-sm py-1.5 px-3 rounded-lg border font-medium transition-colors disabled:opacity-50 ${
          employee.is_active
            ? 'text-red-600 border-red-200 hover:bg-red-50'
            : 'text-mint-ink border-mint-ink/30 hover:bg-mint-bg'
        }`}
      >
        {isPending ? 'Bitte warten…' : employee.is_active ? 'Deaktivieren' : 'Aktivieren'}
      </button>
    </div>
  )
}
