'use client'

// Notfalldienste für Admins und Laura: Liste mit Namen, Zeitpunkt der
// Anmeldung, Bedarf, Anlegen, Bearbeiten, Löschen, Personen eintragen.
// Anmeldungen stehen sofort als ND im Arbeitsplan; ND Tage, die direkt im
// Arbeitsplan stehen, erscheinen als Dienst «aus Arbeitsplan».

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ndAnlegen, ndBearbeiten, ndLoeschen, ndAnmelden, ndAbmelden, ndPersonSetzen, ndPersonEntfernen, ndBestaetigen, ndBestaetigungZuruecknehmen,
} from '@/actions/notfalldienste'
import { removeNotfalldienst } from '@/actions/vacations'
import { ND_ROLLEN, ND_ROLLE_LABEL, fmtNdZeitraum, ndRolle, type Notfalldienst, type NdRolle } from '@/lib/notfalldienste'
import type { SamstagPerson } from '@/lib/samstage-data'
import { isoKw } from '@/lib/ferien'

type Form = { alt: string | null; von: string; bis: string; notiz: string; zahnarzt: string; assistenz: string }
const LEER: Form = { alt: null, von: '', bis: '', notiz: '', zahnarzt: '1', assistenz: '1' }
const fmtTs = (iso: string) => iso ? new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) : ''

export default function NotfalldiensteSection({ dienste, meinId, meineRolle, team, heute }: {
  dienste: Notfalldienst[]
  meinId: string
  meineRolle: NdRolle | null
  team: SamstagPerson[]
  heute: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<Form | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [personFuer, setPersonFuer] = useState<string | null>(null)
  const [personId, setPersonId] = useState('')
  const [personRolle, setPersonRolle] = useState<NdRolle | ''>('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [vergangene, setVergangene] = useState(false)

  const sichtbar = dienste.filter(d => vergangene || d.bis >= heute)
  const anzahlVergangen = dienste.filter(d => d.bis < heute).length

  function run(fn: () => Promise<{ error?: string } | { success: true }>, ok?: string) {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      if (ok) setMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }
  function speichern() {
    if (!form) return
    if (!form.von || !form.bis || form.bis < form.von) { setFormErr('Bitte einen gültigen Zeitraum wählen.'); return }
    setFormErr(null)
    const bedarf = { zahnarzt: form.zahnarzt ? Number(form.zahnarzt) : null, assistenz: form.assistenz ? Number(form.assistenz) : null }
    startTransition(async () => {
      const r = form.alt ? await ndBearbeiten(form.alt, { von: form.von, bis: form.bis, notiz: form.notiz, bedarf }) : await ndAnlegen(form.von, form.bis, form.notiz, bedarf)
      if ('error' in r && r.error) { setFormErr(r.error); return }
      setForm(null); setMsg({ type: 'ok', text: form.alt ? 'Notfalldienst angepasst.' : 'Notfalldienst angelegt.' })
      router.refresh()
    })
  }
  const waehlbar = (d: Notfalldienst) => team.filter(p => !d.anmeldungen.some(a => a.profileId === p.id) && ndRolle(p.job_title))
  const vorschlag = team.find(p => p.id === personId)
  const rolleVorschlag = vorschlag ? ndRolle(vorschlag.job_title) : null

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-edge-soft">
        <div>
          <p className="text-sm font-semibold text-ink">Notfalldienste</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">Zahnärztinnen und Assistenz melden sich an, die Anmeldung steht sofort als ND im Arbeitsplan, nie über einem F. Direkt im Arbeitsplan eingetragene ND Tage erscheinen hier als Dienst aus dem Arbeitsplan.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {anzahlVergangen > 0 && <button onClick={() => setVergangene(v => !v)} className="text-[11px] text-ink-4 hover:text-ink-2">{vergangene ? 'Vergangene ausblenden' : `Vergangene anzeigen (${anzahlVergangen})`}</button>}
          <button onClick={() => { setForm({ ...LEER }); setFormErr(null) }} className="btn-primary !px-3.5 !py-2 !text-xs">＋ Notfalldienst</button>
        </div>
      </div>
      {msg && <p className={`mx-6 mt-3 text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}</p>}
      {sichtbar.length === 0 ? <p className="text-sm text-ink-4 py-10 text-center">Noch keine Notfalldienste erfasst.</p> : (
        <ul className="divide-y divide-edge-row">
          {sichtbar.map(d => {
            const vorbei = d.bis < heute
            const meine = d.anmeldungen.find(a => a.profileId === meinId)
            return (
              <li key={d.von} className={`px-6 py-3 ${vorbei ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                  <div className="min-w-[170px]">
                    <p className="text-sm font-semibold text-ink tnum">{fmtNdZeitraum(d.von, d.bis)}</p>
                    <p className="text-[11px] text-ink-4 tnum">KW {isoKw(d.von)}{d.notiz ? ` · ${d.notiz}` : ''}</p>
                    {d.ausArbeitsplan && <span className="inline-block mt-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-edge-row text-ink-3" title="ND Tage direkt im Arbeitsplan, ohne Dienst mit Anmeldung">aus Arbeitsplan</span>}
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 min-w-[240px]">
                    {ND_ROLLEN.map(rolle => {
                      const liste = d.anmeldungen.filter(a => a.rolle === rolle)
                      const soll = d.bedarf[rolle]
                      const best = liste.filter(a => a.status === 'bestaetigt').length
                      return (
                        <div key={rolle}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                            {ND_ROLLE_LABEL[rolle]}
                            {soll != null && <span className={`ml-1.5 normal-case tracking-normal tnum ${best < soll ? 'text-apricot-ink' : 'text-mint-ink'}`}>{best} von {soll} im Arbeitsplan</span>}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {liste.length === 0 && <li className="text-xs text-ink-5">noch niemand</li>}
                            {liste.map(a => (
                              <li key={a.profileId} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                                <span className={`font-semibold ${a.status === 'bestaetigt' ? 'text-mint-ink' : 'text-ink'}`}>{a.name}</span>
                                <span className="text-[10px] text-ink-4 tnum">{a.am ? fmtTs(a.am) : ''}{a.durchAdmin && !a.ausArbeitsplan ? ' · eingetragen' : ''}</span>
                                {a.status === 'bestaetigt' ? (
                                  <>
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-mint-bg text-mint-ink" title="ND steht im Arbeitsplan">Im Arbeitsplan</span>
                                    {!a.ausArbeitsplan && <button onClick={() => run(() => ndBestaetigungZuruecknehmen(d.von, a.profileId), 'ND aus dem Arbeitsplan genommen, die Anmeldung bleibt offen.')} disabled={isPending} className="text-[10.5px] text-ink-4 hover:text-red-500" title="ND Tage aus dem Arbeitsplan nehmen, Anmeldung bleibt">Aus Arbeitsplan nehmen</button>}
                                  </>
                                ) : (
                                  <button onClick={() => run(() => ndBestaetigen(d.von, a.profileId), 'ND steht im Arbeitsplan.')} disabled={isPending} className="px-2 py-0.5 rounded-md bg-dusk hover:bg-dusk-deep text-white text-[10.5px] font-semibold">In Arbeitsplan eintragen</button>
                                )}
                                <button onClick={() => { if (confirm(`${a.name} aus diesem Notfalldienst entfernen? Die ND Tage verschwinden aus dem Arbeitsplan.`)) run(() => (a.ausArbeitsplan ? removeNotfalldienst(a.profileId, d.von, d.bis) : ndPersonEntfernen(d.von, a.profileId)), 'Entfernt.') }} disabled={isPending} className="text-ink-5 hover:text-red-500" title="Entfernen">✕</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap ml-auto">
                    {d.ausArbeitsplan ? (
                      <button onClick={() => run(() => ndAnlegen(d.von, d.bis, '', null), 'Notfalldienst angelegt, Anmeldungen sind jetzt möglich.')} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs" title="Als Notfalldienst mit Bedarf und Anmeldung führen">Als Dienst führen</button>
                    ) : (
                      <>
                        {!vorbei && meineRolle && !meine && <button onClick={() => run(() => ndAnmelden(d.von), 'Eingetragen, ND steht im Arbeitsplan.')} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">Ich kann</button>}
                        {!vorbei && meine && !meine.ausArbeitsplan && d.von >= heute && <button onClick={() => run(() => ndAbmelden(d.von), 'Abgemeldet, die ND Tage sind aus dem Arbeitsplan entfernt.')} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs">Abmelden</button>}
                        <button onClick={() => { setPersonFuer(personFuer === d.von ? null : d.von); setPersonId(''); setPersonRolle('') }} className="text-[11px] font-semibold text-mint-ink hover:underline">+ Person</button>
                        <button onClick={() => { setForm({ alt: d.von, von: d.von, bis: d.bis, notiz: d.notiz, zahnarzt: d.bedarf.zahnarzt?.toString() ?? '', assistenz: d.bedarf.assistenz?.toString() ?? '' }); setFormErr(null) }} className="text-[11px] font-semibold text-ink-3 hover:underline">Bearbeiten</button>
                        <button onClick={() => { if (confirm(`Notfalldienst ${fmtNdZeitraum(d.von, d.bis)} samt Anmeldungen löschen? Die ND Tage verschwinden aus dem Arbeitsplan.`)) run(() => ndLoeschen(d.von), 'Notfalldienst gelöscht.') }} className="text-[11px] text-ink-4 hover:text-red-500">Löschen</button>
                      </>
                    )}
                  </div>
                </div>
                {personFuer === d.von && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 bg-surface/60 rounded-ctl p-2">
                    <select value={personId} onChange={e => { setPersonId(e.target.value); setPersonRolle('') }} className="input-field text-sm w-56">
                      <option value="">Person wählen…</option>
                      {waehlbar(d).map(p => <option key={p.id} value={p.id}>{p.full_name}{p.job_title ? ` (${p.job_title})` : ''}</option>)}
                    </select>
                    <select value={personRolle || rolleVorschlag || ''} onChange={e => setPersonRolle(e.target.value as NdRolle | '')} className="input-field text-sm w-40">
                      <option value="">Rolle…</option>
                      {ND_ROLLEN.map(r => <option key={r} value={r}>{ND_ROLLE_LABEL[r]}</option>)}
                    </select>
                    <button disabled={!personId || isPending} onClick={() => run(() => ndPersonSetzen(d.von, personId, (personRolle || rolleVorschlag) as NdRolle | null), 'Person eingetragen, ND steht im Arbeitsplan.')} className="btn-primary !px-3 !py-1.5 !text-xs">Eintragen</button>
                    <button onClick={() => setPersonFuer(null)} className="btn-secondary !px-3 !py-1.5 !text-xs">Abbrechen</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative bg-white rounded-card border border-edge shadow-xl w-full max-w-md p-5 space-y-3">
            <p className="text-sm font-bold text-ink">{form.alt ? 'Notfalldienst bearbeiten' : 'Notfalldienst anlegen'}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Von</span><input type="date" value={form.von} onChange={e => setForm({ ...form, von: e.target.value, bis: form.bis && form.bis >= e.target.value ? form.bis : e.target.value })} className="input-field text-sm" /></label>
              <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Bis</span><input type="date" value={form.bis} min={form.von || undefined} onChange={e => setForm({ ...form, bis: e.target.value })} className="input-field text-sm" /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Notiz <span className="normal-case font-normal">(optional)</span></span><input value={form.notiz} onChange={e => setForm({ ...form, notiz: e.target.value })} maxLength={300} className="input-field text-sm" /></label>
            <div className="grid grid-cols-2 gap-3">
              {ND_ROLLEN.map(r => (
                <label key={r} className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Bedarf {ND_ROLLE_LABEL[r]}</span><input type="number" min={0} max={20} value={form[r]} onChange={e => setForm({ ...form, [r]: e.target.value })} className="input-field text-sm" /></label>
              ))}
            </div>
            {form.alt && form.von !== form.alt && <p className="text-[11px] text-ink-4">Bei einem neuen Zeitraum bleiben die ND Tage des alten Zeitraums im Arbeitsplan stehen. Bitte die Personen aus dem Arbeitsplan nehmen und neu eintragen.</p>}
            {formErr && <p className="text-xs text-blush-ink">⚠ {formErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setForm(null)} className="btn-secondary">Abbrechen</button>
              <button onClick={speichern} disabled={isPending || !form.von || !form.bis} className="btn-primary">{isPending ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
