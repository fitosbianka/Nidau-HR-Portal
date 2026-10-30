'use client'

// Konto endgültig löschen (nur Externe oder inaktive Konten ohne
// aufbewahrungspflichtige Daten) mit Bestätigung durch Eingabe des Wortes.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteEmployeePermanently } from '@/actions/employees'

export default function DeleteEmployeeButton({ employeeId, fullName, extern }: { employeeId: string; fullName: string; extern: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [wort, setWort] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function loeschen() {
    setErr(null)
    startTransition(async () => {
      const r = await deleteEmployeePermanently(employeeId, wort)
      if (r.error) { setErr(r.error); return }
      router.push('/admin/mitarbeiter'); router.refresh()
    })
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setWort(''); setErr(null) }}
        className="text-sm py-1.5 px-3 rounded-lg border font-medium text-red-600 border-red-200 hover:bg-red-50 transition-colors">
        Endgültig löschen
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5">
            <p className="text-sm font-bold text-ink mb-1">Konto von {fullName} endgültig löschen</p>
            <p className="text-[12px] text-ink-2 mb-3">
              {extern
                ? 'Externe Person ohne Anstellungsverhältnis. Login, Profil, Plan-Einträge, Dokumente und alle Portal-Einträge werden entfernt. Das lässt sich nicht rückgängig machen.'
                : 'Inaktives Konto ohne Dokumente, Zeiten und Lohndaten. Login, Profil und alle Portal-Einträge werden entfernt. Das lässt sich nicht rückgängig machen.'}
            </p>
            <label className="text-[11px] font-semibold text-ink-4 uppercase tracking-wider">Zur Bestätigung «löschen» eingeben</label>
            <input value={wort} onChange={e => setWort(e.target.value)} className="input-field text-sm w-full mt-1" autoFocus />
            {err && <p className="text-xs text-blush-ink mt-2">⚠ {err}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="btn-secondary">Abbrechen</button>
              <button onClick={loeschen} disabled={isPending || wort.trim().toLowerCase() !== 'löschen'} className="btn-primary bg-red-600 hover:bg-red-700 border-red-600">
                {isPending ? 'Löscht…' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
