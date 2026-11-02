import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Wächter: Notizen zur Planung (Admin + Leitende) dürfen weder im
// Arbeitsplan PDF noch bei anderen Mitarbeitenden auftauchen. Der Test
// liest die Quelldateien und sperrt die bekannten Wege.
const lies = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8')

describe('Notizen zur Planung bleiben intern', () => {
  it('der Arbeitsplan PDF Export lädt und zeichnet keine Notizen', () => {
    const route = lies('src/app/api/arbeitsplan-pdf/route.ts')
    expect(route).not.toMatch(/plan-notes|getMonthPlanNotes|planNotes|bands/)
    const pdf = lies('src/lib/pdf/hr-pdfs.mjs')
    expect(pdf).not.toMatch(/d\.bands|bands\.length/)
  })
  it('die Mitarbeiterseite lädt Notizen nur für Leitende und gibt sie nur mit Freigabe weiter', () => {
    const seite = lies('src/app/employee/arbeitsplan/page.tsx')
    expect(seite).toMatch(/canEdit && isLeitende \? getMonthPlanNotes\(/)
    expect(seite).toMatch(/notizenErlaubt=\{isLeitende\}/)
    expect(seite).not.toMatch(/includeAdminOnly/)
  })
  it('das Plangitter ignoriert übergebene Notizen ohne Freigabe', () => {
    const grid = lies('src/components/schedule/WorkScheduleGrid.tsx')
    expect(grid).toMatch(/const planNotes = notizenErlaubt \? planNotesProp : undefined/)
  })
  it('das Änderungsprotokoll des Plans ist nur für Admins', () => {
    const actions = lies('src/actions/schedule.ts')
    const start = actions.indexOf('export async function getPlanAenderungen')
    expect(start).toBeGreaterThan(0)
    expect(actions.slice(start, start + 400)).toMatch(/requireAdmin\(\)/)
  })
})
