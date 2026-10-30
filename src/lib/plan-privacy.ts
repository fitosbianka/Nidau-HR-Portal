import type { FerienWunsch } from '@/lib/ferien-wuensche'

// UF (unbezahlte Ferien) ist lohnrelevant und darum privat: im Team-Blick
// erscheint sie als gewöhnliche Ferien («F»). Nur Admins und die betroffene
// Person selbst sehen «UF». Maskiert wird serverseitig an der Datengrenze,
// bevor die Daten den Browser erreichen — andere Mitarbeitende erhalten den
// echten Code gar nicht erst. Die Ferienplanungs-Seite der Ferien-Editorin
// (Laura) bleibt bewusst unmaskiert: sie muss UF-Wünsche als UF annehmen
// können, sonst würde unbezahlter Urlaub versehentlich bezahlt.

export function maskUfEntries<T extends { employee_id: string; entry: string }>(
  rows: T[],
  viewerId: string,
  viewerIsAdmin: boolean,
): T[] {
  if (viewerIsAdmin) return rows
  return rows.map(r => (r.entry === 'UF' && r.employee_id !== viewerId) ? { ...r, entry: 'F' } : r)
}

export function maskUfWuensche(
  wishes: FerienWunsch[],
  viewerId: string,
  viewerIsAdmin: boolean,
): FerienWunsch[] {
  if (viewerIsAdmin) return wishes
  return wishes.map(w => (w.art === 'unbezahlt' && w.employeeId !== viewerId) ? { ...w, art: 'ferien' as const } : w)
}
