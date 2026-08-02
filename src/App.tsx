import { useEffect } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { ClubGate } from './components/layout/ClubGate'
import { Toaster } from './components/common/Toaster'
import { Spinner } from './components/common/Spinner'
import { useAuthStore } from './stores/authStore'
import { useClubStore } from './stores/clubStore'
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
import { ClubSelectPage } from './pages/ClubSelectPage'
import { PlatformAdminPage } from './pages/PlatformAdminPage'
import { GlobalRatingsPage } from './pages/GlobalRatingsPage'

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
  if (profile && !profile.is_active) return <InactiveAccountPage />

  return <Outlet />
}

/** 관리자/서브 관리자 전용 라우트 가드 */
function RequireAdmin() {
  const { profile } = useAuthStore()
  const club = useClubStore((s) => s.club)
  if (!isAdminOrSub(profile)) {
    return <Navigate to={club ? `/c/${club.slug}` : '/'} replace />
  }
  return <Outlet />
}

/** 비로그인 전용 (로그인 상태면 클럽 선택으로) */
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

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <HashRouter>
      <Routes>
        <Route element={<RequireGuest />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/c/:clubSlug/signup" element={<SignupPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route path="/update-password" element={<UpdatePasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/" element={<ClubSelectPage />} />
          <Route path="/platform" element={<PlatformAdminPage />} />
          <Route path="/platform/ratings" element={<GlobalRatingsPage />} />

          <Route path="/c/:clubSlug" element={<ClubGate />}>
            <Route element={<AppLayout />}>
              <Route index element={<MatchesPage />} />
              <Route path="results" element={<ResultsPage />} />
              <Route path="players/:userId" element={<PlayerDetailPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route element={<RequireAdmin />}>
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </HashRouter>
  )
}
