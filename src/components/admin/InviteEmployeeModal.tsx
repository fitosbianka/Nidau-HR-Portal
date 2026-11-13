'use client'

// Mitarbeiter hinzufügen: Name, Funktion und wahlweise eine E-Mail. Mit
// E-Mail entsteht sofort ein Portal Konto mit Einmalpasswort, das der Admin
// der Person weitergibt (keine Einladungsmail). Ohne E-Mail wird die Person
// vorerst ohne Konto geführt; alle Angaben lassen sich trotzdem erfassen,
// das Konto kommt später über die Personalakte (Abschnitt «Zugriff») dazu.
// Externe (selbständig) werden gleich angelegt, zusätzlich mit der
// Markierung «Extern».

import { useState, useTransition } from 'react'
import { createEmployee, createExternEmployee } from '@/actions/employees'
import { FUNKTIONEN, EXTERN_FUNKTIONEN } from '@/lib/funktionen'

type Modus = 'angestellt' | 'extern'
type Ergebnis = { art: 'konto'; name: string; tempPassword: string } | { art: 'ohneKonto'; name: string }

export default function InviteEmployeeModal() {
  const [open, setOpen]               = useState(false)
  const [modus, setModus]             = useState<Modus>('angestellt')
  const [error, setError]             = useState<string | null>(null)
  const [ergebnis, setErgebnis]       = useState<Ergebnis | null>(null)
  const [copied, setCopied]           = useState(false)
  const [isPending, startTransition]  = useTransition()

  function handleClose() {
    setOpen(false); setError(null); setErgebnis(null); setCopied(false)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    const name = ((formData.get('full_name') as string) ?? '').trim()
    startTransition(async () => {
      const r = modus === 'extern' ? await createExternEmployee(formData) : await createEmployee(formData)
      if (r.error) { setError(r.error); return }
      if (r.tempPassword) setErgebnis({ art: 'konto', name, tempPassword: r.tempPassword })
      else setErgebnis({ art: 'ohneKonto', name })
    })
  }

  async function handleCopy() {
    if (ergebnis?.art !== 'konto') return
    await navigator.clipboard.writeText(ergebnis.tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const funktionen: readonly string[] = modus === 'extern' ? EXTERN_FUNKTIONEN : FUNKTIONEN

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
              <button onClick={handleClose} className="text-ink-4 hover:text-ink-2" aria-label="Schliessen">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {ergebnis?.art === 'ohneKonto' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center w-12 h-12 bg-steel-bg rounded-full mx-auto">
                  <svg className="w-6 h-6 text-steel-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-ink">{ergebnis.name} ist angelegt</p>
                  <p className="text-sm text-ink-3 mt-1">
                    Vorerst ohne Portal Konto. Alle Angaben (Personalakte, Standardwoche, Arbeitsplan, Zeiten, Dokumente) lassen sich jetzt schon erfassen.
                    Das Konto erstellst du später in der Personalakte unter «Zugriff» mit der E-Mail der Person; alles bereits Erfasste bleibt erhalten.
                  </p>
                </div>
                <button onClick={handleClose} className="btn-primary w-full">Fertig</button>
              </div>

            ) : ergebnis?.art === 'konto' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center w-12 h-12 bg-apricot-bg rounded-full mx-auto">
                  <svg className="w-6 h-6 text-apricot-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-ink">Konto für {ergebnis.name} erstellt</p>
                  <p className="text-sm text-ink-3 mt-1">
                    Es wird keine E-Mail verschickt. Dieses Einmalpasswort der Person direkt weitergeben, zum Beispiel per WhatsApp. Es wird nur jetzt angezeigt.
                  </p>
                </div>
                <div className="bg-surface border border-edge-ctl rounded-xl p-4">
                  <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest mb-2">Einmalpasswort</p>
                  <div className="flex items-center gap-3">
                    <p className="flex-1 text-2xl font-mono font-bold tracking-widest text-ink select-all">{ergebnis.tempPassword}</p>
                    <button onClick={handleCopy}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${copied ? 'bg-brand-100 text-ink' : 'bg-white border border-edge-ctl text-ink-2 hover:border-brand-300 hover:text-mint-ink'}`}>
                      {copied ? 'Kopiert' : 'Kopieren'}
                    </button>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">Anleitung für die Person:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Portal öffnen und mit E-Mail und diesem Passwort anmelden</li>
                    <li>Unter <span className="font-semibold">Passwort ändern</span> ein eigenes Passwort festlegen</li>
                  </ol>
                </div>
                <button onClick={handleClose} className="btn-primary w-full">Fertig</button>
              </div>

            ) : (
              <form action={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface border border-edge-soft">
                  {([['angestellt', 'Angestellte'], ['extern', 'Extern (selbständig)']] as Array<[Modus, string]>).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setModus(k); setError(null) }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${modus === k ? 'bg-white shadow-sm text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink-4">
                  {modus === 'angestellt'
                    ? 'Mit E-Mail entsteht sofort ein Portal Konto mit Einmalpasswort, das du der Person weitergibst. Ohne E-Mail wird die Person vorerst ohne Konto geführt, alle Angaben kannst du trotzdem erfassen.'
                    : 'Externe (selbständig, kein Anstellungsverhältnis) erscheinen im Arbeitsplan in ihrer Funktion, zählen aber nicht als Angestellte: keine Ferienplanung, keine Zeiterfassung.'}
                </p>

                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">Vollständiger Name <span className="text-red-500">*</span></label>
                  <input name="full_name" type="text" className="input-field" placeholder="Vorname Nachname" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">Funktion <span className="text-red-500">*</span></label>
                  <select name="job_title" required className="select-field" defaultValue="">
                    <option value="">Bitte wählen…</option>
                    {funktionen.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {modus === 'angestellt' && <p className="text-[10.5px] text-ink-4 mt-1">Admin und HR &amp; Finanzen erhalten die Admin Rechte des Portals.</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">
                    E-Mail-Adresse <span className="text-ink-4 font-normal">(optional, für das Portal Konto)</span>
                  </label>
                  <input name="email" type="email" className="input-field" placeholder="leer lassen = vorerst ohne Konto" />
                </div>

                {error && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={handleClose} className="btn-secondary flex-1">Abbrechen</button>
                  <button type="submit" disabled={isPending} className="btn-primary flex-1">
                    {isPending ? 'Wird angelegt…' : modus === 'extern' ? 'Extern anlegen' : 'Anlegen'}
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
