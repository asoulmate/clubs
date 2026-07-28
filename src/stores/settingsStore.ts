import { create } from 'zustand'
import { fetchClubSettings } from '../services/clubSettingsService'
import type { AppSettings } from '../types/domain'
import { DEFAULT_SETTINGS } from '../types/domain'

// ============================================================
// 운영 설정 스토어 (클럽 진입 시 로드, 관리자 변경 시 재로드)
// ============================================================

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: (clubId?: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async (clubId?: string) => {
    if (!clubId) {
      set({ settings: DEFAULT_SETTINGS, loaded: false })
      return
    }
    try {
      const settings = await fetchClubSettings(clubId)
      set({ settings, loaded: true })
    } catch {
      // 로드 실패 시 기본값으로 동작 (DB의 RPC가 최종 검증을 수행하므로 안전)
      set({ settings: DEFAULT_SETTINGS, loaded: true })
    }
  },
}))
