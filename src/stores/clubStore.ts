import { create } from 'zustand'
import { getClubBySlug, listMyClubs } from '../services/clubService'
import { useAuthStore } from './authStore'
import type { Club, ClubMembership, UserRole } from '../types/domain'

interface ClubState {
  club: Club | null
  membership: ClubMembership | null
  myClubs: ClubMembership[]
  loaded: boolean
  loadMyClubs: () => Promise<void>
  /** URL 슬러그로 클럽 진입. 멤버십 역할로 profile.role 동기화 */
  enterClubBySlug: (slug: string) => Promise<void>
  clearClub: () => void
}

export const useClubStore = create<ClubState>((set, get) => ({
  club: null,
  membership: null,
  myClubs: [],
  loaded: false,

  loadMyClubs: async () => {
    const myClubs = await listMyClubs()
    set({ myClubs, loaded: true })
  },

  enterClubBySlug: async (slug: string) => {
    const club = await getClubBySlug(slug)
    let myClubs = get().myClubs
    if (!get().loaded) {
      myClubs = await listMyClubs()
    }
    const membership = myClubs.find((c) => c.club_id === club.id) ?? null

    // 활성 멤버·플랫폼 슈퍼의 클럽 역할을 프로필 role에 반영 (기존 권한 UI 재사용)
    const auth = useAuthStore.getState()
    if (auth.profile) {
      let role: UserRole = auth.profile.role
      if (auth.profile.is_platform_admin) role = 'admin'
      else if (membership?.status === 'active') role = membership.role as UserRole
      useAuthStore.setState({
        profile: { ...auth.profile, role },
      })
    }

    set({ club, membership, myClubs, loaded: true })
  },

  clearClub: () => set({ club: null, membership: null }),
}))
