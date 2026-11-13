'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PRAXIS } from '@/config/praxis'
import { pfadGesperrt } from '@/config/module'
import { EXTERN_GESPERRT } from '@/lib/externe'
import { useRouter } from 'next/navigation'

interface SidebarProps {
  role: 'admin' | 'employee'
  userName: string
  /** Leitende DA: team views for Zeiterfassung + Ferienkonto */
  isLeitende?: boolean
  /** Designated Ferien editor (e.g. Laura) */
  isFerienEditor?: boolean
  /** Zugang zum Bestellwesen (Leitende + Bestell-Verantwortliche) */
  isBesteller?: boolean
  /** Externe (selbständig): ohne Meine Zeiten und Teamevents */
  isExtern?: boolean
}

type NavItem = {
  href: string
  label: string
  icon: ReactNode
  exact?: boolean
  /** Einrückungsstufe für Untermenüpunkte (1 = Submenü, 2 = Sub-Submenü) */
  sub?: 1 | 2
}

type NavSection = {
  label: string
  items: NavItem[]
}

/* ── 15px lucide-style line icons (stroke 1.7, currentColor) ── */

function icon(children: ReactNode) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      {children}
    </svg>
  )
}

const HomeIcon = icon(<>
  <path d="M3 10.5 12 3l9 7.5" />
  <path d="M5 9.5V21h14V9.5" />
  <path d="M10 21v-6h4v6" />
</>)

const UsersIcon = icon(<>
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
  <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
</>)

const ArchiveIcon = icon(<>
  <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" />
</>)

const FileTextIcon = icon(<>
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
  <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" />
</>)

const CalendarIcon = icon(<>
  <rect x="3" y="4" width="18" height="18" rx="2" />
  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
  <line x1="3" y1="10" x2="21" y2="10" />
</>)

const ClockIcon = icon(<>
  <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
</>)

const BarChartIcon = icon(<>
  <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" />
  <line x1="6" y1="20" x2="6" y2="16" />
</>)

const TrendingUpIcon = icon(<>
  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
  <polyline points="16 7 22 7 22 13" />
</>)

const TimerIcon = icon(<>
  <line x1="10" y1="2" x2="14" y2="2" /><line x1="12" y1="14" x2="15" y2="11" />
  <circle cx="12" cy="14" r="8" />
</>)

const PackageIcon = icon(<>
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
  <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
</>)

const ScaleIcon = icon(<>
  <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
  <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
  <path d="M7 21h10" /><path d="M12 3v18" />
  <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
</>)

const SunIcon = icon(<>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" />
  <path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" />
  <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
</>)

const LockIcon = icon(<>
  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
</>)

const CheckCircleIcon = icon(<>
  <path d="M21.8 10A10 10 0 1 1 17 3.34" /><path d="m9 11 3 3L22 4" />
</>)

const LogOutIcon = icon(<>
  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
  <path d="m16 17 5-5-5-5" /><line x1="21" y1="12" x2="9" y2="12" />
</>)

const SearchCheckIcon = icon(<>
  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="m8 11 2 2 4-4" />
</>)

const SlidersIcon = icon(<>
  <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
  <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
  <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
  <line x1="2" y1="14" x2="6" y2="14" /><line x1="10" y1="8" x2="14" y2="8" /><line x1="18" y1="16" x2="22" y2="16" />
</>)

const BanknoteIcon = icon(<>
  <rect x="2" y="6" width="20" height="12" rx="2" />
  <circle cx="12" cy="12" r="2.5" />
  <path d="M6 12h.01" /><path d="M18 12h.01" />
</>)

const CameraIcon = icon(<>
  <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
  <circle cx="12" cy="13" r="3.2" />
</>)

const CarIcon = icon(<>
  <path d="M5 11l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11" />
  <rect x="3" y="11" width="18" height="6" rx="2" />
  <circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" />
</>)

const UserClockIcon = icon(<>
  <circle cx="9" cy="8" r="3.5" />
  <path d="M3.5 20a5.5 5.5 0 0 1 8.2-4.8" />
  <circle cx="17" cy="16" r="4.5" />
  <path d="M17 14v2.3l1.6 1" />
</>)

const adminNavSections: NavSection[] = [
  {
    label: 'Administration',
    items: [
      { href: '/admin', label: 'Startseite', icon: HomeIcon, exact: true },
      { href: '/admin/mitarbeiter', label: 'Mitarbeiter', icon: UsersIcon, exact: true },
      { href: '/admin/mitarbeiter/ehemalige', label: 'Ehemalige', icon: ArchiveIcon, sub: 1 },
      { href: '/admin/hr-dokumente', label: 'HR Dokumente', icon: FileTextIcon },
      { href: '/admin/arbeitsplan', label: 'Arbeitsplan', icon: CalendarIcon, exact: true },
    ],
  },
  {
    label: 'Berichte',
    items: [
      { href: '/admin/zeiterfassung/berichte', label: 'Zeiterfassung', icon: BarChartIcon },
      { href: '/admin/zeiterfassung/korrekturen', label: 'Korrekturen', icon: CheckCircleIcon, exact: true, sub: 1 },
      { href: '/admin/zeiterfassung/kontrolle', label: 'Kontrolle Vormonat', icon: SearchCheckIcon, sub: 1 },
      { href: '/admin/zeiterfassung/korrekturen/regeln', label: 'Kontroll-Regeln', icon: SlidersIcon, sub: 2 },
      { href: '/admin/zeiterfassung', label: 'Jetzt anwesend', icon: ClockIcon, exact: true },
      { href: '/admin/zeiterfassung/konto', label: 'Arbeitszeit-und Ferienkonto', icon: ScaleIcon },
    ],
  },
  {
    label: 'Verwaltung',
    items: [
      { href: '/admin/zeiterfassung/ferien', label: 'Ferienplanung', icon: SunIcon },
      { href: '/admin/bestellungen', label: 'Bestellungen', icon: PackageIcon },
      { href: '/admin/lohn', label: 'Lohnabrechnungen', icon: BanknoteIcon },
      { href: '/admin/arbeitsplan/standards', label: 'Mitarbeiter-Standards', icon: UsersIcon },
      { href: '/admin/personal', label: 'Personal-Änderungen', icon: UserClockIcon },
    ],
  },
  {
    label: 'Konto',
    items: [
      { href: '/admin/passwort', label: 'Passwort ändern', icon: LockIcon },
    ],
  },
]

function employeeNavSectionsFor(isFerienEditor: boolean, isBesteller: boolean): NavSection[] {
  const items: NavItem[] = [
    { href: '/employee', label: 'Meine Dokumente', icon: FileTextIcon, exact: true },
    { href: '/employee/zeiterfassung', label: 'Meine Zeiten', icon: ClockIcon },
    { href: '/employee/arbeitsplan', label: 'Arbeitsplan', icon: CalendarIcon },
  ]
  // Ferien Editorinnen haben ihre volle Ferienplanung unter «Leitung»
  if (!isFerienEditor) {
    items.push({ href: '/employee/ferien', label: 'Ferienplanung', icon: SunIcon })
  }
  // Bestellwesen: Leitende und die Bestellverantwortliche
  if (isBesteller) {
    items.push({ href: '/employee/bestellungen', label: 'Bestellungen', icon: PackageIcon })
  }
  items.push({ href: '/employee/passwort', label: 'Passwort ändern', icon: LockIcon })
  return [{ label: 'Mein Bereich', items }]
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default function Sidebar({ role, userName, isLeitende = false, isFerienEditor = false, isBesteller = false, isExtern = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  let navSections = role === 'admin' ? adminNavSections : employeeNavSectionsFor(isFerienEditor, isBesteller)
  // Externe: keine Zeiterfassung
  if (role === 'employee' && isExtern) {
    navSections = navSections.map(s => ({ ...s, items: s.items.filter(i => !EXTERN_GESPERRT.some(p => i.href === p || i.href.startsWith(`${p}/`))) }))
  }
  if (role === 'employee' && (isLeitende || isFerienEditor)) {
    const items: NavItem[] = []
    if (isLeitende) {
      items.push(
        { href: '/employee/team/zeiterfassung', label: 'Zeiterfassung (Team)', icon: BarChartIcon },
        { href: '/employee/team/konto', label: 'Ferienkonto (Team)', icon: ScaleIcon },
      )
    }
    if (isFerienEditor) {
      items.push({ href: '/employee/team/ferien', label: 'Ferienplanung', icon: SunIcon })
    }
    navSections = [...employeeNavSectionsFor(isFerienEditor, isBesteller), { label: 'Leitung', items }]
  }

  // Abgeschaltete Module (siehe src/config/module.ts) erscheinen nicht im Menü
  navSections = navSections.map(s => ({ ...s, items: s.items.filter(i => !pfadGesperrt(i.href)) })).filter(s => s.items.length > 0)

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const sidebarContent = (
    <div className="flex flex-col h-full bg-surface border-r border-edge px-4 pt-7 pb-5">
      {/* ── Clinic branding ──────────────────────────────── */}
      <div className="flex flex-col items-center gap-2.5 pt-2 pb-[18px] border-b border-edge-soft">
        <Image
          src="/logo.png"
          alt={PRAXIS.name}
          width={128}
          height={89}
          className="w-32 h-auto"
          priority
        />
        <p className="text-[10px] tracking-[.28em] text-ink-4 font-medium">MITARBEITERPORTAL</p>
      </div>

      {/* ── Navigation ───────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.label}>
            <p className="text-[10px] font-semibold tracking-[.18em] text-ink-4 uppercase mt-[22px] mb-2 ml-3">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    style={item.sub ? { paddingLeft: 12 + item.sub * 14 } : undefined}
                    className={`flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-[13.5px] transition-colors duration-100 ${
                      isActive
                        ? 'bg-active text-ink font-semibold border-l-[3px] border-dusk-night -ml-[3px]'
                        : 'text-ink-2 hover:bg-edge-row'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User section ─────────────────────────────────── */}
      <div className="border-t border-edge-soft pt-4">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-8 h-8 rounded-full bg-dusk-night text-[#FDFDFC] flex items-center justify-center text-[13px] font-semibold flex-shrink-0">
            {initials(userName)}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink truncate">{userName}</p>
            <p className="text-[11px] text-ink-4 truncate">
              {role === 'admin' ? 'Administrator' : isLeitende ? 'Leitende DA' : 'Mitarbeiter/in'}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2.5 px-2 pt-3 text-[13px] text-ink-2 hover:text-ink transition-colors disabled:opacity-50"
        >
          {LogOutIcon}
          {loggingOut ? 'Wird abgemeldet…' : 'Abmelden'}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* ── Desktop sidebar ───────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 z-10">
        {sidebarContent}
      </aside>

      {/* ── Mobile top bar ────────────────────────────────── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-20 bg-surface border-b border-edge px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center">
          <Image
            src="/logo.png"
            alt={PRAXIS.name}
            width={120}
            height={84}
            className="h-9 w-auto"
          />
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg text-ink-4 hover:bg-edge-row hover:text-ink-2 transition-colors"
          aria-label="Menü öffnen"
        >
          {mobileOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Mobile overlay ────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-10 bg-black/30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ─────────────────────────────────── */}
      <div className={`lg:hidden fixed top-0 left-0 bottom-0 z-30 w-72
                       transform transition-transform duration-300 ease-in-out
                       ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {sidebarContent}
      </div>
    </>
  )
}
