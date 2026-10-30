'use client'

// Samstagsöffnungen: Liste der Samstage mit den eingetragenen Behandlern
// und Assistenzen. Behandler und Assistenz tragen sich selbst ein oder
// aus; Admins legen Samstage an, bearbeiten und löschen sie und tragen
// Personen direkt ein.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { isoKw } from '@/lib/ferien'
import {
  samstagAnlegen, samstagBearbeiten, samstagLoeschen, samstagAnmelden, samstagAbmelden, samstagPersonSetzen, samstagPersonEntfernen,
} from '@/actions/samstage'
import { ROLLE_LABEL, ROLLEN, fmtSamstag, istSamstag, samstagRolle, type Samstag, type SamstagRolle } from '@/lib/samstage'
import type { SamstagPerson } from '@/lib/samstage-data'

type Form = { alt: string | null; datum: string; notiz: string; zahnarzt: string; dhpa: string; assistenz: string }
// Standardbedarf beim Anlegen: je 1 Zahnarzt, 1 DH / PA und 1 Assistenz
const LEER: Form = { alt: null, datum: '', notiz: '', zahnarzt: '1', dhpa: '1', assistenz: '1' }

export default function SamstageSection({ samstage, meinId, meineRolle, verwalten, team = [], heute }: {
  samstage: Samstag[]
  meinId: string
  meineRolle: SamstagRolle | null
  verwalten: boolean
  team?: SamstagPerson[]
  heute: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<Form | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [personFuer, setPersonFuer] = useState<string | null>(null)   // Datum, für das gerade eine Person gewählt wird
  const [personId, setPersonId] = useState('')
  const [personRolle, setPersonRolle] = useState<SamstagRolle | ''>('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [vergangene, setVergangene] = useState(false)

  const sichtbar = samstage.filter(s => vergangene || s.datum >= heute)
  const anzahlVergangen = samstage.filter(s => s.datum < heute).length
  const jahre = Array.from(new Set(sichtbar.map(s => s.datum.slice(0, 4))))

  function run(fn: () => Promise<{ error?: string } | { success: true }>, ok?: string) {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      if (ok) setMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }

  function speichernForm() {
    if (!form) return
    if (!istSamstag(form.datum)) { setFormErr('Bitte ein Datum wählen, das auf einen Samstag fällt.'); return }
    setFormErr(null)
    const bedarf = { zahnarzt: form.zahnarzt ? Number(form.zahnarzt) : null, dhpa: form.dhpa ? Number(form.dhpa) : null, assistenz: form.assistenz ? Number(form.assistenz) : null }
    startTransition(async () => {
      const r = form.alt
        ? await samstagBearbeiten(form.alt, { datum: form.datum, notiz: form.notiz, bedarf })
        : await samstagAnlegen(form.datum, form.notiz, bedarf)
      if ('error' in r && r.error) { setFormErr(r.error); return }
      setForm(null); setMsg({ type: 'ok', text: form.alt ? 'Samstag angepasst.' : 'Samstag angelegt.' })
      router.refresh()
    })
  }

  const personWaehlbar = (s: Samstag) => team.filter(p => !s.anmeldungen.some(a => a.profileId === p.id))
  const gewaehltePerson = team.find(p => p.id === personId)
  const rolleVorschlag = gewaehltePerson ? samstagRolle(gewaehltePerson.job_title) : null

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-edge-soft">
        <div>
          <p className="text-sm font-semibold text-ink">Samstagsöffnungen</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">
            {verwalten
              ? 'Samstage, an denen die Praxis offen ist. Zahnärztinnen, DH / PA und Assistenz tragen sich selbst ein, hier lassen sich Personen auch direkt zuteilen. Jede Eintragung steht sofort als Anwesend im Arbeitsplan des Samstags.'
              : 'Samstage, an denen die Praxis offen ist. Wer arbeiten kann, trägt sich ein, der Samstag steht dann in deinem Arbeitsplan. Die Einteilung macht die Praxisleitung.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {anzahlVergangen > 0 && (
            <button onClick={() => setVergangene(v => !v)} className="text-[11px] text-ink-4 hover:text-ink-2">{vergangene ? 'Vergangene ausblenden' : `Vergangene anzeigen (${anzahlVergangen})`}</button>
          )}
          {verwalten && (
            <button onClick={() => { setForm({ ...LEER }); setFormErr(null) }} className="btn-primary !px-3.5 !py-2 !text-xs">＋ Samstag</button>
          )}
        </div>
      </div>

      {msg && (
        <p className={`mx-6 mt-3 text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </p>
      )}

      {sichtbar.length === 0 ? (
        <p className="text-sm text-ink-4 py-10 text-center">{verwalten ? 'Noch keine Samstage erfasst. Mit «＋ Samstag» den ersten anlegen.' : 'Zurzeit sind keine Samstagsöffnungen erfasst.'}</p>
      ) : jahre.map(jahr => (
        <div key={jahr}>
          <p className="px-6 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{jahr}</p>
          <ul className="divide-y divide-edge-row">
            {sichtbar.filter(s => s.datum.startsWith(jahr)).map(s => {
              const vorbei = s.datum < heute
              const ichDabei = s.anmeldungen.some(a => a.profileId === meinId)
              const spalten: SamstagRolle[] = ROLLEN
              return (
                <li key={s.datum} className={`px-6 py-3 ${vorbei ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                    <div className="min-w-[150px]">
                      <p className="text-sm font-semibold text-ink tnum">{fmtSamstag(s.datum)}</p>
                      <p className="text-[11px] text-ink-4 tnum">KW {isoKw(s.datum)}{s.notiz ? ` · ${s.notiz}` : ''}</p>
                    </div>
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 min-w-[240px]">
                      {spalten.map(rolle => {
                        const liste = s.anmeldungen.filter(a => a.rolle === rolle)
                        const soll = s.bedarf[rolle]
                        const fehlt = soll != null && liste.length < soll
                        return (
                          <div key={rolle}>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                              {ROLLE_LABEL[rolle]}
                              {soll != null && <span className={`ml-1.5 normal-case tracking-normal tnum ${fehlt ? 'text-apricot-ink' : 'text-mint-ink'}`}>{liste.length} von {soll}</span>}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {liste.length === 0 && <span className="text-xs text-ink-5">noch niemand</span>}
                              {liste.map(a => (
                                <span key={a.profileId} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] ${a.profileId === meinId ? 'bg-mint-mid text-white' : 'bg-mint-bg text-mint-ink'}`}
                                  title={a.durchAdmin ? 'Durch Admin eingetragen' : 'Selbst eingetragen'}>
                                  {a.name}
                                  {verwalten && (
                                    <button onClick={() => run(() => samstagPersonEntfernen(s.datum, a.profileId))} disabled={isPending} className="opacity-70 hover:opacity-100" title="Entfernen">✕</button>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap ml-auto">
                      {!vorbei && meineRolle && (
                        ichDabei
                          ? <button onClick={() => run(() => samstagAbmelden(s.datum), 'Abgemeldet.')} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs">Abmelden</button>
                          : <button onClick={() => run(() => samstagAnmelden(s.datum), 'Eingetragen.')} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">Ich kann</button>
                      )}
                      {verwalten && (
                        <>
                          <button onClick={() => { setPersonFuer(personFuer === s.datum ? null : s.datum); setPersonId(''); setPersonRolle('') }} className="text-[11px] font-semibold text-mint-ink hover:underline">+ Person</button>
                          <button onClick={() => { setForm({ alt: s.datum, datum: s.datum, notiz: s.notiz, zahnarzt: s.bedarf.zahnarzt?.toString() ?? '', dhpa: s.bedarf.dhpa?.toString() ?? '', assistenz: s.bedarf.assistenz?.toString() ?? '' }); setFormErr(null) }}
                            className="text-[11px] font-semibold text-ink-3 hover:underline">Bearbeiten</button>
                          <button onClick={() => { if (confirm(`Samstag ${fmtSamstag(s.datum)} samt Anmeldungen löschen?`)) run(() => samstagLoeschen(s.datum), 'Samstag gelöscht.') }}
                            className="text-[11px] text-ink-4 hover:text-red-500">Löschen</button>
                        </>
                      )}
                    </div>
                  </div>
                  {verwalten && personFuer === s.datum && (
                    <div className="mt-2 flex flex-wrap items-end gap-2 bg-surface/60 rounded-ctl p-2">
                      <select value={personId} onChange={e => { setPersonId(e.target.value); setPersonRolle('') }} className="input-field text-sm w-56">
                        <option value="">Person wählen…</option>
                        {personWaehlbar(s).map(p => <option key={p.id} value={p.id}>{p.full_name}{p.job_title ? ` (${p.job_title})` : ''}</option>)}
                      </select>
                      <select value={personRolle || rolleVorschlag || ''} onChange={e => setPersonRolle(e.target.value as SamstagRolle | '')} className="input-field text-sm w-40">
                        <option value="">Rolle…</option>
                        {ROLLEN.map(r => <option key={r} value={r}>{ROLLE_LABEL[r]}</option>)}
                      </select>
                      <button disabled={!personId || isPending}
                        onClick={() => run(() => samstagPersonSetzen(s.datum, personId, (personRolle || rolleVorschlag) as SamstagRolle | null), 'Person eingetragen.')}
                        className="btn-primary !px-3 !py-1.5 !text-xs">Eintragen</button>
                      <button onClick={() => setPersonFuer(null)} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5 space-y-3">
            <p className="text-sm font-bold text-ink">{form.alt ? `Samstag ${fmtSamstag(form.alt)} bearbeiten` : 'Samstag anlegen'}</p>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Datum (Samstag)</label>
              <input type="date" value={form.datum} onChange={e => setForm({ ...form, datum: e.target.value })} className="input-field text-sm w-44" />
              {form.datum && !istSamstag(form.datum) && <p className="text-[11px] text-blush-ink">Dieses Datum ist kein Samstag.</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Notiz <span className="normal-case font-normal">(optional)</span></label>
              <input value={form.notiz} onChange={e => setForm({ ...form, notiz: e.target.value })} maxLength={300} placeholder="z. B. 8.00 bis 12.00 Uhr" className="input-field text-sm w-full" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {ROLLEN.map(r => (
                <div key={r} className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Bedarf {ROLLE_LABEL[r]}</label>
                  <input type="number" min={0} max={20} value={form[r]} onChange={e => setForm({ ...form, [r]: e.target.value })} className="input-field text-sm" />
                </div>
              ))}
            </div>
            {formErr && <p className="text-xs text-blush-ink">⚠ {formErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setForm(null)} className="btn-secondary">Abbrechen</button>
              <button onClick={speichernForm} disabled={isPending || !form.datum} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
