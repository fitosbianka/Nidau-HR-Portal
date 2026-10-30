// Lohn- & Pensumsverlauf → aktuelle HR-Werte im Profil.
// Der «wirksame» Eintrag ist der neuste mit Datum bis heute (Zürich);
// zukünftige Einträge (z.B. Lohnerhöhung ab 01.01.) werden erst wirksam,
// wenn ihr Datum erreicht ist. Bei gleichem Datum gewinnt der zuletzt
// erfasste Eintrag.

export type VerlaufFelder = {
  pensum: number | null
  bruttolohn_100: number | null
  monatslohn: number | null
}

export type VerlaufEintrag = VerlaufFelder & {
  id: string
  effective_date: string
  created_at?: string | null
}

export function zurichToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' })
}

/** Neuster Eintrag mit effective_date <= heute, oder null. */
export function wirksamerEintrag<T extends VerlaufEintrag>(eintraege: T[], today: string): T | null {
  let best: T | null = null
  for (const e of eintraege) {
    if (!e.effective_date || e.effective_date > today) continue
    if (
      !best ||
      e.effective_date > best.effective_date ||
      (e.effective_date === best.effective_date && (e.created_at ?? '') > (best.created_at ?? ''))
    ) {
      best = e
    }
  }
  return best
}

/** Nur die im Eintrag ausgefüllten Felder — leere Felder lassen die
 *  aktuellen Profilwerte unangetastet. */
export function verlaufPatch(e: VerlaufFelder): Partial<VerlaufFelder> {
  const patch: Partial<VerlaufFelder> = {}
  if (e.pensum != null) patch.pensum = e.pensum
  if (e.bruttolohn_100 != null) patch.bruttolohn_100 = e.bruttolohn_100
  if (e.monatslohn != null) patch.monatslohn = e.monatslohn
  return patch
}

/** Felder, in denen der wirksame Eintrag von den aktuellen Profilwerten
 *  abweicht (deutsche Labels für die Anzeige). Leere Eintragsfelder
 *  zählen nicht als Abweichung. */
export function verlaufAbweichungen(profil: VerlaufFelder, e: VerlaufFelder): string[] {
  const diff: string[] = []
  if (e.pensum != null && e.pensum !== profil.pensum) diff.push('Pensum')
  if (e.bruttolohn_100 != null && e.bruttolohn_100 !== profil.bruttolohn_100) diff.push('100% Bruttolohn')
  if (e.monatslohn != null && e.monatslohn !== profil.monatslohn) diff.push('Monatslohn')
  return diff
}
