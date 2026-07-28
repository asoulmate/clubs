import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
import { isAdminOrSub } from '../../utils/permissions'
import { PlayerSummaryDialog } from '../players/PlayerSummaryDialog'

interface NavItem {
  to: string
  label: string
  icon: string
  adminOnly?: boolean
  end?: boolean
}

/** 공통 레이아웃: PC 상단 내비게이션 + 모바일 하단 고정 내비게이션 */
export function AppLayout() {
  const profile = useAuthStore((s) => s.profile)
  const club = useClubStore((s) => s.club)
  const { clubSlug: paramSlug } = useParams<{ clubSlug: string }>()
  const slug = club?.slug ?? paramSlug ?? ''
  const base = slug ? `/c/${slug}` : '/'

  const navItems: NavItem[] = [
    { to: base, label: '오늘의 경기', icon: '🎾', end: true },
    { to: `${base}/results`, label: '결과 집계', icon: '🏆' },
    {
      to: profile ? `${base}/players/${profile.id}` : base,
      label: '내 기록',
      icon: '📈',
    },
    { to: `${base}/admin`, label: '관리자', icon: '🛡️', adminOnly: true },
    { to: `${base}/settings`, label: '설정', icon: '⚙️' },
  ]

  const items = navItems.filter((item) => !item.adminOnly || isAdminOrSub(profile))
  const brand = club?.name ?? '클럽스'

  const linkClass = (isActive: boolean) =>
    `flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-xs font-medium md:flex-row md:gap-1.5 md:px-3 md:text-sm ${
      isActive ? 'text-green-700 md:bg-green-50' : 'text-gray-500 hover:text-gray-800'
    }`

  const clubSwitcher = (
    <Link
      to="/"
      title="클럽 선택"
      aria-label={`${brand} — 클럽 선택`}
      className="inline-flex max-w-full items-center gap-1 rounded-xl px-1 py-0.5 text-green-800 active:bg-green-50"
    >
      <span className="truncate text-base font-extrabold md:text-lg">🎾 {brand}</span>
      <span className="shrink-0 text-[10px] font-bold text-green-700/60" aria-hidden="true">
        ▼
      </span>
    </Link>
  )

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl">
      <header className="sticky top-0 z-40 hidden items-center justify-between border-b border-gray-200 bg-white px-4 py-2 md:flex">
        {clubSwitcher}
        <nav className="flex items-center gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => linkClass(isActive)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="pb-nav px-4 pt-4 md:pb-8">
        <div className="mb-3 md:hidden">{clubSwitcher}</div>
        <Outlet />
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white md:hidden">
        <div className="mx-auto grid max-w-3xl auto-cols-fr grid-flow-col">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => linkClass(isActive)}
            >
              <span className="text-lg" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <PlayerSummaryDialog />
    </div>
  )
}
