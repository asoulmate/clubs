import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AWARD_LEVEL_OPTIONS } from '../../constants/labels'
import { signUpWithEmail } from '../../services/authService'
import { listClubsForSignup } from '../../services/clubService'
import type { AwardLevel, Club } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { AuthCard, authButtonClass, authInputClass } from './AuthCard'

type ClubOption = Pick<Club, 'id' | 'name' | 'slug'>

export function SignupPage() {
  const { clubSlug: paramSlug } = useParams<{ clubSlug?: string }>()
  const [searchParams] = useSearchParams()
  const presetSlug = (paramSlug ?? searchParams.get('club') ?? '').trim().toLowerCase()

  const [clubs, setClubs] = useState<ClubOption[]>([])
  const [clubsLoading, setClubsLoading] = useState(true)
  const [clubsError, setClubsError] = useState<string | null>(null)
  const [clubSlug, setClubSlug] = useState(presetSlug)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [awardLevel, setAwardLevel] = useState<AwardLevel>('none')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  const loginTo = clubSlug ? `/login?club=${encodeURIComponent(clubSlug)}` : '/login'
  const selectedClub = clubs.find((c) => c.slug === clubSlug) ?? null

  useEffect(() => {
    let stale = false
    setClubsLoading(true)
    setClubsError(null)
    void listClubsForSignup()
      .then((list) => {
        if (stale) return
        setClubs(list)
        // URL/쿼리에 슬러그가 없으면 첫 클럽을 기본 선택
        setClubSlug((prev) => {
          if (prev && list.some((c) => c.slug === prev)) return prev
          return list[0]?.slug ?? ''
        })
      })
      .catch((err) => {
        if (!stale) setClubsError(toErrorMessage(err))
      })
      .finally(() => {
        if (!stale) setClubsLoading(false)
      })
    return () => {
      stale = true
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!clubSlug) {
      setError('가입할 클럽을 선택해주세요.')
      return
    }
    if (name.trim().length < 1) {
      setError('이름을 입력해주세요.')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      const { needsEmailConfirm } = await signUpWithEmail(
        email,
        password,
        name.trim(),
        awardLevel,
        clubSlug,
      )
      if (needsEmailConfirm) setNeedsConfirm(true)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (needsConfirm) {
    return (
      <AuthCard title="이메일 인증">
        <p className="text-center text-base leading-relaxed text-gray-700">
          <strong>{email}</strong> 주소로 인증 메일을 보냈습니다.
          <br />
          메일의 링크를 눌러 가입을 완료한 뒤 로그인해주세요.
        </p>
        <Link
          to={loginTo}
          className="mt-5 flex h-12 items-center justify-center rounded-xl bg-green-700 font-bold text-white"
        >
          로그인 화면으로
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="회원가입">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">클럽</span>
          {clubsLoading ? (
            <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
              클럽 목록 불러오는 중…
            </p>
          ) : clubsError ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{clubsError}</p>
          ) : clubs.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              가입 가능한 클럽이 없습니다. 관리자에게 문의해주세요.
            </p>
          ) : (
            <select
              required
              value={clubSlug}
              onChange={(e) => setClubSlug(e.target.value)}
              className={authInputClass}
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {selectedClub && (
            <span className="text-xs text-gray-400">{selectedClub.name}에 가입합니다.</span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">이메일</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            placeholder="example@email.com"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">비밀번호 (6자 이상)</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            placeholder="비밀번호"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">이름</span>
          <input
            type="text"
            required
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={authInputClass}
            placeholder="실명 입력 (예: 홍길동)"
          />
          <span className="text-xs text-gray-400">
            이전에 게스트로 등록된 이름이면 경기 기록이 이 계정으로 자동 연동됩니다.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">입상 구분</span>
          <select
            value={awardLevel}
            onChange={(e) => setAwardLevel(e.target.value as AwardLevel)}
            className={authInputClass}
          >
            {AWARD_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || clubsLoading || !clubSlug || clubs.length === 0}
          className={authButtonClass}
        >
          {loading ? '가입 중...' : '회원가입'}
        </button>
      </form>

      <div className="mt-4 text-center text-sm">
        <span className="text-gray-500">이미 계정이 있으신가요? </span>
        <Link to={loginTo} className="font-semibold text-green-700 underline">
          로그인
        </Link>
      </div>
    </AuthCard>
  )
}
