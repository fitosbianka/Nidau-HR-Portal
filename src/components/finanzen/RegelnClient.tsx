'use client'

// Kategorien & Regeln der Geschäftsanalyse — drei Karten:
// 1. Kategorien (umbenennen, ergänzen, löschen wenn unbenutzt)
// 2. Regeln (Suchtext, Richtung, Betragsgrenzen, Priorität, testen)
// 3. Konten (umbenennen)
// Gespeichert wird gesammelt über «Speichern»; der Server prüft, ob eine
// gelöschte Kategorie noch von Handzuordnungen gebraucht wird.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  speichereKategorienUndRegeln, startregelnWiederherstellen, regelTesten, kontoUmbenennen,
} from '@/actions/finanzen'
import {
  GRUPPEN_META, GRUPPEN_REIHENFOLGE, INTERN_ID,
  type Gruppe, type Kategorie, type Regel,
} from '@/lib/finanzen/kategorien'
import type { FinanzKonto } from '@/lib/finanzen/types'
import { fmtChf } from '@/lib/utils'

const fmtSig = (rp: number) => `${rp < 0 ? '−' : ''}${fmtChf(Math.abs(rp) / 100)}`
const fmtD = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

const neueId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// Wirft der Server-Aufruf (statt einen Fehler zurückzugeben), läuft im
// Browser meist noch ein älterer Seitenstand — klar sagen statt schlucken.
const AKTUALISIEREN_HINWEIS = 'Das hat nicht geklappt — wahrscheinlich läuft noch eine ältere Version der Seite. Bitte die Seite einmal neu laden und nochmals versuchen.'

type Props = {
  kategorien: Kategorie[]
  regeln: Regel[]
  kontos: FinanzKonto[]
  /** Treffer je Regel-ID über die letzten 12 Monate (Stand letzte Speicherung) */
  treffer: Record<string, number>
}

export default function RegelnClient({ kategorien, regeln, kontos, treffer }: Props) {
  const router = useRouter()
  const propsSig = useMemo(() => JSON.stringify([kategorien, regeln]), [kategorien, regeln])

  const [kats, setKats] = useState<Kategorie[]>(kategorien)
  const [regs, setRegs] = useState<Regel[]>(regeln)
  const [dirty, setDirty] = useState(false)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState<string | null>(null)
  const [resetFrage, setResetFrage] = useState(false)
  const [test, setTest] = useState<{ laeuft: boolean; gesamt: number; zeilen: Array<{ datum: string; betragRp: number; text: string }> } | null>(null)

  // Nach router.refresh() (eigene Speicherung) den lokalen Stand übernehmen
  useEffect(() => {
    setKats(kategorien)
    setRegs(regeln)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSig])

  const sortierteRegeln = useMemo(() => [...regs].sort((a, b) => a.prioritaet - b.prioritaet), [regs])

  const katAendern = (id: string, patch: Partial<Kategorie>) => {
    setKats(ks => ks.map(k => k.id === id ? { ...k, ...patch } : k))
    setDirty(true)
    setErfolg(null)
  }
  const katLoeschen = (id: string) => {
    if (regs.some(r => r.kategorieId === id)) {
      setFehler('Diese Kategorie wird noch von einer Regel verwendet — zuerst die Regel anpassen oder löschen.')
      return
    }
    setKats(ks => ks.filter(k => k.id !== id))
    setDirty(true)
    setFehler(null)
    setErfolg(null)
  }
  const katNeu = (gruppe: Gruppe) => {
    setKats(ks => [...ks, { id: neueId('kat'), name: '', gruppe, aktiv: true }])
    setDirty(true)
    setErfolg(null)
  }

  const regelAendern = (id: string, patch: Partial<Regel>) => {
    setRegs(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    setDirty(true)
    setErfolg(null)
  }
  const regelLoeschen = (id: string) => {
    setRegs(rs => rs.filter(r => r.id !== id))
    setDirty(true)
    setErfolg(null)
  }
  const regelNeu = () => {
    const maxPrio = Math.max(0, ...regs.filter(r => r.prioritaet < 9000).map(r => r.prioritaet))
    setRegs(rs => [...rs, {
      id: neueId('regel'), suchtext: '', richtung: 'ausgabe', betragMin: null, betragMax: null,
      kategorieId: kats.find(k => k.gruppe === 'AUSGABEN_BETRIEB')?.id ?? kats[0]?.id ?? '',
      prioritaet: Math.min(8990, maxPrio + 10), aktiv: true,
    }])
    setDirty(true)
    setErfolg(null)
  }
  const regelVerschieben = (id: string, hoch: boolean) => {
    const sorted = [...regs].sort((a, b) => a.prioritaet - b.prioritaet)
    const i = sorted.findIndex(r => r.id === id)
    const j = hoch ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= sorted.length) return
    const a = sorted[i], b = sorted[j]
    setRegs(rs => rs.map(r => r.id === a.id ? { ...r, prioritaet: b.prioritaet } : r.id === b.id ? { ...r, prioritaet: a.prioritaet } : r))
    setDirty(true)
    setErfolg(null)
  }

  async function speichern() {
    setSpeichert(true)
    setFehler(null)
    setErfolg(null)
    try {
      const bereinigt = kats.map(k => ({ ...k, name: k.name.trim() }))
      const r = await speichereKategorienUndRegeln(bereinigt, regs)
      if ('error' in r && r.error) { setFehler(r.error); return }
      setErfolg('Gespeichert — die Zuordnung wirkt sofort, auch rückwirkend.')
      setDirty(false)
      router.refresh()
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
    } finally {
      setSpeichert(false)
    }
  }

  async function zuruecksetzen() {
    setSpeichert(true)
    setFehler(null)
    try {
      const r = await startregelnWiederherstellen()
      if ('error' in r && r.error) { setFehler(r.error); return }
      setResetFrage(false)
      setErfolg('Die Startregeln sind wiederhergestellt — Handzuordnungen bleiben erhalten.')
      router.refresh()
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
    } finally {
      setSpeichert(false)
    }
  }

  async function testen(r: Regel) {
    setTest({ laeuft: true, gesamt: 0, zeilen: [] })
    try {
      const res = await regelTesten({ suchtext: r.suchtext, richtung: r.richtung, betragMin: r.betragMin, betragMax: r.betragMax })
      if ('error' in res && (res as { error?: string }).error) {
        setFehler((res as { error: string }).error)
        setTest(null)
        return
      }
      const ok = res as { treffer: Array<{ datum: string; betragRp: number; text: string }>; gesamt: number }
      setTest({ laeuft: false, gesamt: ok.gesamt, zeilen: ok.treffer })
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
      setTest(null)
    }
  }

  const chfInput = (wert: number | null, setzen: (n: number | null) => void, platzhalter: string) => (
    <input
      value={wert ?? ''} inputMode="decimal" placeholder={platzhalter}
      onChange={e => {
        const t = e.target.value.replace(/['\s]/g, '').replace(',', '.')
        setzen(t === '' ? null : (isFinite(parseFloat(t)) ? parseFloat(t) : null))
      }}
      className="input-field w-20 text-[11.5px] py-1 tnum"
    />
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Kategorien &amp; Regeln</h1>
          <p className="page-subtitle">Automatische Zuordnung der Buchungen — Änderungen wirken sofort und rückwirkend</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/finanzen" className="btn-secondary">Zur Analyse</Link>
          <button onClick={() => setResetFrage(true)} className="btn-secondary">Startregeln wiederherstellen</button>
          <button onClick={speichern} disabled={!dirty || speichert} className="btn-primary disabled:opacity-50">
            {speichert ? 'Wird gespeichert…' : 'Speichern'}
          </button>
        </div>
      </div>

      {fehler && <p className="text-xs px-3.5 py-2.5 rounded-ctl bg-blush-bg text-blush-ink inline-block">⚠ {fehler}</p>}
      {erfolg && !dirty && <p className="text-xs px-3.5 py-2.5 rounded-ctl bg-mint-bg text-mint-ink inline-block">✓ {erfolg}</p>}
      {dirty && <p className="text-xs px-3.5 py-2.5 rounded-ctl bg-apricot-bg text-apricot-ink inline-block">Ungespeicherte Änderungen — oben rechts auf «Speichern».</p>}

      {/* Karte 1: Kategorien */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft">
          <p className="text-sm font-semibold text-ink">Kategorien</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">Die Gruppen sind fest (sie steuern die Analyse) — Kategorien lassen sich umbenennen, ergänzen und löschen, solange sie unbenutzt sind</p>
        </div>
        <div className="px-6 py-4 grid md:grid-cols-2 gap-x-8 gap-y-5">
          {GRUPPEN_REIHENFOLGE.filter(g => g !== 'UNKLASSIERT').map(g => (
            <div key={g}>
              <p className="eyebrow mb-2">{GRUPPEN_META[g].label}</p>
              <div className="space-y-1.5">
                {kats.filter(k => k.gruppe === g).map(k => (
                  <div key={k.id} className="flex items-center gap-2">
                    <input value={k.name} onChange={e => katAendern(k.id, { name: e.target.value })}
                      placeholder="Name der Kategorie" className="input-field flex-1 text-[12px] py-1.5" />
                    <label className="flex items-center gap-1 text-[10.5px] text-ink-4 shrink-0" title="Inaktive Kategorien erscheinen nicht mehr in den Auswahllisten">
                      <input type="checkbox" checked={k.aktiv} onChange={e => katAendern(k.id, { aktiv: e.target.checked })} className="accent-dusk-night" />
                      aktiv
                    </label>
                    {k.id !== INTERN_ID && (
                      <button onClick={() => katLoeschen(k.id)} title="Kategorie löschen"
                        className="p-1 rounded-lg hover:bg-blush-bg text-ink-4 hover:text-blush-ink shrink-0">✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => katNeu(g)} className="text-[11.5px] font-semibold text-steel-ink hover:underline">+ Neue Kategorie</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Karte 2: Regeln */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">Regeln</p>
            <p className="text-[11.5px] text-ink-4 mt-0.5">Von oben nach unten: die erste passende Regel gewinnt. Mehrere Suchbegriffe mit | trennen; ohne Suchtext passt die Regel auf alles (Auffang-Regel)</p>
          </div>
          <button onClick={regelNeu} className="btn-secondary text-xs">+ Neue Regel</button>
        </div>
        <div className="divide-y divide-edge-row">
          {sortierteRegeln.map((r, i) => (
            <div key={r.id} className={`px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${r.aktiv ? '' : 'opacity-50'}`}>
              <div className="flex flex-col shrink-0">
                <button onClick={() => regelVerschieben(r.id, true)} disabled={i === 0}
                  className="text-ink-4 hover:text-ink disabled:opacity-30 leading-none text-[13px]" title="höher priorisieren">▲</button>
                <button onClick={() => regelVerschieben(r.id, false)} disabled={i === sortierteRegeln.length - 1}
                  className="text-ink-4 hover:text-ink disabled:opacity-30 leading-none text-[13px]" title="tiefer priorisieren">▼</button>
              </div>
              <input value={r.suchtext} onChange={e => regelAendern(r.id, { suchtext: e.target.value })}
                placeholder="Suchtext, z.B. Kaladent|Curaden" className="input-field flex-1 min-w-[160px] text-[12px] py-1.5" />
              <select value={r.richtung} onChange={e => regelAendern(r.id, { richtung: e.target.value as Regel['richtung'] })}
                className="select-field text-[11.5px] py-1.5">
                <option value="ausgabe">Ausgabe</option>
                <option value="einnahme">Einnahme</option>
                <option value="beide">Beide</option>
              </select>
              <div className="flex items-center gap-1.5 text-[10.5px] text-ink-4">
                {chfInput(r.betragMin, n => regelAendern(r.id, { betragMin: n }), 'ab CHF')}
                –
                {chfInput(r.betragMax, n => regelAendern(r.id, { betragMax: n }), 'bis CHF')}
              </div>
              <span className="text-ink-4 text-[11px]">→</span>
              <select value={r.kategorieId} onChange={e => regelAendern(r.id, { kategorieId: e.target.value })}
                className="select-field text-[11.5px] py-1.5 max-w-[200px]">
                {GRUPPEN_REIHENFOLGE.map(g => {
                  const gk = kats.filter(k => k.gruppe === g)
                  if (gk.length === 0) return null
                  return (
                    <optgroup key={g} label={GRUPPEN_META[g].label}>
                      {gk.map(k => <option key={k.id} value={k.id}>{k.name || '(ohne Name)'}</option>)}
                    </optgroup>
                  )
                })}
              </select>
              <span className="text-[10.5px] text-ink-4 tnum whitespace-nowrap" title="Buchungen der letzten 12 Monate, die diese Regel heute zuordnet (Stand: letzte Speicherung)">
                {treffer[r.id] != null ? `${treffer[r.id]} Treffer` : '— Treffer'}
              </span>
              <label className="flex items-center gap-1 text-[10.5px] text-ink-4">
                <input type="checkbox" checked={r.aktiv} onChange={e => regelAendern(r.id, { aktiv: e.target.checked })} className="accent-dusk-night" />
                aktiv
              </label>
              <button onClick={() => testen(r)} className="text-[11px] font-semibold text-steel-ink hover:underline">Testen</button>
              <button onClick={() => regelLoeschen(r.id)} title="Regel löschen"
                className="p-1 rounded-lg hover:bg-blush-bg text-ink-4 hover:text-blush-ink">✕</button>
            </div>
          ))}
          {sortierteRegeln.length === 0 && <p className="px-6 py-4 text-xs text-ink-4">Keine Regeln — «Startregeln wiederherstellen» bringt den Ausgangszustand zurück.</p>}
        </div>
      </div>

      {/* Karte 3: Konten */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-edge-soft">
          <p className="text-sm font-semibold text-ink">Konten</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">Anzeigename der importierten Konten</p>
        </div>
        <div className="px-6 py-4 space-y-2">
          {kontos.length === 0 && <p className="text-xs text-ink-4">Noch kein Konto — zuerst auf der Analyse-Seite eine CSV importieren.</p>}
          {kontos.map(k => <KontoZeile key={k.kontoKey} konto={k} />)}
        </div>
      </div>

      {/* Bestätigung Startregeln */}
      {resetFrage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-card shadow-xl border border-edge max-w-sm w-full p-6">
            <h3 className="text-sm font-bold text-ink">Startregeln wiederherstellen?</h3>
            <p className="text-[12.5px] text-ink-3 mt-2 leading-relaxed">
              Alle Regeln werden durch die Startregeln ersetzt, fehlende Startkategorien wieder ergänzt.
              Von Hand zugeordnete Buchungen bleiben unverändert.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setResetFrage(false)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={zuruecksetzen} disabled={speichert} className="btn-primary flex-1 disabled:opacity-50">Wiederherstellen</button>
            </div>
          </div>
        </div>
      )}

      {/* Regel-Test */}
      {test && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-card sm:max-w-xl shadow-xl overflow-hidden rounded-t-card border border-edge max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-edge-soft bg-surface">
              <div>
                <h3 className="text-sm font-bold text-ink">Regel testen</h3>
                <p className="text-xs text-ink-4 mt-0.5">
                  {test.laeuft ? 'Wird geprüft…' : `${test.gesamt} Treffer in den letzten 12 Monaten${test.gesamt > test.zeilen.length ? ` (die neusten ${test.zeilen.length} angezeigt)` : ''}`}
                </p>
              </div>
              <button onClick={() => setTest(null)} className="p-1.5 rounded-lg hover:bg-edge-row text-ink-4 ml-4">✕</button>
            </div>
            <div className="px-6 py-3 overflow-auto">
              {!test.laeuft && test.zeilen.length === 0 && <p className="text-xs text-ink-4 py-3">Keine Buchung der letzten 12 Monate passt auf diese Regel.</p>}
              {test.zeilen.map((z, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-edge-row last:border-b-0">
                  <span className="text-[11.5px] font-semibold text-ink tnum shrink-0">{fmtD(z.datum)}</span>
                  <span className="text-[11.5px] text-ink-3 flex-1 min-w-0 break-words">{z.text || '(ohne Text)'}</span>
                  <span className={`text-[12px] font-bold tnum whitespace-nowrap ${z.betragRp >= 0 ? 'text-mint-ink' : 'text-ink'}`}>{fmtSig(z.betragRp)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KontoZeile({ konto }: { konto: FinanzKonto }) {
  const router = useRouter()
  const [name, setName] = useState(konto.name)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function speichern() {
    setSpeichert(true)
    setFehler(null)
    try {
      const r = await kontoUmbenennen(konto.kontoKey, name)
      if ('error' in r && r.error) { setFehler(r.error); return }
      router.refresh()
    } catch {
      setFehler(AKTUALISIEREN_HINWEIS)
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} className="input-field text-[12px] py-1.5 w-56" />
      <span className="text-[11px] text-ink-4 tnum">{konto.iban ? konto.iban.replace(/(.{4})/g, '$1 ').trim() : konto.kontoKey}</span>
      {name.trim() !== konto.name && (
        <button onClick={speichern} disabled={speichert} className="btn-primary text-xs py-1.5 disabled:opacity-50">
          {speichert ? '…' : 'Speichern'}
        </button>
      )}
      {fehler && <span className="text-[11px] text-blush-ink">⚠ {fehler}</span>}
    </div>
  )
}
