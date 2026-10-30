export default function FerienLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Ferienplanung</h1>
        <p className="page-subtitle">Ferienwünsche, Ferienkalender und Ferien-Bestand der Mitarbeitenden</p>
      </div>
      {children}
    </div>
  )
}
