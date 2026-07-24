import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { isAdminOrSub } from '../../utils/permissions'
import { PlayerSummaryDialog } from '../players/PlayerSummaryDialog'

interface NavItem {
  to: string
  label: string
  icon: string
  adminOnly?: boolean
}

// 하단(모바일)/상단(PC) 내비게이션 항목
// 색상만이 아닌 텍스트+아이콘으로 상태 구분
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '오늘의 경기', icon: '🎾' },
  { to: '/results', label: '결과 집계', icon: '🏆' },
  { to: 'my-record', label: '내 기록', icon: '📈' }, // 실제 경로는 아래에서 프로필 id로 치환
  { to: '/admin', label: '관리자', icon: '🛡️', adminOnly: true },
  { to: '/settings', label: '설정', icon: '⚙️' },
]

/** 공통 레이아웃: PC 상단 내비게이션 + 모바일 하단 고정 내비게이션 */
export function AppLayout() {
  const profile = useAuthStore((s) => s.profile)

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdminOrSub(profile)).map(
    (item) =>
      item.to === 'my-record'
        ? { ...item, to: profile ? `/players/${profile.id}` : '/' }
        : item,
  )

  const linkClass = (isActive: boolean) =>
    `flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-xs font-medium md:flex-row md:gap-1.5 md:px-3 md:text-sm ${
      isActive ? 'text-green-700 md:bg-green-50' : 'text-gray-500 hover:text-gray-800'
    }`

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl">
      {/* PC 상단 헤더 */}
      <header className="sticky top-0 z-40 hidden items-center justify-between border-b border-gray-200 bg-white px-4 py-2 md:flex">
        <span className="text-lg font-extrabold text-green-800">🎾 모닝스타 테니스</span>
        <nav className="flex items-center gap-1">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* 본문 (모바일 하단 내비게이션 높이만큼 여백 확보) */}
      <main className="pb-nav px-4 pt-4 md:pb-8">
        <Outlet />
      </main>

      {/* 모바일 하단 고정 내비게이션 (Safe Area 대응) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white md:hidden">
        <div className="mx-auto grid max-w-3xl auto-cols-fr grid-flow-col">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
              <span className="text-lg" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* 어느 화면에서든 선수 이름 클릭 시 표시되는 요약 다이얼로그 */}
      <PlayerSummaryDialog />
    </div>
  )
}
