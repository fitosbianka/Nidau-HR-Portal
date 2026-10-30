'use client'

// Persönliche Checkliste einer Teilnehmerin / eines Teilnehmers. Die
// Komponente erhält NUR die eigenen Daten dieser Person. Haken werden
// gespeichert und bleiben nach Abmelden erhalten; Punkte mit Feld haken
// sich automatisch ab, sobald das Feld ausgefüllt ist. Punkte mit
// Eingabeschluss sind danach für das Team gesperrt (Organisatorin nicht).

import { useRef, useState } from 'react'
import { useSerial } from './useSerial'
import Link from 'next/link'
import { checkSpeichern, type CheckPatch } from '@/actions/teamevent-programm'
import { itemErledigt, manuellAbhakbar, fortschritt, fristAbgelaufen, type CheckItem, type TeCheck, type Einstieg, type InfoBlock } from '@/lib/teamevent-programm'
import { AUSWEIS_ART_LABEL, ausweisStatus } from '@/lib/ausweise'
import { datumKurz } from '@/lib/teamevents'
import type { AusweisMitBildern } from '@/lib/ausweise-data'
import { Zeile } from './InfoBloecke'
import AusweisClient, { AusweisStatusBadge } from './AusweisClient'

export function Fortschritt({ erledigt, total, label }: { erledigt: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.round((erledigt / total) * 100) : 0
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex-1 h-2 rounded-full bg-edge-row overflow-hidden min-w-[80px]">
        <div className="h-full rounded-full bg-mint-mid transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-ink-2 tnum whitespace-nowrap">{label ?? `${erledigt} von ${total} erledigt`}</span>
    </div>
  )
}

export default function MeineCheckliste({ slug, profileId, personName, check: initial, ausweis: ausweisInitial, fotos, checkliste, einstieg, bloecke, heute, jetzt, verwaltet, fotosHref }: {
  slug: string
  profileId: string
  personName: string
  check: TeCheck
  ausweis: AusweisMitBildern
  fotos: number
  checkliste: CheckItem[]
  einstieg: Record<Einstieg, string>
  bloecke: Array<InfoBlock & { angepasst: boolean }>
  heute: string
  jetzt: string
  verwaltet: boolean
  fotosHref: string
}) {
  const [check, setCheck] = useState<TeCheck>(initial)
  const bestaetigt = useRef<TeCheck>(initial) // letzter vom Server bestätigter Stand
  const [ausweis, setAusweis] = useState(ausweisInitial)
  const ausweisKomplett = !!(ausweis.art && ausweis.nummer && ausweis.ablauf)
  const [offen, setOffen] = useState<Set<string>>(() => {
    const k = { ausweisKomplett: !!(ausweisInitial.art && ausweisInitial.nummer && ausweisInitial.ablauf), fotos }
    return new Set(checkliste.filter(i => !manuellAbhakbar(i) && !itemErledigt(i, initial, k)).map(i => i.id))
  })
  const [allergienText, setAllergienText] = useState(initial.allergien ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const nacheinander = useSerial()
  const letzteTicks = useRef<Record<string, boolean>>(initial.ticks)
  const geplant = useRef(false)

  /** Haken sofort anzeigen, Speichern gebündelt und nacheinander — kein
   *  Sperren der übrigen Punkte, keine verlorenen Klicks. */
  function hakeAb(id: string, wert: boolean) {
    setErr(null)
    const next = { ...letzteTicks.current, [id]: wert }
    letzteTicks.current = next
    setCheck(c => ({ ...c, ticks: next }))
    if (geplant.current) return
    geplant.current = true
    void nacheinander(async () => {
      geplant.current = false
      const r = await checkSpeichern(slug, profileId, { ticks: letzteTicks.current })
      if ('error' in r && r.error) {
        setErr(r.error)
        letzteTicks.current = bestaetigt.current.ticks
        setCheck(c => ({ ...c, ticks: bestaetigt.current.ticks }))
        return
      }
      if ('check' in r && r.check) bestaetigt.current = r.check
    })
  }

  const kontext = { ausweisKomplett, fotos }
  const f = fortschritt(checkliste, check, kontext)
  const toggleOffen = (id: string) => setOffen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  /** Eingabe für das Team geschlossen (Organisatorin darf weiterhin). */
  const gesperrt = (item: CheckItem) => !verwaltet && fristAbgelaufen(item.fristBis, jetzt)

  async function speichern(patch: CheckPatch, optimistisch?: (c: TeCheck) => TeCheck) {
    setErr(null)
    if (optimistisch) setCheck(optimistisch)
    setBusy(JSON.stringify(patch).slice(0, 40))
    try {
      const r = await checkSpeichern(slug, profileId, patch)
      if ('error' in r && r.error) { setErr(r.error); setCheck(c => ({ ...bestaetigt.current, ticks: c.ticks })); return }
      if ('check' in r && r.check) { bestaetigt.current = r.check; setCheck(c => ({ ...r.check, ticks: c.ticks })) }
    } finally { setBusy(null) }
  }

  const fristText = (item: CheckItem): string | null => {
    if (item.frist) return item.frist
    if (item.fristBlock) return bloecke.find(x => x.id === item.fristBlock)?.zeilen[0] ?? null
    return null
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink">Persönliche Checkliste</h2>
        <div className="w-full sm:w-72"><Fortschritt erledigt={f.erledigt} total={f.total} /></div>
      </div>
      {err && <p className="text-xs px-3 py-2 rounded-ctl inline-block bg-blush-bg text-blush-ink">⚠ {err}</p>}

      <ol className="space-y-2">
        {checkliste.map((item, idx) => {
          const erledigt = itemErledigt(item, check, kontext)
          const manuell = manuellAbhakbar(item)
          const auf = offen.has(item.id)
          const frist = fristText(item)
          const zu = gesperrt(item)
          return (
            <li key={item.id} className={`card overflow-hidden ${erledigt ? 'border-mint-bg' : ''}`}>
              <div className="flex items-start gap-3 px-4 py-3">
                <button
                  onClick={() => manuell ? hakeAb(item.id, !erledigt) : toggleOffen(item.id)}
                  aria-pressed={erledigt}
                  title={manuell ? (erledigt ? 'Haken entfernen' : 'Als erledigt abhaken') : 'Wird automatisch abgehakt, sobald das Feld ausgefüllt ist'}
                  className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${erledigt ? 'bg-mint-mid border-mint-mid text-white' : 'border-edge-ctl bg-white text-transparent hover:border-mint-mid'}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" /></svg>
                </button>
                <button onClick={() => toggleOffen(item.id)} className="flex-1 min-w-0 text-left">
                  <p className={`text-sm font-semibold ${erledigt ? 'text-ink-3 line-through decoration-ink-5' : 'text-ink'}`}>
                    <span className="text-ink-4 tnum mr-1.5">{idx + 1}.</span>{item.titel}
                  </p>
                  {(item.text || frist) && (
                    <p className="text-[12px] text-ink-4 mt-0.5 leading-snug">
                      {item.text && <span>{item.text}</span>}
                      {item.text && frist && <span> · </span>}
                      {frist && (zu
                        ? <span className="text-blush-ink font-semibold">Eingabe geschlossen</span>
                        : <span className="text-apricot-ink font-semibold"><Zeile text={frist} verwaltet={verwaltet} /></span>)}
                    </p>
                  )}
                </button>
                <svg className={`w-4 h-4 mt-1 text-ink-4 flex-shrink-0 transition-transform ${auf ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
              </div>

              {auf && (
                <div className="px-4 pb-4 pt-1 border-t border-edge-soft">
                  {item.art === 'ausweis' && (zu ? (
                    <div className="pt-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <AusweisStatusBadge status={ausweisStatus(ausweis, heute)} />
                        {ausweis.art && ausweis.nummer
                          ? <span className="text-sm text-ink tnum">{AUSWEIS_ART_LABEL[ausweis.art]} {ausweis.nummer}{ausweis.ablauf ? `, gültig bis ${datumKurz(ausweis.ablauf)}` : ''}</span>
                          : <span className="text-sm text-ink-4">Nicht erfasst</span>}
                      </div>
                      {item.geschlossenText && <p className="text-[12px] text-blush-ink">{item.geschlossenText}</p>}
                    </div>
                  ) : (
                    <div className="pt-3 space-y-2">
                      {verwaltet && fristAbgelaufen(item.fristBis, jetzt) && (
                        <p className="text-[11px] text-apricot-ink">Für das Team geschlossen, als Organisatorin weiterhin bearbeitbar.</p>
                      )}
                      <AusweisClient profileId={profileId} initial={ausweis} heute={heute} personName={personName} eigene
                        onGeaendert={a => setAusweis(a)} />
                    </div>
                  ))}
                  {item.art === 'einstieg' && (
                    <div className="pt-3 flex flex-col sm:flex-row gap-2">
                      {(Object.keys(einstieg) as Einstieg[]).map(k => (
                        <button key={k} disabled={busy !== null}
                          onClick={() => speichern({ einstieg: k }, c => ({ ...c, einstieg: k }))}
                          className={`flex-1 px-4 py-3 rounded-ctl border text-sm text-left ${check.einstieg === k ? 'border-mint-mid bg-mint-bg text-mint-ink font-semibold' : 'border-edge-ctl text-ink-2 hover:bg-surface'}`}>
                          {check.einstieg === k ? '✓ ' : ''}{einstieg[k]}
                        </button>
                      ))}
                    </div>
                  )}
                  {item.art === 'allergien' && (zu ? (
                    <div className="pt-3 space-y-2">
                      <p className="text-sm text-ink">
                        {check.keineAllergien ? 'Gemeldet, keine Allergien' : check.allergien ? `Gemeldet, ${check.allergien}` : <span className="text-ink-4">Nichts gemeldet</span>}
                      </p>
                      {item.geschlossenText && <p className="text-[12px] text-blush-ink">{item.geschlossenText}</p>}
                    </div>
                  ) : (
                    <div className="pt-3 space-y-2">
                      {verwaltet && fristAbgelaufen(item.fristBis, jetzt) && (
                        <p className="text-[11px] text-apricot-ink">Für das Team geschlossen, als Organisatorin weiterhin bearbeitbar.</p>
                      )}
                      <textarea value={allergienText} onChange={e => setAllergienText(e.target.value)} rows={2} maxLength={500}
                        disabled={check.keineAllergien}
                        placeholder="z. B. Nussallergie, laktosefrei, vegetarisch" className="input-field text-sm w-full disabled:opacity-50" />
                      <div className="flex flex-wrap items-center gap-3">
                        <button onClick={() => speichern({ allergien: allergienText }, c => ({ ...c, allergien: allergienText.trim() || null, keineAllergien: allergienText.trim() ? false : c.keineAllergien }))}
                          disabled={busy !== null || check.keineAllergien || allergienText.trim() === (check.allergien ?? '')} className="btn-primary text-xs">
                          Speichern
                        </button>
                        <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                          <input type="checkbox" className="accent-mint-mid w-4 h-4" checked={check.keineAllergien} disabled={busy !== null}
                            onChange={e => { const v = e.target.checked; if (v) setAllergienText(''); speichern({ keineAllergien: v }, c => ({ ...c, keineAllergien: v, allergien: v ? null : c.allergien })) }} />
                          Keine Allergien
                        </label>
                        {check.allergien && <span className="text-[11px] text-mint-ink">Gespeichert</span>}
                      </div>
                      <p className="text-[11px] text-ink-4">Diese Angabe sehen nur die Person selbst und Bianka. Sie geht ans Restaurant, nicht ans Team.</p>
                    </div>
                  ))}
                  {item.art === 'packliste' && (
                    <ul className="pt-3 space-y-1.5">
                      {(bloecke.find(b => b.id === item.packlisteBlock)?.zeilen ?? []).map((z, i) => (
                        <li key={i} className="flex gap-2.5 text-[13px] text-ink-2 leading-snug">
                          <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-mint-mid flex-shrink-0" />
                          <span><Zeile text={z} verwaltet={verwaltet} /></span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.art === 'fotos' && (
                    <div className="pt-3 flex flex-wrap items-center gap-3">
                      <Link href={fotosHref} className="btn-primary text-xs">Zum Ordner Fotos</Link>
                      <span className="text-[11px] text-ink-4 tnum">{fotos > 0 ? `${fotos} eigene${fotos === 1 ? 's' : ''} Foto${fotos !== 1 ? 's' : ''} hochgeladen` : 'Noch keine eigenen Fotos hochgeladen'}</span>
                    </div>
                  )}
                  {item.art === 'manuell' && (
                    <p className="pt-3 text-[12px] text-ink-4">Punkt abhaken, sobald er erledigt ist.</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
