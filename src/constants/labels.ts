import type { AwardLevel, MatchStatus, MatchType, PlayerPosition, UserRole } from '../types/domain'

/** 경기 유형 한글 라벨 */
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  singles: '단식',
  doubles: '복식',
}

/** 입상 구분 한글 라벨 */
export const AWARD_LEVEL_LABELS: Record<AwardLevel, string> = {
  open: '오픈부입상',
  national_rookie: '전국신인부입상',
  local_rookie: '지역신인부입상',
  none: '비입상',
}

export const AWARD_LEVEL_OPTIONS: { value: AwardLevel; label: string }[] = [
  { value: 'open', label: '오픈부입상' },
  { value: 'national_rookie', label: '전국신인부입상' },
  { value: 'local_rookie', label: '지역신인부입상' },
  { value: 'none', label: '비입상' },
]

/** 이름 오른쪽 표시용 입상 아이콘 (비입상은 빈 문자열) */
export const AWARD_LEVEL_ICONS: Record<AwardLevel, string> = {
  open: '🏆',
  national_rookie: '⭐',
  local_rookie: '💫',
  none: '',
}

/** 사용자 역할 한글 라벨 */
export const ROLE_LABELS: Record<UserRole, string> = {
  user: '일반 사용자',
  sub_admin: '서브 관리자',
  admin: '관리자',
}

/** 경기 상태 한글 라벨 */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  open: '모집 중',
  ready: '편성 완료',
  in_progress: '경기 중',
  submitted: '확정 대기',
  confirmed: '확정',
  canceled: '취소됨',
}

/** 포지션 라벨 */
export const POSITION_LABELS: Record<PlayerPosition, string> = {
  A1: 'A팀 1번',
  A2: 'A팀 2번',
  B1: 'B팀 1번',
  B2: 'B팀 2번',
}

/** 감사 로그 액션 한글 라벨 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  submit_score: '스코어 입력',
  confirm_score: '스코어 확정',
  cancel: '경기 취소',
  admin_update_score: '관리자 스코어 수정',
  admin_reset: '경기 초기화',
  admin_set_player: '참가자 강제 변경',
}
