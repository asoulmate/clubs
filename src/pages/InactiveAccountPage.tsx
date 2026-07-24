import { signOut } from '../services/authService'

/** 비활성화·승인 대기 계정으로 로그인한 경우 안내 화면 */
export function InactiveAccountPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-4xl" aria-hidden="true">
        ⛔
      </span>
      <h1 className="text-xl font-bold">이용 승인 대기 또는 비활성 계정</h1>
      <p className="text-base text-gray-600">
        계정이 아직 승인되지 않았거나 비활성화되어 서비스를 이용할 수 없습니다.
        <br />
        모임 관리자(또는 서브 관리자)에게 문의해 활성화를 요청해주세요.
      </p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="h-12 rounded-xl bg-gray-800 px-6 font-bold text-white"
      >
        로그아웃
      </button>
    </div>
  )
}
