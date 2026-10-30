'use client'

// Kleine Warteschlange für Speicheraufrufe: Aufrufe laufen nacheinander,
// nie gleichzeitig (sonst könnten sich zwei Schreibzugriffe auf dieselbe
// Zeile gegenseitig überschreiben). Die Oberfläche bleibt dabei bedienbar.

import { useCallback, useRef } from 'react'

export function useSerial() {
  const kette = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = kette.current.then(fn, fn)
    kette.current = p.catch(() => undefined)
    return p
  }, [])
}
