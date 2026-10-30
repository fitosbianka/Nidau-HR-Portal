'use client'

// Personal-Änderungen (admin only): list of upcoming staff changes with
// add/edit/erledigt/delete. Automatic entries (Lohn-Historie, Eintritte)
// are read-only here and managed at their source.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  savePersonalAenderung, setPersonalErledigt, deletePersonalAenderung,
  type PersonalTyp,
} from '@/actions/personal'
import type { PersonalEintrag } from '@/lib/personal-data'

export type { PersonalEintrag }

const TYP_UI: Record<PersonalTyp, { label: string; cls: string }> = {
  Ferien:    { label: 'Ferien extra', cls: 'bg-mint-bg text-mint-ink' },
  Lohn:      { label: 'Lohn',         cls: 'bg-steel-bg text-steel-ink' },
  Pensum:    { label: 'Pensum',       cls: 'bg-lilac-bg text-lilac-ink' },
  Austritt:  { label: 'Austritt',     cls: 'bg-blush-bg text-blush-ink' },
  Eintritt:  { label: 'Eintritt',     cls: 'bg-apricot-bg text-apricot-ink' },
  Sonstiges: { label: 'Sonstiges',    cls: 'bg-edge-row text-ink-3' },
}
const TYPEN = Object.keys(TYP_UI) as PersonalTyp[]

const fmtCH = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

type FormState = {
  key: string | null
  oldDatum: string | null
  datum: string
  emp: string
  typ: PersonalTyp
  text: string
  erledigt: boolean
}

export default function PersonalClient({
  eintraege, namen, today,
}: {
  eintraege: PersonalEintrag[]
  namen: string[]
  today: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [showVergangene, setShowVergangene] = useState(false)

  async function run(fn: () => Promise<{ error?: string } | undefined>) {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (r?.error) setError(r.error)
      else router.refresh()
    } catch {
      setError('Netzwerkfehler — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  const anstehend = eintraege.filter(e => !e.erledigt && e.datum >= today).sort((a, b) => a.datum.localeCompare(b.datum))
  const vergangene = eintraege.filter(e => e.erledigt || e.datum < today).sort((a, b) => b.datum.localeCompare(a.datum))

  function Zeile({ e }: { e: PersonalEintrag }) {
    const ui = TYP_UI[e.typ]
    const bald = !e.erledigt && e.datum >= today
      && (new Date(e.datum).getTime() - new Date(today).getTime()) / 86400000 <= 30
    return (
      <li className={`px-5 py-3.5 flex items-start gap-4 flex-wrap hover:bg-hovrow ${e.erledigt ? 'opacity-60' : ''}`}>
        <div className="w-[86px] flex-shrink-0 pt-0.5">
          <p className={`text-sm font-bold tnum ${bald ? 'text-apricot-ink' : 'text-ink'}`}>{fmtCH(e.datum)}</p>
          {bald && <p className="text-[10px] font-semibold text-apricot-ink">bald</p>}
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ui.cls}`}>{ui.label}</span>
            <p className="text-sm font-bold text-ink">{e.emp}</p>
            {e.quelle === 'lohnhistorie' && <span className="text-[10px] font-semibold text-ink-4">aus Lohn-Historie</span>}
            {e.quelle === 'profil' && <span className="text-[10px] font-semibold text-ink-4">aus Profil</span>}
            {e.erledigt && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink">✓ erledigt</span>}
          </div>
          {e.text && <p className="text-xs text-ink-3 mt-0.5">{e.text}</p>}
        </div>
        {e.quelle === 'manuell' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => run(() => setPersonalErledigt(e.key, e.datum, !e.erledigt))}
              disabled={busy}
              className="btn-secondary text-xs py-1.5 px-3"
            >{e.erledigt ? 'Wieder öffnen' : '✓ Erledigt'}</button>
            <button
              onClick={() => setForm({ key: e.key, oldDatum: e.datum, datum: e.datum, emp: e.emp, typ: e.typ, text: e.text, erledigt: e.erledigt })}
              className="btn-secondary text-xs py-1.5 px-3"
            >Bearbeiten</button>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Personal-Änderungen</h1>
          <p className="page-subtitle">Anstehende Änderungen im Team: zusätzliche Ferientage, Lohn, Pensum, Ein- und Austritte</p>
        </div>
        <button
          onClick={() => setForm({ key: null, oldDatum: null, datum: today, emp: '', typ: 'Sonstiges', text: '', erledigt: false })}
          className="btn-primary"
        >＋ Änderung erfassen</button>
      </div>

      {error && <p className="text-xs px-3 py-2 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {error}</p>}

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-edge-soft bg-surface">
          <p className="text-xs font-bold text-ink-2 uppercase tracking-wider">Anstehend ({anstehend.length})</p>
        </div>
        {anstehend.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-ink-2">Keine anstehenden Änderungen</p>
            <p className="text-xs text-ink-4 mt-1">Mit «Änderung erfassen» einen Eintrag anlegen. Zukünftige Lohn-/Pensum-Einträge aus der Lohn-Historie und Eintritte erscheinen hier automatisch.</p>
          </div>
        ) : (
          <ul className="divide-y divide-edge-row">
            {anstehend.map(e => <Zeile key={`${e.key}-${e.datum}`} e={e} />)}
          </ul>
        )}
      </div>

      {vergangene.length > 0 && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowVergangene(v => !v)}
            className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-hovrow transition-colors"
          >
            <p className="text-xs font-bold text-ink-4 uppercase tracking-wider">Erledigt / vergangen ({vergangene.length})</p>
            <span className="text-ink-4 text-xs">{showVergangene ? '▴' : '▾'}</span>
          </button>
          {showVergangene && (
            <ul className="divide-y divide-edge-row border-t border-edge-soft">
              {vergangene.map(e => <Zeile key={`${e.key}-${e.datum}`} e={e} />)}
            </ul>
          )}
        </div>
      )}

      {/* ── Form dialog ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5">
            <p className="text-sm font-bold text-ink mb-4">{form.key ? 'Änderung bearbeiten' : 'Änderung erfassen'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Gültig ab *</label>
                <input type="date" value={form.datum} onChange={e => setForm({ ...form, datum: e.target.value })} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Typ</label>
                <select value={form.typ} onChange={e => setForm({ ...form, typ: e.target.value as PersonalTyp })} className="select-field text-sm">
                  {TYPEN.map(t => <option key={t} value={t}>{TYP_UI[t].label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-2 mb-1">Person *</label>
                <input list="personal-namen" type="text" value={form.emp}
                  onChange={e => setForm({ ...form, emp: e.target.value })}
                  placeholder="Name wählen oder eingeben" className="input-field text-sm" />
                <datalist id="personal-namen">
                  {namen.map(n => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-2 mb-1">Beschreibung</label>
                <textarea value={form.text} rows={2} maxLength={500}
                  onChange={e => setForm({ ...form, text: e.target.value })}
                  placeholder="z. B. 2 zusätzliche Ferientage als Dank fürs Teamevent"
                  className="input-field text-sm resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              {form.key && (
                <button
                  onClick={() => { if (confirm('Diesen Eintrag löschen?')) { run(() => deletePersonalAenderung(form.key!, form.oldDatum ?? form.datum)); setForm(null) } }}
                  disabled={busy}
                  className="btn-secondary text-blush-ink"
                >Löschen</button>
              )}
              <div className="flex-1" />
              <button onClick={() => setForm(null)} className="btn-secondary">Abbrechen</button>
              <button
                onClick={() => { run(() => savePersonalAenderung(form)).then(() => setForm(null)) }}
                disabled={busy || !form.emp.trim() || !form.datum}
                className="btn-primary"
              >{busy ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
