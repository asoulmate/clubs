import { useToastStore } from '../../stores/toastStore'

const TYPE_STYLES = {
  success: 'bg-green-700 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-gray-800 text-white',
} as const

/** 화면 상단 토스트 알림 목록 */
export function Toaster() {
  const { toasts, remove } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-3">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => remove(toast.id)}
          className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-left text-base shadow-lg ${TYPE_STYLES[toast.type]}`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  )
}
