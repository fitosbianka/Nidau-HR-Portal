'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setAdminAccess } from '@/actions/employees'

/** Access card on the employee dossier: shows whether the account has full
 *  admin access and lets the admin grant or revoke it. */
export default function AccessSection({
  employeeId, fullName, role, isSelf,
}: {
  employeeId: string
  fullName: string
  role: string
  isSelf: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isAdmin = role === 'admin'

  function change(grant: boolean) {
    const msg = grant
      ? `${fullName} vollen Admin-Zugriff geben?\nDas Konto erhält danach genau dieselben Rechte wie das Admin-Konto: alle Bereiche, alle Mitarbeiterdaten, Löhne, Dokumente, Arbeitsplan-Verwaltung und Exporte.`
      : `${fullName} den Admin-Zugriff entziehen?\nDas Konto wird wieder ein normales Mitarbeiter-Konto.`
    if (!confirm(msg)) return
    setBusy(true)
    setError(null)
    startTransition(async () => {
      let r: { error?: string } | undefined
      try {
        r = await setAdminAccess(employeeId, grant)
      } catch {
        r = { error: 'Netzwerkfehler — bitte erneut versuchen.' }
      }
      if (r?.error) setError(r.error)
      else router.refresh()
      setBusy(false)
    })
  }

  return (
    <div className="card p-6">
      <h2 className="text-sm font-semibold text-ink-2 mb-4">Zugriff</h2>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
            isAdmin ? 'bg-mint-bg text-mint-ink' : 'bg-surface border border-edge-ctl text-ink-3'
          }`}>
            {isAdmin ? '✓ Admin — voller Zugriff' : 'Mitarbeiter/in'}
          </span>
          <p className="text-[11.5px] text-ink-4 mt-2 max-w-[52ch]">
            {isAdmin
              ? 'Dieses Konto hat volle Admin-Rechte: alle Bereiche und Verwaltungsfunktionen des Portals.'
              : 'Dieses Konto sieht nur den eigenen Mitarbeiter-Bereich.'}
            {isSelf && ' (Ihr eigenes Konto.)'}
          </p>
        </div>
        {!isSelf && (
          <button
            onClick={() => change(!isAdmin)}
            disabled={busy}
            className={isAdmin ? 'btn-secondary text-xs py-1.5 px-3' : 'btn-primary text-xs py-1.5 px-3'}
          >
            {busy ? 'Wird gespeichert…' : isAdmin ? 'Admin-Zugriff entziehen' : 'Vollen Admin-Zugriff geben'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mt-3">⚠ {error}</p>}
    </div>
  )
}
