'use client'

// Verwaltung des Fotobingos (nur Organisatorin): Schalter (Freigabe,
// Fotoalbum, Testmodus), Zeiten, Teams und Testdaten löschen.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { bingoEinstellungenSetzen, bingoTeamsSpeichern, bingoTestdatenLoeschen, type EinstellungenPatch } from '@/actions/teamevent-bingo'
import { isoZuLokal, type BingoEinstellungen } from '@/lib/teamevent-bingo'
import type { TeamAnsicht } from '@/lib/teamevent-bingo-data'
import type { TeamPerson } from '@/lib/teamevents-data'
import { rufname } from '@/lib/teamevent-europapark'
import { zipHerunterladen } from './zip'

function Schalter({ an, label, text, onChange, disabled }: { an: boolean; label: string; text: string; onChange: () => void; disabled: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-edge-soft last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        <p className="text-[11.5px] text-ink-4 mt-0.5">{text}</p>
      </div>
      <button type="button" role="switch" aria-checked={an} onClick={onChange} disabled={disabled}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${an ? 'bg-mint-ink' : 'bg-edge-ctl'} disabled:opacity-60`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${an ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

type TeamEdit = { id: string; mitglieder: string[]; offen: string[]; ausserKonkurrenz: boolean }

export default function BingoVerwaltung({ slug, einstellungen, teams, personen, testfotos }: {
  slug: string
  einstellungen: BingoEinstellungen
  teams: TeamAnsicht[]
  personen: TeamPerson[]
  testfotos: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [offen, setOffen] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const e = einstellungen
  const [zeiten, setZeiten] = useState({
    start: isoZuLokal(e.start), ende: isoZuLokal(e.ende), sichtbarAb: isoZuLokal(e.sichtbarAb),
  })
  const [teamsEdit, setTeamsEdit] = useState<TeamEdit[] | null>(null)
  const [zipStatus, setZipStatus] = useState<string | null>(null)

  async function zip() {
    setMsg(null); setZipStatus('Startet')
    const r = await zipHerunterladen(slug, `${slug}_Fotos.zip`, setZipStatus)
    setZipStatus(null)
    setMsg(r.ok ? { type: 'ok', text: `${r.anzahl} Fotos als ZIP heruntergeladen.` } : { type: 'err', text: r.fehler })
  }
  const nameById = new Map(personen.map(p => [p.id, p.full_name]))

  function setze(patch: EinstellungenPatch, ok: string) {
    setMsg(null)
    startTransition(async () => {
      const r = await bingoEinstellungenSetzen(slug, patch)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }

  function teamsSpeichern() {
    if (!teamsEdit) return
    setMsg(null)
    startTransition(async () => {
      const r = await bingoTeamsSpeichern(slug, teamsEdit)
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setTeamsEdit(null)
      setMsg({ type: 'ok', text: 'Teams gespeichert.' })
      router.refresh()
    })
  }

  function testdatenLoeschen() {
    const b = prompt(`Alle ${testfotos} Testfotos und die Entscheide der Testphase löschen? Zum Bestätigen «löschen» eingeben.`)
    if (b === null) return
    setMsg(null)
    startTransition(async () => {
      const r = await bingoTestdatenLoeschen(slug, b.trim())
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      setMsg({ type: 'ok', text: `${(r as { geloescht: number }).geloescht} Testfotos gelöscht.` })
      router.refresh()
    })
  }

  const vergeben = new Set((teamsEdit ?? []).flatMap(t => t.mitglieder))
  const frei = personen.filter(p => !vergeben.has(p.id))

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOffen(o => !o)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-ink">Verwaltung</p>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${e.veroeffentlicht ? 'bg-mint-bg text-mint-ink' : 'bg-edge-row text-ink-3'}`}>Bingo {e.veroeffentlicht ? 'veröffentlicht' : 'nicht veröffentlicht'}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${e.albumGesperrt ? 'bg-blush-bg text-blush-ink' : 'bg-mint-bg text-mint-ink'}`}>Fotoalbum {e.albumGesperrt ? 'gesperrt' : 'offen'}</span>
          {e.testmodus && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">Testmodus</span>}
        </div>
        <svg className={`w-4 h-4 text-ink-4 transition-transform ${offen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {offen && (
        <div className="px-5 pb-5 space-y-5 border-t border-edge-soft">
          <div className="pt-2">
            <Schalter an={e.veroeffentlicht} label="Bingo für Mitarbeitende veröffentlichen" text="Solange dieser Schalter aus ist, ist der Ordner Spiele für alle Mitarbeitenden unsichtbar, auch für die Jury, und der Server lehnt ihre Anfragen ab. Nur Admins sehen ihn als Vorschau. Es gibt keine automatische Veröffentlichung, auch nicht zum Bingo Start." disabled={isPending} onChange={() => setze({ veroeffentlicht: !e.veroeffentlicht }, e.veroeffentlicht ? 'Bingo für Mitarbeitende zurückgezogen.' : 'Bingo für alle Mitarbeitenden veröffentlicht.')} />
            <Schalter an={e.albumGesperrt} label="Fotoalbum für Mitarbeitende sperren" text="Das Fotoalbum im Ordner Europapark ist für alle Mitarbeitenden offen, jederzeit hochladen, anschauen und herunterladen. Nur wenn dieser Schalter an ist, sehen es ausser den Admins niemand." disabled={isPending} onChange={() => setze({ albumGesperrt: !e.albumGesperrt }, e.albumGesperrt ? 'Fotoalbum wieder offen.' : 'Fotoalbum für Mitarbeitende gesperrt.')} />
            <Schalter an={e.testmodus} label="Testmodus" text="Admins und Jury können ausserhalb des Zeitfensters und auf jede Karte laden. Jedes Testfoto ist markiert und lässt sich unten gesammelt löschen." disabled={isPending} onChange={() => setze({ testmodus: !e.testmodus }, e.testmodus ? 'Testmodus aus.' : 'Testmodus an.')} />
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2">Zeiten (Schweizer Zeit)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([['start', 'Bingo Start'], ['ende', 'Bingo Ende'], ['sichtbarAb', 'Alle Karten sichtbar ab']] as Array<[keyof typeof zeiten, string]>).map(([k, l]) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{l}</span>
                  <input type="datetime-local" value={zeiten[k]} onChange={ev => setZeiten({ ...zeiten, [k]: ev.target.value })} className="input-field text-sm" />
                </label>
              ))}
            </div>
            <button onClick={() => setze({ start: zeiten.start, ende: zeiten.ende, sichtbarAb: zeiten.sichtbarAb }, 'Zeiten gespeichert.')}
              disabled={isPending} className="btn-primary !px-3.5 !py-2 !text-xs mt-3">Zeiten speichern</button>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">Teams</p>
              {!teamsEdit && <button onClick={() => setTeamsEdit(teams.map(t => ({ id: t.id, mitglieder: [...t.mitglieder], offen: [...t.offen], ausserKonkurrenz: t.ausserKonkurrenz })))} className="text-[11px] font-semibold text-mint-ink hover:underline">Teams bearbeiten</button>}
            </div>
            {!teamsEdit ? (
              <div className="flex flex-wrap gap-1.5">
                {teams.map(t => (
                  <span key={t.id} className={`text-[12px] px-2.5 py-1 rounded-full border ${t.ausserKonkurrenz ? 'border-lilac-bg bg-lilac-soft text-lilac-ink' : 'border-edge-ctl bg-surface text-ink-2'}`}>
                    {t.name}{t.ausserKonkurrenz ? ' (Jury)' : ''}{t.offen.length > 0 ? ' · ohne Konto' : ''}
                  </span>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {teamsEdit.map((t, i) => (
                  <div key={t.id} className="rounded-xl border border-edge-ctl bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-bold text-ink-4 tnum mr-1">Team {i + 1}</span>
                      {t.mitglieder.map(id => (
                        <span key={id} className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-white border border-edge-ctl">
                          {rufname(nameById.get(id) ?? '?')}
                          <button onClick={() => setTeamsEdit(ts => ts!.map(x => (x.id === t.id ? { ...x, mitglieder: x.mitglieder.filter(m => m !== id) } : x)))} className="text-ink-4 hover:text-red-500" aria-label="Entfernen">✕</button>
                        </span>
                      ))}
                      {t.offen.map(n => (
                        <span key={n} className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink" title="Noch kein Konto, wird automatisch zugeordnet, sobald das Konto besteht">
                          {n}
                          <button onClick={() => setTeamsEdit(ts => ts!.map(x => (x.id === t.id ? { ...x, offen: x.offen.filter(m => m !== n) } : x)))} className="opacity-70 hover:opacity-100" aria-label="Entfernen">✕</button>
                        </span>
                      ))}
                      <select value="" onChange={ev => { const id = ev.target.value; if (id) setTeamsEdit(ts => ts!.map(x => (x.id === t.id ? { ...x, mitglieder: [...x.mitglieder, id] } : x))) }} className="input-field !w-auto !py-0.5 text-[12px]">
                        <option value="">Person hinzufügen</option>
                        {frei.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                      <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-3">
                        <input type="checkbox" checked={t.ausserKonkurrenz} onChange={ev => setTeamsEdit(ts => ts!.map(x => (x.id === t.id ? { ...x, ausserKonkurrenz: ev.target.checked } : x)))} />
                        ausser Konkurrenz
                      </label>
                      {t.mitglieder.length === 0 && t.offen.length === 0 && (
                        <button onClick={() => setTeamsEdit(ts => ts!.filter(x => x.id !== t.id))} className="text-[11px] text-ink-4 hover:text-red-500">Team entfernen</button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setTeamsEdit(ts => [...ts!, { id: `t${Date.now().toString(36)}`, mitglieder: [], offen: [], ausserKonkurrenz: false }])} className="btn-secondary !px-3 !py-1.5 !text-xs">＋ Team</button>
                  <button onClick={teamsSpeichern} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">Teams speichern</button>
                  <button onClick={() => setTeamsEdit(null)} className="text-xs text-ink-4 hover:text-ink-2">Abbrechen</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button onClick={testdatenLoeschen} disabled={isPending || testfotos === 0} className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-50">Testdaten löschen ({testfotos})</button>
            <span className="text-[11px] text-ink-4">Entfernt alle Testfotos samt Dateien, damit das Spiel am Freitag bei null startet.</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={zip} disabled={!!zipStatus} className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-60">{zipStatus ? zipStatus : 'Alle Fotos als ZIP herunterladen'}</button>
            <span className="text-[11px] text-ink-4">Bingofotos in Ordnern pro Team und Aufgabe, das Fotoalbum pro Tag. Am besten am Computer, die Dateien werden im Browser verpackt.</span>
          </div>

          {msg && (
            <p className={`text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>
              {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
