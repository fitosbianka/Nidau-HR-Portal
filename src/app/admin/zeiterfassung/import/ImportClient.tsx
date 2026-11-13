'use client'

// TimeMoto Import in drei Schritten: Datei wählen und prüfen (Vorschau mit
// Zuordnung der Namen), importieren, Ergebnis. Darunter das Protokoll der
// bisherigen Importe.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { timemotoVorschau, timemotoImportieren, type Vorschau, type ImportErgebnis, type ImportProtokoll } from '@/actions/timemoto-import'

const fmtD = (iso: string | null | undefined) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso ?? '–'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`
}
const fmtDT = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}, ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })} Uhr`
}
const FORMAT_LABEL: Record<string, string> = { ereignisse: 'Liste der Stempelungen', tage: 'Tagesliste mit Ein und Aus', portal: 'Portal Vorlage' }

export default function ImportClient({ protokoll }: { protokoll: ImportProtokoll[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [datei, setDatei] = useState<File | null>(null)
  const [vorschau, setVorschau] = useState<Vorschau | null>(null)
  const [zuordnung, setZuordnung] = useState<Record<string, string>>({})
  const [ersetzen, setErsetzen] = useState(false)
  const [ergebnis, setErgebnis] = useState<ImportErgebnis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function zuruecksetzen() {
    setDatei(null); setVorschau(null); setZuordnung({}); setErsetzen(false); setErgebnis(null); setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function pruefen() {
    if (!datei) { setError('Bitte zuerst eine Datei wählen.'); return }
    setError(null); setErgebnis(null)
    const fd = new FormData(); fd.append('datei', datei)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof timemotoVorschau>>
      try { r = await timemotoVorschau(fd) } catch { r = { error: 'Die Datei konnte nicht übertragen werden. Bitte erneut versuchen.' } }
      if (r.error) { setError(r.error); setVorschau(null); return }
      setVorschau(r.vorschau ?? null)
      setZuordnung({})
    })
  }

  function importieren() {
    if (!datei || !vorschau) return
    const offen = vorschau.personen.filter(p => !p.profileId && !zuordnung[p.name])
    const hinweis = offen.length > 0 ? `\n\n${offen.length === 1 ? 'Ein Name ist' : `${offen.length} Namen sind`} nicht zugeordnet und ${offen.length === 1 ? 'wird' : 'werden'} übersprungen: ${offen.map(p => p.name).join(', ')}.` : ''
    if (!confirm(`«${vorschau.datei}» importieren?${hinweis}${ersetzen ? '\n\nFrühere Importzeilen im Zeitraum der Datei, die in der Datei fehlen, kommen in den Papierkorb.' : ''}`)) return
    setError(null)
    const fd = new FormData(); fd.append('datei', datei)
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof timemotoImportieren>>
      try { r = await timemotoImportieren(fd, JSON.stringify(zuordnung), ersetzen) } catch { r = { error: 'Der Import konnte nicht übertragen werden. Bitte erneut versuchen.' } }
      if (r.error) { setError(r.error); return }
      setErgebnis(r.ergebnis ?? null)
      setVorschau(null)
      router.refresh()
    })
  }

  const offeneNamen = vorschau?.personen.filter(p => !p.profileId) ?? []
  const importierbar = vorschau ? vorschau.personen.filter(p => p.profileId || zuordnung[p.name]) : []
  const neuGesamt = importierbar.reduce((s, p) => s + Math.max(0, p.anzahl - p.bereits), 0)

  return (
    <div className="space-y-5">
      {/* ── 1 · Datei ─────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">1. Export aus TimeMoto wählen</p>
          <p className="text-[12px] text-ink-3 mt-1 max-w-[80ch]">
            Im TimeMoto Portal die Stempelungen eines Monats exportieren (CSV oder Excel). Erkannt werden Listen mit Name, Datum, Zeit und Ein/Aus sowie Tageslisten mit den Spalten Ein und Aus. Die Spalten werden über die Kopfzeile gefunden.
            Zeiten gelten als Schweizer Zeit. Eine Stempelung, die schon im Portal ist, wird nie überschrieben; dieselbe Datei lässt sich darum gefahrlos zweimal hochladen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={e => { setDatei(e.target.files?.[0] ?? null); setVorschau(null); setErgebnis(null); setError(null) }}
            className="text-sm text-ink-2 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-edge-ctl file:bg-white file:text-sm file:font-medium file:text-ink-2 hover:file:border-brand-300" />
          <button onClick={pruefen} disabled={isPending || !datei} className="btn-primary !px-4 !py-2 !text-sm disabled:opacity-50">
            {isPending && !vorschau ? 'Wird gelesen…' : 'Datei prüfen'}
          </button>
          {(datei || vorschau || ergebnis) && <button onClick={zuruecksetzen} className="text-xs text-ink-4 hover:text-ink-2">Zurücksetzen</button>}
        </div>
        {error && <p className="text-sm text-red-600">⚠ {error}</p>}
      </div>

      {/* ── 2 · Vorschau ──────────────────────────────────────────── */}
      {vorschau && (
        <div className="card p-6 space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink">2. Prüfen und importieren</p>
            <p className="text-[12px] text-ink-3 mt-1">
              «{vorschau.datei}»: {FORMAT_LABEL[vorschau.format ?? ''] ?? 'Export'}, {vorschau.zeilen} Stempelungen
              {vorschau.von && vorschau.bis ? ` vom ${fmtD(vorschau.von)} bis ${fmtD(vorschau.bis)}` : ''}
              {vorschau.uebersprungen > 0 ? `, ${vorschau.uebersprungen} Zeilen ohne Zeit übersprungen (zum Beispiel Absenzen oder Summen)` : ''}.
            </p>
            {vorschau.fehler.map(f => <p key={f} className="text-[12px] text-apricot-ink mt-1">⚠ {f}</p>)}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-4 border-b-[1.5px] border-edge-ctl">
                  <th className="text-left py-1.5 pr-3">Name in der Datei</th>
                  <th className="text-left py-1.5 pr-3">Im Portal</th>
                  <th className="text-right py-1.5 px-2">Stempel</th>
                  <th className="text-left py-1.5 px-2 whitespace-nowrap">Zeitraum</th>
                  <th className="text-right py-1.5 px-2">Schon da</th>
                  <th className="text-left py-1.5 pl-3">Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {vorschau.personen.map(p => {
                  const gewaehlt = p.profileId ?? zuordnung[p.name] ?? ''
                  const profilName = p.profilName ?? vorschau.profile.find(x => x.id === gewaehlt)?.full_name ?? null
                  return (
                    <tr key={p.name} className="border-b border-edge-row align-top">
                      <td className="py-2 pr-3 font-semibold text-ink whitespace-nowrap">{p.name}</td>
                      <td className="py-2 pr-3">
                        {p.profileId ? (
                          <span className="text-ink-2">{p.profilName}</span>
                        ) : (
                          <select value={gewaehlt} onChange={e => setZuordnung(z => ({ ...z, [p.name]: e.target.value }))} className="select-field !py-1 text-[12px] min-w-[200px]">
                            <option value="">Nicht zugeordnet, überspringen</option>
                            {vorschau.profile.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tnum">{p.anzahl}</td>
                      <td className="py-2 px-2 whitespace-nowrap tnum text-ink-3">{fmtD(p.von)}{p.von !== p.bis ? ` bis ${fmtD(p.bis)}` : ''}</td>
                      <td className="py-2 px-2 text-right tnum text-ink-3">{p.profileId ? p.bereits : '–'}</td>
                      <td className="py-2 pl-3 text-[11.5px]">
                        {!gewaehlt && <span className="font-semibold text-apricot-ink">Kein Profil mit diesem Namen. Zuordnen, oder die Person zuerst unter «Mitarbeiter» anlegen.</span>}
                        {gewaehlt && p.profileId && !p.stempelt && <span className="text-apricot-ink">{profilName} gehört nicht zur Zeiterfassung (Funktion stempelt nicht). Die Zeiten werden gespeichert, erscheinen aber nicht in den Berichten.</span>}
                        {gewaehlt && !p.profileId && <span className="text-mint-ink">Zuordnung wird für künftige Importe gemerkt.</span>}
                        {gewaehlt && p.profileId && p.bereits === p.anzahl && <span className="text-ink-4">Alles schon im Portal, nichts Neues.</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <label className="flex items-start gap-2 text-[12px] text-ink-2 max-w-[80ch]">
            <input type="checkbox" checked={ersetzen} onChange={e => setErsetzen(e.target.checked)} className="mt-0.5 w-4 h-4" />
            <span>
              Korrigierter Export: frühere Importzeilen dieser Personen im Zeitraum der Datei, die in der neuen Datei fehlen, in den Papierkorb legen.
              Von Hand erfasste oder bearbeitete Zeiten bleiben unberührt; der Papierkorb in der Zeiterfassung kann alles wiederherstellen.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button onClick={importieren} disabled={isPending || importierbar.length === 0} className="btn-primary !px-4 !py-2 !text-sm disabled:opacity-50">
              {isPending ? 'Wird importiert…' : `Importieren (${neuGesamt} neue Stempel, ${importierbar.length} ${importierbar.length === 1 ? 'Person' : 'Personen'})`}
            </button>
            {offeneNamen.some(p => !zuordnung[p.name]) && <span className="text-[12px] text-ink-4">Nicht zugeordnete Namen werden übersprungen.</span>}
          </div>
        </div>
      )}

      {/* ── 3 · Ergebnis ──────────────────────────────────────────── */}
      {ergebnis && (
        <div className="card p-6 space-y-3 border-mint-ink/30">
          <p className="text-sm font-semibold text-ink">3. Import abgeschlossen</p>
          <p className="text-[13px] text-ink-2 tnum">
            «{ergebnis.datei}»{ergebnis.von && ergebnis.bis ? `, ${fmtD(ergebnis.von)} bis ${fmtD(ergebnis.bis)}` : ''}: {ergebnis.neu} neue Stempel gespeichert
            {ergebnis.bereits > 0 ? `, ${ergebnis.bereits} waren schon da` : ''}{ergebnis.ersetzt > 0 ? `, ${ergebnis.ersetzt} ältere Importzeilen in den Papierkorb gelegt` : ''}.
          </p>
          {ergebnis.personen.length > 0 && (
            <ul className="text-[12px] text-ink-3 space-y-0.5 tnum">
              {ergebnis.personen.map(p => <li key={p.name}><span className="font-semibold text-ink-2">{p.name}</span>: {p.neu} neu{p.bereits > 0 ? `, ${p.bereits} schon da` : ''}</li>)}
            </ul>
          )}
          {ergebnis.nichtZugeordnet.length > 0 && <p className="text-[12px] text-apricot-ink">Übersprungen, kein Profil: {ergebnis.nichtZugeordnet.join(', ')}</p>}
          <div className="flex flex-wrap gap-3 pt-1">
            <a href="/admin/zeiterfassung/berichte" className="btn-secondary !px-3 !py-1.5 !text-xs">Zur Zeiterfassung</a>
            <a href="/admin/zeiterfassung/konto" className="btn-secondary !px-3 !py-1.5 !text-xs">Zum Arbeitszeit- und Ferienkonto</a>
            <button onClick={zuruecksetzen} className="text-xs text-ink-4 hover:text-ink-2">Weitere Datei</button>
          </div>
        </div>
      )}

      {/* ── Protokoll ─────────────────────────────────────────────── */}
      <div className="card p-6">
        <p className="text-sm font-semibold text-ink mb-3">Bisherige Importe</p>
        {protokoll.length === 0 ? (
          <p className="text-[12px] text-ink-4">Noch kein Import.</p>
        ) : (
          <ul className="divide-y divide-edge-row">
            {protokoll.map(p => (
              <li key={p.id} className="py-2.5 text-[12.5px]">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{p.datei}</span>
                  <span className="text-ink-4 tnum">{fmtDT(p.am)}{p.von ? `, ${p.von}` : ''}</span>
                  <span className="text-ink-3 tnum">{p.zeitraum.von && p.zeitraum.bis ? `${fmtD(p.zeitraum.von)} bis ${fmtD(p.zeitraum.bis)}, ` : ''}{p.neu} neu{p.bereits > 0 ? `, ${p.bereits} schon da` : ''}{p.ersetzt > 0 ? `, ${p.ersetzt} ersetzt` : ''}</span>
                </div>
                {p.personen.length > 0 && <p className="text-[11px] text-ink-4 mt-0.5">{p.personen.map(x => `${x.name} ${x.neu}`).join(' · ')}</p>}
                {p.nichtZugeordnet.length > 0 && <p className="text-[11px] text-apricot-ink mt-0.5">Übersprungen: {p.nichtZugeordnet.join(', ')}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
