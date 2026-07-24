import { useEffect, type ReactNode } from 'react'
import { useIsDesktop } from '../../hooks/useMediaQuery'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * 반응형 다이얼로그
 *  - PC: 화면 중앙 모달
 *  - 모바일: 하단 시트 (hover가 없는 터치 환경 대응)
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const isDesktop = useIsDesktop()

  // 열려 있는 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex ${isDesktop ? 'items-center justify-center p-4' : 'items-end'}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 배경 클릭 시 닫기 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      <div
        className={`relative z-10 w-full overflow-y-auto bg-white shadow-xl ${
          isDesktop ? 'max-h-[85vh] max-w-lg rounded-2xl' : 'pb-safe max-h-[88dvh] rounded-t-2xl'
        }`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {/* 터치 영역 44px 이상 확보 */}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none text-gray-500 hover:bg-gray-100"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
