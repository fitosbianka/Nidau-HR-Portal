'use client'

// Dialog «Regeln bearbeiten» der Ferienplanung 2027 für Admins und Ferien Editorinnen:
// Plätze ZAZ und DH / PA pro Farbe, Assistenz Grundbedarf und Reserve,
// Gültigkeit und Anrechnungsfaktor pro Person,
// Platzhalter ohne Profil (neue Zahnärztin) und feste Vertretungseinsätze.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { regelnSpeichern, personRegelSpeichern, einsatzSpeichern, einsatzLoeschen } from '@/actions/ferien-wochen'
import { FARBEN, FARBEN_REIHENFOLGE, KATEGORIEN, KATEGORIE_LABEL, istLernende, kategorieFuer, type WochenFarbe } from '@/lib/ferien-wochen'
import { SCHICHT_LABEL, PERSON_LEER, type Regeln, type PersonRegel, type Einsatz, type Platzhalter, type Schicht } from '@/lib/ferien-regeln'
import { tagKurz } from '@/lib/ferien-kapazitaet'

type PersonKurz = { id: string; full_name: string; job_title: string | null; eintrittsdatum?: string | null }
type Abschnitt = 'plaetze' | 'personen' | 'einsaetze'

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr']
const pz = (n: number) => String(Math.round(n * 100))

export default function RegelnDialog({ regeln, personen, personRegeln, einsaetze, onClose }: {
  regeln: Regeln
  personen: PersonKurz[]
  /** Zusammengeführte Regel pro Person (gespeichert oder Standard) */
  personRegeln: Record<string, PersonRegel & { gespeichert?: boolean }>
  einsaetze: Einsatz[]
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Abschnitt>('plaetze')
  const [r, setR] = useState<Regeln>(() => JSON.parse(JSON.stringify(regeln)) as Regeln)
  const [pr, setPr] = useState<Record<string, PersonRegel>>(() => Object.fromEntries(personen.map(p => [p.id, { ...PERSON_LEER, ...(personRegeln[p.id] ?? {}) }])))
  const [geaendert, setGeaendert] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [form, setForm] = useState<{ id: string | null; altesDatum: string | null; datum: string; name: string; von: string; bis: string; assistenz: boolean }>({ id: null, altesDatum: null, datum: '', name: '', von: '13:00', bis: '17:00', assistenz: true })

  const lernende = personen.filter(p => istLernende(p.job_title))
  const planbar = personen.filter(p => kategorieFuer(p.job_title) !== null)

  const setZahl = (gruppe: 'plaetzeZaz' | 'plaetzeDhpa', f: WochenFarbe, v: string) => setR({ ...r, [gruppe]: { ...r[gruppe], [f]: Math.max(0, Math.min(20, parseInt(v, 10) || 0)) } })
  const setPerson = (id: string, teil: Partial<PersonRegel>) => { setPr({ ...pr, [id]: { ...pr[id], ...teil } }); setGeaendert(new Set(geaendert).add(id)) }
  const setPh = (i: number, teil: Partial<Platzhalter>) => setR({ ...r, platzhalter: r.platzhalter.map((p, j) => (j === i ? { ...p, ...teil } : p)) })

  function speichern() {
    setMsg(null)
    startTransition(async () => {
      const a = await regelnSpeichern(r)
      if ('error' in a && a.error) { setMsg({ type: 'err', text: a.error }); return }
      for (const id of Array.from(geaendert)) {
        const b = await personRegelSpeichern(id, pr[id])
        if ('error' in b && b.error) { setMsg({ type: 'err', text: `${personen.find(p => p.id === id)?.full_name ?? ''}: ${b.error}` }); return }
      }
      router.refresh(); onClose()
    })
  }
  function personStandard(id: string) {
    startTransition(async () => {
      const b = await personRegelSpeichern(id, null)
      if ('error' in b && b.error) { setMsg({ type: 'err', text: b.error }); return }
      setMsg({ type: 'ok', text: 'Zurück zum Standard. Die Werte erscheinen nach dem Schliessen aktualisiert.' })
      setGeaendert(s => { const n = new Set(s); n.delete(id); return n })
      router.refresh()
    })
  }
  function einsatzSichern() {
    setMsg(null)
    startTransition(async () => {
      const a = await einsatzSpeichern({ id: form.id, datum: form.datum, name: form.name, von: form.von, bis: form.bis, assistenz: form.assistenz }, form.altesDatum)
      if ('error' in a && a.error) { setMsg({ type: 'err', text: a.error }); return }
      setForm({ id: null, altesDatum: null, datum: '', name: form.name, von: form.von, bis: form.bis, assistenz: form.assistenz })
      setMsg({ type: 'ok', text: 'Einsatz gespeichert.' }); router.refresh()
    })
  }
  function einsatzEntfernen(e: Einsatz) {
    if (!confirm(`Einsatz ${e.name} am ${tagKurz(e.datum)} löschen?`)) return
    startTransition(async () => {
      const a = await einsatzLoeschen(e.datum, e.id)
      if ('error' in a && a.error) { setMsg({ type: 'err', text: a.error }); return }
      router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-3xl rounded-t-card sm:rounded-card border border-edge shadow-xl flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-edge-soft bg-surface rounded-t-card">
          <p className="text-sm font-bold text-ink">Regeln der Ferienplanung 2027</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">Ziel: Patienten und Agenda optimal betreuen, jeden Öffnungstag genug und nie zu viel Personal. Alle Werte sind Standardwerte und hier änderbar.</p>
          <div className="mt-3 inline-flex flex-wrap gap-1 bg-edge-row rounded-tile p-1">
            {([['plaetze', 'Plätze und Assistenz'], ['personen', 'Personen'], ['einsaetze', `Feste Einsätze (${einsaetze.length})`]] as Array<[Abschnitt, string]>).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === k ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-6 text-[13px]">
          {msg && <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}</p>}

          {tab === 'plaetze' && (
            <>
              <section>
                <p className="eyebrow mb-2">Plätze pro Woche (Personen gleichzeitig abwesend)</p>
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 border-b-[1.5px] border-edge-ctl">
                      <th className="text-left py-1.5">Farbe</th><th className="py-1.5 text-center">ZAZ</th><th className="py-1.5 text-center">DH / PA</th><th className="py-1.5 text-center">Assistenz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FARBEN_REIHENFOLGE.map(f => (
                      <tr key={f} className="border-b border-edge-row">
                        <td className="py-1.5"><span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full border" style={{ background: FARBEN[f].bg, borderColor: FARBEN[f].fg }} />{FARBEN[f].label}</span></td>
                        {(['plaetzeZaz', 'plaetzeDhpa'] as const).map(g => (
                          <td key={g} className="py-1.5 text-center">
                            <input type="number" min={0} max={20} value={r[g][f]} disabled={f === 'rot'} onChange={e => setZahl(g, f, e.target.value)} className="input-field !w-16 text-center text-sm mx-auto disabled:opacity-50" />
                          </td>
                        ))}
                        <td className="py-1.5 text-center text-[11px] text-ink-4">{f === 'rot' ? 'gesperrt, offen bei ZAZ Ferien' : 'nach Kapazität'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-ink-4 mt-2">Die Assistenz hat keine festen Plätze. Das Portal rechnet pro Woche in Tagen: Angebot aus den Praxistagen minus Bedarf (ZAZ am Stuhl plus Grundbedarf) minus Abwesenheiten minus Reserve. Rote Wochen sind für die Assistenz nur an Tagen offen, an denen eine ZAZ fest in den Ferien ist (F im Arbeitsplan oder akzeptiert, ohne Vertretung), pro fehlende ZAZ eine Person.</p>
              </section>

              <section>
                <p className="eyebrow mb-2">Assistenz Grundbedarf pro Tag und Reserve pro Woche</p>
                <div className="flex flex-wrap gap-3">
                  {([['steri', 'Steri'], ['empfang', 'Empfang'], ['tagesleitung', 'Tagesleitung'], ['spaetSteri', 'Spät Steri (an Tagen mit Spätschicht)']] as Array<[keyof Regeln['grundbedarf'], string]>).map(([k, l]) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{l}</span>
                      <input type="number" min={0} max={10} step={0.5} value={r.grundbedarf[k]} onChange={e => setR({ ...r, grundbedarf: { ...r.grundbedarf, [k]: Math.max(0, parseFloat(e.target.value) || 0) } })} className="input-field !w-24 text-center text-sm" />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Reserve (Tage pro Woche)</span>
                    <input type="number" min={0} max={50} step={0.5} value={r.reserve} onChange={e => setR({ ...r, reserve: Math.max(0, parseFloat(e.target.value) || 0) })} className="input-field !w-24 text-center text-sm" />
                  </label>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="eyebrow !mb-0">Platzhalter ohne Profil</p>
                    <p className="text-[11px] text-ink-4 mt-1">Zum Beispiel eine neue Zahnärztin, die ab einem bestimmten Monat dazukommt. Zählt für die Kapazität wie eine Person mit dieser Standardwoche. Sobald es ein echtes Profil mit Standardwoche gibt, den Platzhalter entfernen.</p>
                  </div>
                  <button onClick={() => setR({ ...r, platzhalter: [...r.platzhalter, { id: `ph-${Date.now().toString(36)}`, name: '', kategorie: 'ZAZ', ab: null, bis: null, tage: [], schicht: '', raum: null }] })} className="btn-secondary !px-3 !py-1.5 !text-xs flex-shrink-0">＋ Platzhalter</button>
                </div>
                {r.platzhalter.length === 0 && <p className="text-[12px] text-ink-4">Kein Platzhalter.</p>}
                <div className="space-y-2">
                  {r.platzhalter.map((p, i) => (
                    <div key={p.id} className="rounded-xl border border-edge-soft bg-surface p-3 flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Name</span>
                        <input type="text" value={p.name} onChange={e => setPh(i, { name: e.target.value })} className="input-field text-sm w-44" /></label>
                      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Kategorie</span>
                        <select value={p.kategorie} onChange={e => setPh(i, { kategorie: e.target.value as Platzhalter['kategorie'] })} className="input-field text-sm !w-auto">{KATEGORIEN.map(k => <option key={k} value={k}>{KATEGORIE_LABEL[k]}</option>)}</select></label>
                      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Ab</span>
                        <input type="date" value={p.ab ?? ''} onChange={e => setPh(i, { ab: e.target.value || null })} className="input-field text-sm w-36" /></label>
                      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Bis</span>
                        <input type="date" value={p.bis ?? ''} onChange={e => setPh(i, { bis: e.target.value || null })} className="input-field text-sm w-36" /></label>
                      <div className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Arbeitstage</span>
                        <div className="flex gap-1">{WOCHENTAGE_KURZ.map((l, j) => { const t = j + 1; const an = p.tage.includes(t); return <button key={t} type="button" onClick={() => setPh(i, { tage: an ? p.tage.filter(x => x !== t) : [...p.tage, t].sort() })} className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${an ? 'bg-dusk text-white border-dusk' : 'bg-white text-ink-2 border-edge-ctl'}`}>{l}</button> })}</div></div>
                      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Schicht</span>
                        <select value={p.schicht} onChange={e => setPh(i, { schicht: e.target.value as Schicht })} className="input-field text-sm !w-auto">{(Object.keys(SCHICHT_LABEL) as Schicht[]).map(s => <option key={s} value={s}>{SCHICHT_LABEL[s]}</option>)}</select></label>
                      <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Raum</span>
                        <select value={p.raum ?? ''} onChange={e => setPh(i, { raum: e.target.value ? parseInt(e.target.value, 10) : null })} className="input-field text-sm !w-auto"><option value="">offen</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                      <button onClick={() => setR({ ...r, platzhalter: r.platzhalter.filter((_, j) => j !== i) })} className="text-xs text-ink-4 hover:text-red-500 ml-auto">Entfernen</button>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === 'personen' && (
            <>
              <section>
                <p className="eyebrow mb-1">Gültigkeit pro Person</p>
                <p className="text-[11px] text-ink-4 mb-2">Für die Kapazität zählt eine Person nur zwischen Ab und Bis. Leer heisst ohne Grenze. Standard ist das Eintrittsdatum aus dem Profil.</p>
                <div className="divide-y divide-edge-row">
                  {planbar.map(p => {
                    const x = pr[p.id]
                    return (
                      <div key={p.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold min-w-[170px] flex-1 truncate">{p.full_name} <span className="font-normal text-ink-4 text-[11px]">{p.job_title}</span></span>
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">Ab <input type="date" value={x.ab ?? ''} onChange={e => setPerson(p.id, { ab: e.target.value || null })} className="input-field !py-1 text-[12px] w-36" /></label>
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">Bis <input type="date" value={x.bis ?? ''} onChange={e => setPerson(p.id, { bis: e.target.value || null })} className="input-field !py-1 text-[12px] w-36" /></label>
                        {personRegeln[p.id]?.gespeichert && <button onClick={() => personStandard(p.id)} disabled={isPending} className="text-[10.5px] text-ink-4 hover:text-ink-2 underline">Standard</button>}
                      </div>
                    )
                  })}
                </div>
              </section>
              <section>
                <p className="eyebrow mb-1">Anrechnungsfaktor der Lernenden</p>
                <p className="text-[11px] text-ink-4 mb-2">Praxistage zählen mit diesem Faktor, zum Beispiel 50 % im ersten Lehrjahr und danach 100 %. Schultage zählen nicht.</p>
                {lernende.length === 0 && <p className="text-[12px] text-ink-4">Keine Lernenden.</p>}
                <div className="divide-y divide-edge-row">
                  {lernende.map(p => {
                    const x = pr[p.id]
                    return (
                      <div key={p.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold min-w-[170px] flex-1 truncate">{p.full_name}</span>
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">Faktor <input type="number" min={0} max={100} step={5} value={x.faktor == null ? 100 : pz(x.faktor)} onChange={e => setPerson(p.id, { faktor: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) / 100 })} className="input-field !py-1 text-[12px] !w-20 text-center" /> %</label>
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">bis <input type="date" value={x.faktorBis ?? ''} onChange={e => setPerson(p.id, { faktorBis: e.target.value || null })} className="input-field !py-1 text-[12px] w-36" /></label>
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">danach <input type="number" min={0} max={100} step={5} value={x.faktorDanach == null ? 100 : pz(x.faktorDanach)} onChange={e => setPerson(p.id, { faktorDanach: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) / 100 })} className="input-field !py-1 text-[12px] !w-20 text-center" /> %</label>
                      </div>
                    )
                  })}
                </div>
              </section>
            </>
          )}

          {tab === 'einsaetze' && (
            <section className="space-y-4">
              <div>
                <p className="eyebrow mb-1">Feste Vertretungseinsätze mit Uhrzeit</p>
                <p className="text-[11px] text-ink-4">Ein Einsatz von 13 bis 17 Uhr zählt als halber Tag. Mit Assistenz erhöht er den Assistenz Bedarf um 0.5 pro Halbtag. Ist für den Halbtag kein Behandlungszimmer frei, erscheint eine Warnung bei der Woche. Halbtägige Einsätze decken eine Abwesenheit nicht vollständig ab.</p>
              </div>
              <div className="rounded-xl border border-edge-soft bg-surface p-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Name</span>
                  <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field text-sm w-44" /></label>
                <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Datum</span>
                  <input type="date" value={form.datum} min="2027-01-01" max="2027-12-31" onChange={e => setForm({ ...form, datum: e.target.value })} className="input-field text-sm w-40" /></label>
                <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Von</span>
                  <input type="time" value={form.von} onChange={e => setForm({ ...form, von: e.target.value })} className="input-field text-sm w-28" /></label>
                <label className="flex flex-col gap-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Bis</span>
                  <input type="time" value={form.bis} onChange={e => setForm({ ...form, bis: e.target.value })} className="input-field text-sm w-28" /></label>
                <label className="flex items-center gap-2 pb-2 text-[12px]"><input type="checkbox" checked={form.assistenz} onChange={e => setForm({ ...form, assistenz: e.target.checked })} className="w-4 h-4" /> Assistenz nötig</label>
                <button onClick={einsatzSichern} disabled={isPending || !form.datum || !form.name.trim()} className="btn-primary !px-3 !py-2 !text-xs">{form.id ? 'Änderung speichern' : 'Einsatz anlegen'}</button>
                {form.id && <button onClick={() => setForm({ id: null, altesDatum: null, datum: '', name: '', von: '13:00', bis: '17:00', assistenz: true })} className="text-xs text-ink-4 hover:text-ink-2">Abbrechen</button>}
              </div>
              {einsaetze.length === 0 ? <p className="text-[12px] text-ink-4">Noch keine Einsätze.</p> : (
                <ul className="divide-y divide-edge-row">
                  {einsaetze.map(e => (
                    <li key={`${e.datum}-${e.id}`} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 tnum">
                      <span className="text-[11px] text-ink-3 w-24">{tagKurz(e.datum)}</span>
                      <span className="font-semibold flex-1">{e.name}</span>
                      <span className="text-ink-2">{e.von.replace(':', '.')} bis {e.bis.replace(':', '.')} Uhr</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${e.assistenz ? 'bg-apricot-bg text-apricot-ink' : 'bg-edge-row text-ink-3'}`}>{e.assistenz ? 'mit Assistenz' : 'ohne Assistenz'}</span>
                      <button onClick={() => setForm({ id: e.id, altesDatum: e.datum, datum: e.datum, name: e.name, von: e.von, bis: e.bis, assistenz: e.assistenz })} className="text-[11px] text-ink-3 hover:text-ink">Ändern</button>
                      <button onClick={() => einsatzEntfernen(e)} disabled={isPending} className="text-[11px] text-ink-4 hover:text-red-500">Löschen</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-edge-soft bg-surface flex items-center justify-between gap-2 rounded-b-card">
          <p className="text-[11px] text-ink-4">{tab === 'einsaetze' ? 'Einsätze werden sofort gespeichert.' : geaendert.size > 0 ? `${geaendert.size} Personenregel${geaendert.size === 1 ? '' : 'n'} geändert.` : 'Änderungen gelten ab dem Speichern für alle Prüfungen.'}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Schliessen</button>
            {tab !== 'einsaetze' && <button onClick={speichern} disabled={isPending} className="btn-primary">{isPending ? 'Speichert…' : 'Regeln speichern'}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
