// Sofortige Rückmeldung beim Wechsel zwischen Seiten: dieses Skelett
// erscheint, sobald ein Menüpunkt oder eine Kachel angetippt wird, während
// die Seite auf dem Server geladen wird.

export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Seite lädt">
      <div className="space-y-2">
        <div className="h-7 w-56 max-w-full rounded-lg bg-edge-row" />
        <div className="h-4 w-80 max-w-full rounded bg-edge-row" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="card h-40 bg-surface" />)}
      </div>
      <div className="card h-56 bg-surface" />
    </div>
  )
}
