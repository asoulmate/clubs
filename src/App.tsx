import { useEffect } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Toaster } from './components/common/Toaster'
import { Spinner } from './components/common/Spinner'
import { useAuthStore } from './stores/authStore'
import { useSettingsStore } from './stores/settingsStore'
import { isAdminOrSub } from './utils/permissions'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { UpdatePasswordPage } from './pages/auth/UpdatePasswordPage'
import { MatchesPage } from './pages/MatchesPage'
import { ResultsPage } from './pages/ResultsPage'
import { PlayerDetailPage } from './pages/PlayerDetailPage'
import { AdminPage } from './pages/AdminPage'
import { SettingsPage } from './pages/SettingsPage'
import { InactiveAccountPage } from './pages/InactiveAccountPage'

/** 로그인 필요 라우트 가드 */
function RequireAuth() {
  const { session, profile, initialized } = useAuthStore()

  if (!initialized) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  // 비활성화된 계정은 안내 화면으로
  if (profile && !profile.is_active) return <InactiveAccountPage />

  return <Outlet />
}

/** 관리자/서브 관리자 전용 라우트 가드 (UI 차단용 — 실제 권한은 DB가 검증) */
function RequireAdmin() {
  const { profile } = useAuthStore()
  if (!isAdminOrSub(profile)) return <Navigate to="/" replace />
  return <Outlet />
}

/** 비로그인 전용 (로그인 상태면 메인으로) */
function RequireGuest() {
  const { session, initialized } = useAuthStore()

  if (!initialized) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (session) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)
  const session = useAuthStore((s) => s.session)
  const loadSettings = useSettingsStore((s) => s.load)

  useEffect(() => {
    initialize()
  }, [initialize])

  // 로그인 후 운영 설정 로드
  useEffect(() => {
    if (session) void loadSettings()
  }, [session, loadSettings])

  return (
    <HashRouter>
      <Routes>
        <Route element={<RequireGuest />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        {/* 비밀번호 재설정 메일 링크 진입: 세션 유무와 무관하게 접근 */}
        <Route path="/update-password" element={<UpdatePasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<MatchesPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/players/:userId" element={<PlayerDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </HashRouter>
  )
}
