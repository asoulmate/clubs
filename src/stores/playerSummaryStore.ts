import { create } from 'zustand'

// ============================================================
// 선수 이름 클릭 시 표시하는 요약 다이얼로그의 전역 상태
// (어느 화면에서든 이름을 클릭하면 같은 다이얼로그를 사용)
// ============================================================

interface PlayerSummaryState {
  /** 요약을 표시할 사용자 id (null이면 닫힘) */
  userId: string | null
  open: (userId: string) => void
  close: () => void
}

export const usePlayerSummaryStore = create<PlayerSummaryState>((set) => ({
  userId: null,
  open: (userId) => set({ userId }),
  close: () => set({ userId: null }),
}))
