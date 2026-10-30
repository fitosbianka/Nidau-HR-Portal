'use client'

// Samstage und Notfalldienste auf der Mitarbeiterseite: nur Zahlen pro
// Rolle und der eigene Status, keine Namen anderer Personen. Anmelden und
// Abmelden für die eigene Rolle.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { samstagAnmelden, samstagAbmelden } from '@/actions/samstage'
import { ndAnmelden, ndAbmelden } from '@/actions/notfalldienste'
import { ROLLEN, ROLLE_LABEL, fmtSamstag, type SamstagRolle, type SamstagZahlen } from '@/lib/samstage'
import { ND_ROLLEN, ND_ROLLE_LABEL, fmtNdZeitraum, type NdRolle, type NdZahlen } from '@/lib/notfalldienste'
import { isoKw } from '@/lib/ferien'

export default function DiensteMitarbeiter({ samstage, notfalldienste, samstagRolle, ndRolle, heute }: {
  samstage: SamstagZahlen[]
  notfalldienste: NdZahlen[]
  samstagRolle: SamstagRolle | null
  ndRolle: NdRolle | null
  heute: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [vergangene, setVergangene] = useState(false)

  function run(fn: () => Promise<{ error?: string } | { success: true }>, ok?: string) {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      if ('error' in r && r.error) { setMsg({ type: 'err', text: r.error }); return }
      if (ok) setMsg({ type: 'ok', text: ok })
      router.refresh()
    })
  }

  const sa = samstage.filter(s => vergangene || s.datum >= heute)
  const nd = notfalldienste.filter(n => vergangene || n.bis >= heute)
  const vergangen = samstage.filter(s => s.datum < heute).length + notfalldienste.filter(n => n.bis < heute).length
  const zaehler = <R extends string>(rollen: R[], label: Record<R, string>, anzahl: Record<R, number>, bedarf: Record<R, number | null>) =>
    rollen.map(r => `${label[r]} ${anzahl[r]}${bedarf[r] != null ? ` von ${bedarf[r]}` : ''}`).join(', ')

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-edge-soft">
        <div>
          <p className="text-sm font-semibold text-ink">Samstage und Notfalldienste</p>
          <p className="text-[11.5px] text-ink-4 mt-0.5">Wer kann, trägt sich ein. Der Dienst steht sofort in deinem Arbeitsplan. Die Einteilung macht die Praxisleitung.</p>
        </div>
        {vergangen > 0 && <button onClick={() => setVergangene(v => !v)} className="text-[11px] text-ink-4 hover:text-ink-2">{vergangene ? 'Vergangene ausblenden' : `Vergangene anzeigen (${vergangen})`}</button>}
      </div>
      {msg && <p className={`mx-5 mt-3 text-xs px-3 py-2 rounded-ctl inline-block ${msg.type === 'ok' ? 'bg-mint-bg text-mint-ink' : 'bg-blush-bg text-blush-ink'}`}>{msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}</p>}

      <div className="px-5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-1.5">Samstage</p>
        {sa.length === 0 ? <p className="text-[12.5px] text-ink-4">Zurzeit sind keine Samstagsöffnungen erfasst.</p> : (
          <ul className="divide-y divide-edge-row">
            {sa.map(s => (
              <li key={s.datum} className={`py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 ${s.datum < heute ? 'opacity-60' : ''}`}>
                <div className="min-w-[130px]">
                  <p className="text-[13px] font-semibold text-ink tnum">{fmtSamstag(s.datum)}</p>
                  <p className="text-[11px] text-ink-4 tnum">KW {isoKw(s.datum)}{s.notiz ? ` · ${s.notiz}` : ''}</p>
                </div>
                <p className="flex-1 min-w-[200px] text-[12px] text-ink-2 tnum">{zaehler(ROLLEN, ROLLE_LABEL, s.anzahl, s.bedarf)}</p>
                <div className="ml-auto flex items-center gap-2">
                  {s.ichDabei && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-mint-bg text-mint-ink">Eingetragen</span>}
                  {s.datum >= heute && samstagRolle && (s.ichDabei
                    ? <button onClick={() => run(() => samstagAbmelden(s.datum), 'Abgemeldet, der Eintrag im Arbeitsplan ist entfernt.')} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs">Abmelden</button>
                    : <button onClick={() => run(() => samstagAnmelden(s.datum), 'Eingetragen, der Samstag steht in deinem Arbeitsplan.')} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">Ich kann</button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-5 py-3 border-t border-edge-soft">
        <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-4 mb-1.5">Notfalldienste</p>
        {nd.length === 0 ? <p className="text-[12.5px] text-ink-4">Zurzeit sind keine Notfalldienste erfasst.</p> : (
          <ul className="divide-y divide-edge-row">
            {nd.map(n => (
              <li key={n.von} className={`py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 ${n.bis < heute ? 'opacity-60' : ''}`}>
                <div className="min-w-[150px]">
                  <p className="text-[13px] font-semibold text-ink tnum">{fmtNdZeitraum(n.von, n.bis)}</p>
                  <p className="text-[11px] text-ink-4 tnum">KW {isoKw(n.von)}{n.notiz ? ` · ${n.notiz}` : ''}</p>
                </div>
                <p className="flex-1 min-w-[200px] text-[12px] text-ink-2 tnum">
                  {zaehler(ND_ROLLEN, ND_ROLLE_LABEL, n.anzahl, n.bedarf)}
                  {(n.bestaetigt.zahnarzt + n.bestaetigt.assistenz) > 0 && <span className="text-ink-4"> · {n.bestaetigt.zahnarzt + n.bestaetigt.assistenz} im Arbeitsplan</span>}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  {n.mein === 'bestaetigt' && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-mint-bg text-mint-ink">Im Arbeitsplan</span>}
                  {n.mein === 'offen' && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-apricot-bg text-apricot-ink">Angemeldet</span>}
                  {n.bis >= heute && ndRolle && n.mein === null && (
                    <button onClick={() => run(() => ndAnmelden(n.von), 'Eingetragen, ND steht in deinem Arbeitsplan.')} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-xs">Ich kann</button>
                  )}
                  {n.von >= heute && ndRolle && n.mein !== null && (
                    <button onClick={() => run(() => ndAbmelden(n.von), 'Abgemeldet, die ND Tage sind aus dem Arbeitsplan entfernt.')} disabled={isPending} className="btn-secondary !px-3 !py-1.5 !text-xs">Abmelden</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!ndRolle && samstagRolle === 'dhpa' && <p className="mt-2 text-[11px] text-ink-4">Notfalldienste brauchen Zahnärztinnen und Assistenz.</p>}
      </div>
    </div>
  )
}
