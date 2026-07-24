import { create } from 'zustand'
import { fetchAppSettings } from '../services/settingsService'
import type { AppSettings } from '../types/domain'
import { DEFAULT_SETTINGS } from '../types/domain'

// ============================================================
// 운영 설정 스토어 (로그인 후 1회 로드, 관리자 변경 시 재로드)
// ============================================================

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const settings = await fetchAppSettings()
      set({ settings, loaded: true })
    } catch {
      // 로드 실패 시 기본값으로 동작 (DB의 RPC가 최종 검증을 수행하므로 안전)
      set({ settings: DEFAULT_SETTINGS, loaded: true })
    }
  },
}))
