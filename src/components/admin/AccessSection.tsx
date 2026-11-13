'use client'

// Zugriff in der Personalakte: Portal Konto (erstellen mit E-Mail und
// Startpasswort, neues Passwort für bestehende Konten) und die Admin
// Rechte. Das Portal verschickt dafür keine E-Mails; der Admin gibt das
// Passwort der Person direkt weiter, sie darf es behalten oder unter
// «Passwort ändern» ein eigenes setzen. «Passwort vergessen» beim Login
// bleibt daneben bestehen (Supabase Mail).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setAdminAccess, kontoErstellen, passwortNeuSetzen } from '@/actions/employees'
import { hatPortalKonto } from '@/lib/konto-status'

export default function AccessSection({
  employeeId, fullName, email, role, isSelf,
}: {
  employeeId: string
  fullName: string
  email: string
  role: string
  isSelf: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [neueEmail, setNeueEmail] = useState('')
  const [passwort, setPasswort] = useState<{ email: string; wert: string; neu: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const isAdmin = role === 'admin'
  const hatKonto = hatPortalKonto(email)

  function lauf(aktion: () => Promise<{ error?: string; tempPassword?: string }>, nachher?: (r: { tempPassword?: string }) => void) {
    setBusy(true)
    setError(null)
    startTransition(async () => {
      let r: { error?: string; tempPassword?: string } | undefined
      try {
        r = await aktion()
      } catch {
        r = { error: 'Netzwerkfehler, bitte erneut versuchen.' }
      }
      if (r?.error) setError(r.error)
      else { nachher?.(r ?? {}); router.refresh() }
      setBusy(false)
    })
  }

  function change(grant: boolean) {
    const msg = grant
      ? `${fullName} vollen Admin-Zugriff geben?\nDas Konto erhält danach genau dieselben Rechte wie das Admin-Konto: alle Bereiche, alle Mitarbeiterdaten, Dokumente, Arbeitsplan-Verwaltung und Exporte.`
      : `${fullName} den Admin-Zugriff entziehen?\nDas Konto wird wieder ein normales Mitarbeiter-Konto.`
    if (!confirm(msg)) return
    lauf(() => setAdminAccess(employeeId, grant))
  }

  function kontoAnlegen() {
    const e = neueEmail.trim()
    if (!e) { setError('Bitte die E-Mail-Adresse der Person eingeben.'); return }
    lauf(() => kontoErstellen(employeeId, e), r => { if (r.tempPassword) setPasswort({ email: e.toLowerCase(), wert: r.tempPassword, neu: true }); setNeueEmail('') })
  }

  function passwortNeu() {
    if (!confirm(`Für ${fullName} ein neues Passwort setzen?\nDas bisherige Passwort gilt danach nicht mehr. Das neue Passwort wird nur jetzt angezeigt.`)) return
    lauf(() => passwortNeuSetzen(employeeId), r => { if (r.tempPassword) setPasswort({ email, wert: r.tempPassword, neu: false }) })
  }

  async function handleCopy() {
    if (!passwort) return
    await navigator.clipboard.writeText(passwort.wert)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="card p-6 space-y-5">
      <h2 className="text-sm font-semibold text-ink-2">Zugriff</h2>

      {/* ── Portal Konto ─────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${hatKonto ? 'bg-mint-bg text-mint-ink' : 'bg-apricot-bg text-apricot-ink'}`}>
            {hatKonto ? '✓ Portal Konto' : 'Ohne Portal Konto'}
          </span>
          <p className="text-[11.5px] text-ink-4 mt-2 max-w-[52ch]">
            {hatKonto
              ? <>Anmeldung mit <span className="font-semibold text-ink-2 break-all">{email}</span>. Hat die Person ihr Passwort vergessen, hier ein neues Passwort setzen und weitergeben, oder sie nutzt «Passwort vergessen» beim Login.</>
              : 'Die Person kann sich noch nicht anmelden. Alle Angaben lassen sich trotzdem erfassen. Mit der E-Mail entsteht das Konto; alles bereits Erfasste bleibt erhalten.'}
          </p>
        </div>
        {hatKonto && !isSelf && (
          <button onClick={passwortNeu} disabled={busy} className="btn-secondary text-xs py-1.5 px-3">
            {busy ? 'Wird gespeichert…' : 'Neues Passwort setzen'}
          </button>
        )}
      </div>

      {!hatKonto && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">E-Mail der Person</span>
            <input type="email" value={neueEmail} onChange={e => setNeueEmail(e.target.value)} placeholder="name@beispiel.ch" className="input-field text-sm" />
          </label>
          <button onClick={kontoAnlegen} disabled={busy || !neueEmail.trim()} className="btn-primary text-xs py-2 px-3 disabled:opacity-50">
            {busy ? 'Wird erstellt…' : 'Konto erstellen'}
          </button>
        </div>
      )}

      {passwort && (
        <div className="bg-surface border border-edge-ctl rounded-xl p-4 space-y-2">
          <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">{passwort.neu ? 'Konto erstellt, Startpasswort' : 'Neues Passwort'}</p>
          <div className="flex items-center gap-3">
            <p className="flex-1 text-2xl font-mono font-bold tracking-widest text-ink select-all">{passwort.wert}</p>
            <button onClick={handleCopy}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${copied ? 'bg-brand-100 text-ink' : 'bg-white border border-edge-ctl text-ink-2 hover:border-brand-300 hover:text-mint-ink'}`}>
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <p className="text-[11.5px] text-ink-3">
            Der Person weitergeben, zum Beispiel per WhatsApp: anmelden mit <span className="font-semibold break-all">{passwort.email}</span> und diesem Passwort. Sie darf es behalten oder unter «Passwort ändern» ein eigenes setzen. Das Passwort wird nur jetzt angezeigt.
          </p>
          <button onClick={() => setPasswort(null)} className="text-xs text-ink-4 hover:text-ink-2">Ausblenden</button>
        </div>
      )}

      {/* ── Rolle ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap pt-4 border-t border-edge-soft">
        <div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
            isAdmin ? 'bg-mint-bg text-mint-ink' : 'bg-surface border border-edge-ctl text-ink-3'
          }`}>
            {isAdmin ? '✓ Admin, voller Zugriff' : 'Mitarbeiter/in'}
          </span>
          <p className="text-[11.5px] text-ink-4 mt-2 max-w-[52ch]">
            {isAdmin
              ? 'Dieses Konto hat volle Admin-Rechte: alle Bereiche und Verwaltungsfunktionen des Portals. Die Funktionen Admin und HR & Finanzen erhalten diese Rechte automatisch.'
              : 'Dieses Konto sieht nur den eigenen Mitarbeiter-Bereich. Die Funktionen Admin und HR & Finanzen erhalten die Admin-Rechte automatisch.'}
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
      {error && <p className="text-xs text-red-600">⚠ {error}</p>}
    </div>
  )
}
