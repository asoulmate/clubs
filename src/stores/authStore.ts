import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchMyProfile } from '../services/profileService'
import type { Profile } from '../types/domain'

// ============================================================
// 인증 상태 스토어
// 세션과 함께 DB의 실제 프로필(역할 포함)을 보관한다.
// 관리자 여부 판정은 항상 이 profile.role(DB 조회 값)을 사용한다.
// ============================================================

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** 초기 세션 확인이 끝났는지 (라우팅 가드가 이 값을 기다림) */
  initialized: boolean
  initialize: () => void
  refreshProfile: () => Promise<void>
}

let initStarted = false

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initialized: false,

  /** 앱 시작 시 1회 호출: 세션 복원 + 인증 상태 변경 구독 */
  initialize: () => {
    if (initStarted) return
    initStarted = true

    const applySession = async (session: Session | null) => {
      const { useClubStore } = await import('./clubStore')
      const clubState = useClubStore.getState()
      const prevUserId = get().session?.user?.id
      const nextUserId = session?.user?.id

      // 로그아웃 또는 다른 계정으로 전환 시 클럽 캐시 전부 제거
      if (!nextUserId || (prevUserId && prevUserId !== nextUserId)) {
        clubState.clearClub()
      } else if (
        nextUserId &&
        clubState.loadedForUserId &&
        clubState.loadedForUserId !== nextUserId
      ) {
        clubState.clearClub()
      }

      if (session?.user) {
        try {
          let profile = await fetchMyProfile(session.user.id)
          const membership = useClubStore.getState().membership
          // 클럽 멤버십이 현재 사용자 캐시와 일치할 때만 역할 반영
          if (
            profile &&
            membership?.status === 'active' &&
            useClubStore.getState().loadedForUserId === session.user.id
          ) {
            profile = { ...profile, role: membership.role }
          }
          set({ session, profile, initialized: true })
        } catch {
          set({ session, profile: null, initialized: true })
        }
      } else {
        useClubStore.getState().clearClub()
        set({ session: null, profile: null, initialized: true })
      }
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session))

    supabase.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESHED 등에서 프로필 재조회를 피하고 세션만 갱신
      if (event === 'TOKEN_REFRESHED') {
        set({ session })
        return
      }
      void applySession(session)
    })
  },

  /** 프로필 정보 재조회 (이름/입상 구분 수정 후 등) */
  refreshProfile: async () => {
    const { session } = get()
    if (!session?.user) return
    let profile = await fetchMyProfile(session.user.id)
    const { useClubStore } = await import('./clubStore')
    const clubState = useClubStore.getState()
    if (
      profile &&
      clubState.membership?.status === 'active' &&
      clubState.loadedForUserId === session.user.id
    ) {
      profile = { ...profile, role: clubState.membership.role }
    }
    set({ profile })
  },
}))
