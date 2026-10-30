'use client'

// Seite Spiele eines Teamevents: Fotobingo mit Spielregeln, eigener Karte,
// Felddialog zum Hochladen und den Karten der anderen Teams (während des
// Spiels nur Haken, ab sichtbarAb mit allen Fotos). Nach «Resultate
// veröffentlichen» die Rangliste und der Jurypreis. Die Organisatorin sieht
// zusätzlich die Verwaltung, die Jury den Link zur Fotokontrolle.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BingoDaten, FotoAnsicht, TeamAnsicht } from '@/lib/teamevent-bingo-data'
import { BINGO_AUFGABEN, PUNKTE, spieleBeschreibung, uhrzeit, wochentagKurz } from '@/lib/teamevent-bingo'
import { BingoKarte, MiniKarte } from './BingoKarte'
import FeldDialog from './FeldDialog'
import BingoVerwaltung from './BingoVerwaltung'

export default function BingoClient({ daten, meinId, basis }: { daten: BingoDaten; meinId: string; basis: string }) {
  const router = useRouter()
  const e = daten.einstellungen
  const [feld, setFeld] = useState<{ team: string; aufgabe: string } | null>(null)
  const [regelnOffen, setRegelnOffen] = useState(false)
  const [anzeigeTeam, setAnzeigeTeam] = useState<string>(daten.meinTeam?.id ?? '')
  const regelnKey = `bingo-regeln-${daten.slug}`

  useEffect(() => {
    try { setRegelnOffen(localStorage.getItem(regelnKey) !== '1') } catch { setRegelnOffen(true) }
  }, [regelnKey])
  function regelnToggle() {
    setRegelnOffen(o => {
      const n = !o
      try { if (!n) localStorage.setItem(regelnKey, '1') } catch { /* egal */ }
      return n
    })
  }

  // Immer aktuell: beim Zurückkehren in den Tab und jede Minute still neu
  // laden, nicht während ein Feld offen ist (Upload im Gang).
  const feldRef = useRef<typeof feld>(null)
  feldRef.current = feld
  useEffect(() => {
    const still = () => { if (document.visibilityState === 'visible' && !feldRef.current) router.refresh() }
    const onVis = () => { if (document.visibilityState === 'visible') still() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(still, 60_000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [router])

  const testmodus = e.testmodus && (daten.rolle.admin || daten.rolle.jury)
  const alleTeams = useMemo(() => [...(daten.meinTeam ? [daten.meinTeam] : []), ...daten.andere], [daten.meinTeam, daten.andere])
  const karte: TeamAnsicht | null = (testmodus && anzeigeTeam ? alleTeams.find(t => t.id === anzeigeTeam) : null) ?? daten.meinTeam
  const fotosVon = useMemo(() => {
    const m = new Map<string, FotoAnsicht[]>()
    for (const f of daten.alleFotos ?? daten.meineFotos) m.set(f.team, [...(m.get(f.team) ?? []), f])
    if (!daten.alleFotos && daten.meinTeam) m.set(daten.meinTeam.id, daten.meineFotos)
    return m
  }, [daten.alleFotos, daten.meineFotos, daten.meinTeam])
  const fotosJeFeld = (teamId: string) => {
    const m = new Map<string, FotoAnsicht[]>()
    for (const f of fotosVon.get(teamId) ?? []) m.set(f.aufgabe, [...(m.get(f.aufgabe) ?? []), f])
    return m
  }
  const meineFelder = useMemo(() => (karte ? fotosJeFeld(karte.id) : new Map<string, FotoAnsicht[]>()), [karte, fotosVon])  // eslint-disable-line react-hooks/exhaustive-deps
  const aufgabeById = useMemo(() => new Map(daten.aufgaben.map(a => [a.id, a])), [daten.aufgaben])
  const hatFoto = (id: string) => (meineFelder.get(id)?.length ?? 0) > 0
  const vorschau = (id: string) => meineFelder.get(id)?.find(f => f.vorschauUrl)?.vorschauUrl ?? null
  const erledigt = BINGO_AUFGABEN.filter(a => hatFoto(a.id)).length
  const sperrText = daten.uploadOk.ok ? null : daten.uploadOk.grund
  const darfLoeschen = (f: FotoAnsicht) => daten.rolle.jury || daten.rolle.verwaltet || (f.eigenes && daten.phase !== 'vorbei') || (testmodus && f.test)

  const dialogAufgabe = feld ? aufgabeById.get(feld.aufgabe) ?? null : null
  const dialogTeam = feld ? alleTeams.find(t => t.id === feld.team) ?? null : null
  const dialogFotos = feld ? fotosJeFeld(feld.team).get(feld.aufgabe) ?? [] : []
  const dialogEigene = !!dialogTeam && (dialogTeam.id === daten.meinTeam?.id || (testmodus && dialogTeam.id === karte?.id))

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-ink-4">
          <Link href={basis} className="hover:text-ink-2">Teamevents</Link>
          <span className="mx-1.5">/</span>
          <Link href={`${basis}/${daten.slug}`} className="hover:text-ink-2">{daten.ordner.name}</Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-2">Spiele</span>
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title mt-1">Fotobingo</h1>
            <p className="page-subtitle">{spieleBeschreibung(e)}</p>
          </div>
          {daten.rolle.jury && (
            <Link href={`${basis}/${daten.slug}/spiele/jury`} className="btn-secondary inline-flex items-center gap-2">
              Jury und Fotokontrolle
              {daten.offenFotos != null && daten.offenFotos > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-apricot-bg text-apricot-ink tnum">{daten.offenFotos} offen</span>}
            </Link>
          )}
        </div>
      </div>

      {!e.veroeffentlicht && (daten.rolle.admin || daten.rolle.verwaltet) && (
        <p className="text-[12px] px-3.5 py-2.5 rounded-xl bg-lilac-soft text-lilac-ink">Vorschau nur für Admins. Für Mitarbeitende ist der Ordner Spiele nicht veröffentlicht und erscheint auch zum Bingo Start nicht von selbst.</p>
      )}
      {testmodus && (
        <p className="text-[12px] px-3.5 py-2.5 rounded-xl bg-apricot-bg text-apricot-ink">Testmodus aktiv. Fotos werden als Test markiert und lassen sich in der Verwaltung gesammelt löschen.</p>
      )}
      {daten.phase === 'vor' && !testmodus && (
        <p className="text-[13px] px-3.5 py-2.5 rounded-xl bg-steel-bg text-steel-ink">Das Bingo startet am {wochentagKurz(e.start)} um {uhrzeit(e.start)} Uhr. Die Karte und die Aufgaben könnt ihr jetzt schon anschauen.</p>
      )}
      {daten.phase === 'vorbei' && !daten.resultate && (
        <p className="text-[13px] px-3.5 py-2.5 rounded-xl bg-steel-bg text-steel-ink">Das Bingo ist vorbei, die Siegerehrung ist im Bus.{daten.kartenSichtbar ? ' Alle Karten sind jetzt offen, tippt auf ein Feld der anderen Teams.' : ''}</p>
      )}

      {daten.rolle.verwaltet && (
        <BingoVerwaltung slug={daten.slug} einstellungen={e} teams={alleTeams} personen={daten.team} testfotos={daten.testfotos} />
      )}

      {/* Resultate nach der Veröffentlichung */}
      {daten.resultate && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-edge-soft">
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">Das Resultat</p>
            <p className="text-[18px] font-bold text-ink">Rangliste Fotobingo</p>
          </div>
          <ul className="divide-y divide-edge-row">
            {daten.resultate.rangliste.map(z => (
              <li key={z.teamId} className={`px-5 py-3 flex items-center gap-3 ${z.rang === 1 ? 'bg-mint-bg/60' : ''}`}>
                <span className={`w-9 h-9 rounded-full flex items-center justify-center font-bold tnum ${z.rang === 1 ? 'bg-mint-ink text-white text-[17px]' : z.rang <= 3 ? 'bg-dune text-ink' : 'bg-surface text-ink-3 border border-edge-ctl'}`}>{z.rang}</span>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold truncate ${z.rang === 1 ? 'text-[16px] text-ink' : 'text-[14px] text-ink'}${z.teamId === daten.meinTeam?.id ? ' underline decoration-mint-mid' : ''}`}>{z.name}</p>
                  <p className="text-[11px] text-ink-4 tnum">{z.punkte.felder} Felder · {z.punkte.reihen} Reihen{z.punkte.volleKarte ? ' · volle Karte' : ''}{z.punkte.bonus ? ` · ${z.punkte.bonus * PUNKTE.bonus} Bonus` : ''}{z.punkte.korrektur ? ` · Korrektur ${z.punkte.korrektur > 0 ? '+' : ''}${z.punkte.korrektur}` : ''}</p>
                </div>
                <span className="text-[17px] font-bold text-mint-ink tnum">{z.punkte.total}</span>
              </li>
            ))}
          </ul>
          {daten.resultate.preis && (
            <div className="px-5 py-4 border-t border-edge-soft bg-lilac-soft flex items-center gap-4">
              {daten.resultate.preis.foto.vorschauUrl && (
                <button onClick={() => setFeld({ team: daten.resultate!.preis!.foto.team, aufgabe: daten.resultate!.preis!.foto.aufgabe })} className="flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={daten.resultate.preis.foto.vorschauUrl} alt="" className="w-24 h-24 rounded-xl object-cover shadow" />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-lilac-label">Jurypreis für das kreativste Foto</p>
                <p className="text-[16px] font-bold text-ink">{daten.resultate.preis.teamName}</p>
                <p className="text-[12px] text-ink-3">{daten.resultate.preis.aufgabeTitel} · {daten.resultate.preis.foto.rufname}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spielregeln */}
      <div className="card overflow-hidden">
        <button onClick={regelnToggle} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left">
          <p className="text-sm font-semibold text-ink">Spielregeln</p>
          <svg className={`w-4 h-4 text-ink-4 transition-transform ${regelnOffen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
        {regelnOffen && (
          <ul className="px-5 pb-4 space-y-1.5 border-t border-edge-soft pt-3">
            {daten.regeln.map((r, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink-2 leading-snug"><span className="text-mint-mid mt-[2px]">•</span><span>{r}</span></li>
            ))}
          </ul>
        )}
      </div>

      {/* Eigene Karte */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4">{karte && karte.id !== daten.meinTeam?.id ? 'Karte von' : 'Eure Karte'}</p>
            <p className="text-[17px] font-bold text-ink leading-tight">{karte ? karte.name : 'Noch kein Team'}</p>
          </div>
          {karte && <p className="text-[12px] text-ink-3 tnum">{erledigt} von {BINGO_AUFGABEN.length} Feldern mit Foto</p>}
        </div>
        {testmodus && alleTeams.length > 1 && (
          <label className="flex items-center gap-2 text-[11px] text-ink-3 mb-3">
            Testmodus, Karte anzeigen von
            <select value={anzeigeTeam} onChange={ev => setAnzeigeTeam(ev.target.value)} className="input-field !w-auto !py-1 text-[12px]">
              {alleTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        {karte ? (
          <BingoKarte layout={daten.layout} aufgaben={daten.aufgaben} hatFoto={hatFoto} vorschau={vorschau} onFeld={id => setFeld({ team: karte.id, aufgabe: id })} gesperrt={daten.phase !== 'laeuft' && !testmodus} />
        ) : (
          <div>
            <p className="text-[13px] text-ink-3 mb-3">Du bist noch keinem Team zugeteilt. Bitte melde dich bei Bianka. Die Aufgaben kannst du trotzdem anschauen.</p>
            <BingoKarte layout={daten.layout} aufgaben={daten.aufgaben} hatFoto={() => false} onFeld={id => setFeld({ team: '', aufgabe: id })} gesperrt />
          </div>
        )}
        <p className="mt-3 text-[11px] text-ink-4">Ein Tipp auf ein Feld zeigt die Aufgabe und eure Fotos. Mehrere Fotos pro Feld sind erlaubt, bis zu 5 pro Team, bei der Buchstabenjagd bis zu 20 pro Person.</p>
      </div>

      {/* Andere Teams */}
      {daten.andere.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-2 px-1">Die anderen Teams</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {daten.andere.map(t => {
              const felder = daten.kartenSichtbar ? fotosJeFeld(t.id) : null
              return (
                <div key={t.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-[12.5px] font-semibold text-ink leading-tight">{t.name}</p>
                    {t.ausserKonkurrenz && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-lilac-soft text-lilac-ink whitespace-nowrap">Jury</span>}
                  </div>
                  <MiniKarte layout={daten.layout} haken={new Set(t.haken)}
                    vorschau={felder ? id => felder.get(id)?.find(f => f.vorschauUrl)?.vorschauUrl ?? null : undefined}
                    offen={felder ? id => setFeld({ team: t.id, aufgabe: id }) : undefined} />
                  <p className="mt-2 text-[11px] text-ink-4 tnum">{t.anzahl} von {BINGO_AUFGABEN.length} Feldern</p>
                </div>
              )
            })}
          </div>
          <p className="mt-2 px-1 text-[11px] text-ink-4">
            {daten.kartenSichtbar
              ? 'Alle Karten sind offen. Ein Tipp auf ein Feld zeigt die Fotos des Teams, ansehen und herunterladen.'
              : `Während des Spiels seht ihr bei den anderen Teams nur, welche Felder schon ein Foto haben. Ab ${uhrzeit(e.sichtbarAb)} Uhr am ${wochentagKurz(e.sichtbarAb)} sind alle Karten mit allen Fotos offen.`}
          </p>
        </div>
      )}

      {dialogAufgabe && feld && (
        <FeldDialog
          slug={daten.slug} aufgabe={dialogAufgabe} fotos={dialogFotos}
          teamId={dialogEigene ? feld.team : null} meinId={meinId}
          hochladenOk={daten.uploadOk.ok} sperrText={sperrText}
          darfLoeschen={darfLoeschen} verwaltet={daten.rolle.verwaltet} testmodus={testmodus}
          nurAnsicht={!dialogEigene}
          onClose={() => setFeld(null)}
        />
      )}
    </div>
  )
}
