import { create } from 'zustand'
import { getClubBySlug, listMyClubs } from '../services/clubService'
import { useAuthStore } from './authStore'
import type { Club, ClubMembership, UserRole } from '../types/domain'

interface ClubState {
  club: Club | null
  membership: ClubMembership | null
  myClubs: ClubMembership[]
  loaded: boolean
  /** 멤버십을 로드한 사용자 id (계정 전환 시 캐시 무효화) */
  loadedForUserId: string | null
  loadMyClubs: () => Promise<void>
  /** URL 슬러그로 클럽 진입. 멤버십 역할로 profile.role 동기화 */
  enterClubBySlug: (slug: string) => Promise<void>
  /** 로그아웃·계정 전환 시 클럽 캐시 전부 초기화 */
  clearClub: () => void
}

export const useClubStore = create<ClubState>((set) => ({
  club: null,
  membership: null,
  myClubs: [],
  loaded: false,
  loadedForUserId: null,

  loadMyClubs: async () => {
    const userId = useAuthStore.getState().session?.user?.id ?? null
    const myClubs = await listMyClubs()
    set({ myClubs, loaded: true, loadedForUserId: userId })
  },

  enterClubBySlug: async (slug: string) => {
    const club = await getClubBySlug(slug)
    const userId = useAuthStore.getState().session?.user?.id ?? null

    // 항상 현재 세션 기준으로 멤버십 재조회 (이전 계정 캐시 사용 금지)
    const myClubs = await listMyClubs()
    const membership = myClubs.find((c) => c.club_id === club.id) ?? null

    // 클럽 UI 권한은 club_members.role. 플랫폼 슈퍼는 permissions에서 별도 허용.
    const auth = useAuthStore.getState()
    if (auth.profile) {
      const role: UserRole =
        membership?.status === 'active' ? (membership.role as UserRole) : 'user'
      useAuthStore.setState({
        profile: { ...auth.profile, role },
      })
    }

    set({ club, membership, myClubs, loaded: true, loadedForUserId: userId })
  },

  clearClub: () =>
    set({
      club: null,
      membership: null,
      myClubs: [],
      loaded: false,
      loadedForUserId: null,
    }),
}))
