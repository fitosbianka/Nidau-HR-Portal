// Supabase (PostgREST) liefert pro Abfrage höchstens 1000 Zeilen. Ohne
// Seitenabruf fehlen bei grösseren Ergebnissen stillschweigend Zeilen, und
// ohne feste Sortierung ist zufällig, welche fehlen. Darum werden grosse
// Abfragen hier seitenweise geladen; die Abfrage selbst muss eine eindeutige
// Sortierung haben (zweiter Schlüssel bei gleichen Werten), damit die
// Seitengrenzen stabil sind.

export const SEITENGROESSE = 1000

type Antwort<T> = { data: T[] | null; error: { message: string } | null }

/** Lädt alle Seiten einer Abfrage. `seite(von, bis)` baut die Abfrage mit
 *  `.range(von, bis)` auf. Bricht bei der ersten unvollständigen Seite ab;
 *  ein Datenbankfehler wird geworfen statt verschluckt. */
export async function ladeAlleSeiten<T>(seite: (von: number, bis: number) => PromiseLike<Antwort<T>>): Promise<T[]> {
  const alle: T[] = []
  for (let von = 0; ; von += SEITENGROESSE) {
    const { data, error } = await seite(von, von + SEITENGROESSE - 1)
    if (error) throw new Error(error.message)
    const zeilen = data ?? []
    alle.push(...zeilen)
    if (zeilen.length < SEITENGROESSE) break
  }
  return alle
}

/** Muster für `.not('user_full_name', 'like', RESERVIERT)`: reservierte
 *  Zeilen (Protokolle, Einstellungen, Teamevents …) beginnen mit zwei
 *  Unterstrichen; die Backslashes machen die Unterstriche im LIKE wörtlich. */
export const RESERVIERT_LIKE = '\\_\\_%'
