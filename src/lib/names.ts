// TimeMoto sometimes uses a different spelling of an employee's name than
// the profile (e.g. "Laura Gerisch" vs "Laura Gerisch-Rudin"). All
// Zeiterfassung pages display the canonical PROFILE name; attendance names
// are mapped onto it via a unique first-name match.

/** Returns a mapper from raw attendance names to canonical profile names. */
export function makeNameCanonicalizer(profileNames: string[]): (raw: string | null) => string | null {
  const exact = new Set(profileNames)
  const byFirst = new Map<string, string[]>()
  for (const n of profileNames) {
    const f = n.split(' ')[0]
    const list = byFirst.get(f) ?? []
    list.push(n)
    byFirst.set(f, list)
  }
  return (raw: string | null) => {
    if (!raw) return raw
    if (exact.has(raw)) return raw
    const matches = byFirst.get(raw.split(' ')[0])
    return matches && matches.length === 1 ? matches[0] : raw
  }
}
