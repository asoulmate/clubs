import type { AwardLevel, MatchStatus, MatchType, PlayerPosition, UserRole } from '../types/domain'

/** 경기 유형 한글 라벨 */
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  singles: '단식',
  doubles: '복식',
}

/** 입상 구분 한글 라벨 (7단계) */
export const AWARD_LEVEL_LABELS: Record<AwardLevel, string> = {
  open_champion: '오픈부 우승',
  open_place: '오픈부 입상',
  national_rookie_champion: '전국신인부 우승',
  national_rookie_place: '전국신인부 입상',
  local_rookie_champion: '지역신인부 우승',
  local_rookie_place: '지역신인부 입상',
  none: '비입상',
  // 구버전 호환 (마이그레이션 전)
  open: '오픈부 입상',
  national_rookie: '전국신인부 입상',
  local_rookie: '지역신인부 입상',
}

/** 회원가입·편집용 선택지 (7단계) */
export const AWARD_LEVEL_OPTIONS: { value: AwardLevel; label: string }[] = [
  { value: 'open_champion', label: '오픈부 우승' },
  { value: 'open_place', label: '오픈부 입상' },
  { value: 'national_rookie_champion', label: '전국신인부 우승' },
  { value: 'national_rookie_place', label: '전국신인부 입상' },
  { value: 'local_rookie_champion', label: '지역신인부 우승' },
  { value: 'local_rookie_place', label: '지역신인부 입상' },
  { value: 'none', label: '비입상' },
]

/** 이름 오른쪽 표시용 입상 아이콘 (비입상은 빈 문자열) */
export const AWARD_LEVEL_ICONS: Record<AwardLevel, string> = {
  open_champion: '🏆',
  open_place: '🏆',
  national_rookie_champion: '⭐',
  national_rookie_place: '⭐',
  local_rookie_champion: '💫',
  local_rookie_place: '💫',
  none: '',
  // 구버전 호환
  open: '🏆',
  national_rookie: '⭐',
  local_rookie: '💫',
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
