'use client'

// Karte «Persönliche Details»: Zimmer, Reservation und das eigene
// Abendessen. Bekommt NUR die Daten der angemeldeten Person.

import type { TeDetail } from '@/lib/teamevent-programm'

export default function MeineDetails({ detail, zimmerMitName }: { detail: TeDetail; zimmerMitName: string | null }) {
  const zimmer = detail.zimmer === 'doppel' && zimmerMitName ? `Doppelzimmer mit ${zimmerMitName}`
    : detail.zimmer === 'einzel' ? 'Einzelzimmer'
    : 'Zimmer wird noch eingeteilt'
  const gaenge: Array<[string, string | null]> = [['Vorspeise', detail.vorspeise], ['Hauptgang', detail.hauptgang], ['Dessert', detail.dessert]]
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">Persönliche Details</h2>
      <div className="card divide-y divide-edge-soft">
        <div className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Zimmer</p>
            <p className="text-sm text-ink mt-0.5">{zimmer}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Reservation</p>
            {detail.resNr ? (
              <>
                <p className="text-sm text-ink mt-0.5 tnum">Reservierungs Nr. <span className="font-semibold">{detail.resNr}</span></p>
                {detail.resName && <p className="text-[12px] text-ink-2">Reservation auf {detail.resName}</p>}
                <p className="text-[11px] text-ink-4 mt-1">Die Nummer hilft an der Rezeption und beim Online Check in in der Europapark Hotels App</p>
              </>
            ) : (
              <p className="text-sm text-ink-4 mt-0.5">Die Reservierungs Nr. folgt</p>
            )}
          </div>
        </div>
        <div className="px-4 sm:px-5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Abendessen am Freitag um 19.00 Uhr im Captain&apos;s Finest</p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {gaenge.map(([l, v]) => (
              <div key={l} className="contents">
                <dt className="text-ink-4">{l}</dt>
                <dd className={v ? 'text-ink' : 'text-ink-4'}>{v ?? 'noch offen'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
