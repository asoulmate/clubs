import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { updatePassword } from '../../services/authService'
import { useToastStore } from '../../stores/toastStore'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

/** 비밀번호 재설정 메일 링크로 진입 후 새 비밀번호 설정 */
export function UpdatePasswordPage() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)
  const [password, setPassword] = useState('')
  const [passwordCheck, setPasswordCheck] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('비밀번호는 6자 이상 입력해주세요.')
      return
    }
    if (password !== passwordCheck) {
      setError('비밀번호가 서로 일치하지 않습니다.')
      return
    }

    setLoading(true)
    try {
      await updatePassword(password)
      showToast('비밀번호가 변경되었습니다.', 'success')
      navigate('/', { replace: true })
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard title="새 비밀번호 설정">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">새 비밀번호 (6자 이상)</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">새 비밀번호 확인</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={passwordCheck}
            onChange={(e) => setPasswordCheck(e.target.value)}
            className={authInputClass}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </AuthCard>
  )
}
