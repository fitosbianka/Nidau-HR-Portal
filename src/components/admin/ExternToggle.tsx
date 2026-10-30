'use client'

// Markierung «Extern» (selbständig, kein Anstellungsverhältnis) auf der
// Detailseite setzen oder entfernen.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setExtern } from '@/actions/employees'

export default function ExternToggle({ employeeId, extern, fest }: { employeeId: string; extern: boolean; fest: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  if (fest) return <span className="text-[11px] text-ink-4" title="Fest in der Namensliste der Externen hinterlegt">Extern (fest hinterlegt)</span>
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={() => {
          if (!confirm(extern ? 'Markierung «Extern» entfernen? Die Person zählt dann wieder als Angestellte.' : 'Als «Extern» markieren? Selbständige zählen nicht als Angestellte (keine Ferienplanung, keine Lohn-Erinnerungen).')) return
          setError(null)
          startTransition(async () => {
            const r = await setExtern(employeeId, !extern)
            if (r.error) { setError(r.error); return }
            router.refresh()
          })
        }}
        disabled={isPending}
        className={`text-sm py-1.5 px-3 rounded-lg border font-medium transition-colors disabled:opacity-50 ${extern ? 'text-steel-ink border-steel-ink/30 bg-steel-bg hover:bg-white' : 'text-ink-3 border-edge-ctl hover:bg-surface'}`}
        title="Selbständig, kein Anstellungsverhältnis"
      >
        {isPending ? 'Bitte warten…' : extern ? 'Extern ✓' : 'Als Extern markieren'}
      </button>
    </div>
  )
}
