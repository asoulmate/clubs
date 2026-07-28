import type { ReactNode } from 'react'

/** 인증 화면 공통 카드 레이아웃 */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl" aria-hidden="true">
            🎾
          </div>
          <h1 className="mt-1 text-xl font-extrabold text-green-800">클럽스</h1>
          <p className="mt-1 text-base font-semibold text-gray-700">{title}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

/** 인증 폼 공통 인풋 스타일 */
export const authInputClass =
  'h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none'

/** 인증 폼 공통 제출 버튼 스타일 */
export const authButtonClass =
  'h-12 w-full rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50'
