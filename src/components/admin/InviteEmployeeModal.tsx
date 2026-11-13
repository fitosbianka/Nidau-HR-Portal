'use client'

// Mitarbeiter hinzufügen: entweder per Einladung (E-Mail mit Link zum
// Passwort) oder als externe Person manuell (ohne Einladung, Kategorie wie
// bei Angestellten, Markierung «Extern»; mit E-Mail entsteht ein Konto mit
// Einmalpasswort, ohne E-Mail ein Eintrag ohne Portal-Zugang).

import { useState, useTransition } from 'react'
import { inviteEmployee, createExternEmployee } from '@/actions/employees'
import { EXTERN_KATEGORIEN } from '@/lib/externe'

type Modus = 'einladen' | 'extern' | 'gast'

export default function InviteEmployeeModal() {
  const [open, setOpen]               = useState(false)
  const [modus, setModus]             = useState<Modus>('einladen')
  const [error, setError]             = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [emailSent, setEmailSent]     = useState(false)
  const [externOhneLogin, setExternOhneLogin] = useState<string | null>(null)
  const [copied, setCopied]           = useState(false)
  const [isPending, startTransition]  = useTransition()

  function handleClose() {
    setOpen(false); setError(null); setTempPassword(null); setEmailSent(false); setExternOhneLogin(null); setCopied(false)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      if (modus === 'extern') {
        const r = await createExternEmployee(formData)
        if (r.error) setError(r.error)
        else if (r.tempPassword) setTempPassword(r.tempPassword)
        else setExternOhneLogin((formData.get('full_name') as string) ?? '')
        return
      }
      const result = await inviteEmployee(formData)
      if (result.error) setError(result.error)
      else if (result.tempPassword) setTempPassword(result.tempPassword)
      else setEmailSent(true)
    })
  }

  async function handleCopy() {
    if (!tempPassword) return
    await navigator.clipboard.writeText(tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Mitarbeiter hinzufügen
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ink">Mitarbeiter hinzufügen</h2>
              <button onClick={handleClose} className="text-ink-4 hover:text-ink-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {emailSent ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center w-12 h-12 bg-brand-100 rounded-full mx-auto">
                  <svg className="w-6 h-6 text-mint-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-ink">Einladungs-E-Mail verschickt</p>
                  <p className="text-sm text-ink-3 mt-1">Die Person erhält eine E-Mail mit einem Link zum Festlegen ihres Passworts.</p>
                </div>
                <button onClick={handleClose} className="btn-primary w-full">Schliessen</button>
              </div>

            ) : externOhneLogin !== null ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center w-12 h-12 bg-steel-bg rounded-full mx-auto">
                  <svg className="w-6 h-6 text-steel-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-ink">Externe Person angelegt</p>
                  <p className="text-sm text-ink-3 mt-1">
                    «{externOhneLogin}» ist mit der Markierung «Extern» erfasst und erscheint im Arbeitsplan in ihrer Kategorie. Ohne E-Mail gibt es keinen Portal-Zugang; dieser lässt sich später über die Detailseite ergänzen.
                  </p>
                </div>
                <button onClick={handleClose} className="btn-primary w-full">Fertig</button>
              </div>

            ) : tempPassword ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center w-12 h-12 bg-apricot-bg rounded-full mx-auto">
                  <svg className="w-6 h-6 text-apricot-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-ink">Konto erstellt</p>
                  <p className="text-sm text-ink-3 mt-1">
                    {modus === 'extern' || modus === 'gast'
                      ? 'Es wurde keine E-Mail verschickt. Dieses Einmalpasswort der Person direkt weitergeben (z. B. per WhatsApp).'
                      : 'E-Mail konnte nicht gesendet werden. Dieses Einmalpasswort der Person direkt weitergeben (z. B. per WhatsApp).'}
                  </p>
                </div>
                <div className="bg-surface border border-edge-ctl rounded-xl p-4">
                  <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest mb-2">Einmalpasswort</p>
                  <div className="flex items-center gap-3">
                    <p className="flex-1 text-2xl font-mono font-bold tracking-widest text-ink select-all">{tempPassword}</p>
                    <button onClick={handleCopy}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${copied ? 'bg-brand-100 text-ink' : 'bg-white border border-edge-ctl text-ink-2 hover:border-brand-300 hover:text-mint-ink'}`}>
                      {copied ? 'Kopiert' : 'Kopieren'}
                    </button>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">Anleitung für die Person:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Portal öffnen und mit E-Mail + diesem Passwort anmelden</li>
                    <li>Unter <span className="font-semibold">Passwort ändern</span> ein eigenes Passwort festlegen</li>
                  </ol>
                </div>
                <button onClick={handleClose} className="btn-primary w-full">Fertig</button>
              </div>

            ) : (
              <form action={handleSubmit} className="space-y-4">
                {/* Modus */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface border border-edge-soft">
                  {([['einladen', 'Angestellte einladen'], ['extern', 'Extern manuell'], ['gast', 'Gast']] as Array<[Modus, string]>).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setModus(k); setError(null) }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${modus === k ? 'bg-white shadow-sm text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink-4">
                  {modus === 'einladen'
                    ? 'Die Person erhält eine E-Mail mit einem Link zum Festlegen ihres Passworts.'
                    : modus === 'gast'
                      ? 'Gäste (z. B. Begleitpersonen an einem Teamevent) erhalten ein eigenes Login mit Einmalpasswort und sehen ausschliesslich den Ordner Teamevents. Sie erscheinen in keiner Liste des Portals, nicht im Arbeitsplan, nicht in der Ferienplanung, nicht im Konto.'
                      : 'Externe (selbständig, kein Anstellungsverhältnis) werden ohne Einladung angelegt. Sie erscheinen im Arbeitsplan in ihrer Kategorie, zählen aber nicht als Angestellte: keine Ferienplanung, keine Lohn-Erinnerungen.'}
                </p>

                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">Vollständiger Name <span className="text-red-500">*</span></label>
                  <input name="full_name" type="text" className="input-field" placeholder="Vorname Nachname" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">
                    E-Mail-Adresse {modus !== 'extern' ? <span className="text-red-500">*</span> : <span className="text-ink-4 font-normal">(optional, für den Portal-Zugang)</span>}
                  </label>
                  <input name="email" type="email" className="input-field" placeholder={modus === 'extern' ? 'leer lassen = kein Portal-Zugang' : modus === 'gast' ? 'gast@beispiel.ch' : 'mitarbeiter@dentalpraxis.ch'} required={modus !== 'extern'} />
                </div>
                {modus !== 'gast' && (
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">Kategorie <span className="text-red-500">*</span></label>
                  <select name="job_title" required className="select-field" defaultValue="">
                    <option value="">Bitte wählen…</option>
                    {modus === 'einladen' ? (
                      <>
                        <option value="ZAZ">ZAZ</option>
                        <option value="DH / PA">DH / PA</option>
                        <option value="DA">DA</option>
                        <option value="Leitende DA">Leitende DA</option>
                        <option value="Lernende">Lernende</option>
                        <option value="Admin">Admin</option>
                      </>
                    ) : EXTERN_KATEGORIEN.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                )}

                {error && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={handleClose} className="btn-secondary flex-1">Abbrechen</button>
                  <button type="submit" disabled={isPending} className="btn-primary flex-1">
                    {isPending ? 'Wird erstellt…' : modus === 'einladen' ? 'Einladung senden' : modus === 'gast' ? 'Gast anlegen' : 'Extern anlegen'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
