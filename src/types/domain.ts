// ============================================================
// 도메인 타입 정의 (Supabase 스키마와 1:1 대응)
// ============================================================

/** 사용자 역할 */
export type UserRole = 'user' | 'sub_admin' | 'admin'

/** 입상 구분 */
export type AwardLevel = 'open' | 'national_rookie' | 'local_rookie' | 'none'

/** 경기 상태 */
export type MatchStatus = 'open' | 'ready' | 'in_progress' | 'submitted' | 'confirmed' | 'canceled'

/** 경기 유형: 단식(팀당 1명) / 복식(팀당 2명) */
export type MatchType = 'singles' | 'doubles'

/** 경기 유형별 필요 참가자 수 */
export function requiredPlayerCount(matchType: MatchType): number {
  return matchType === 'singles' ? 2 : 4
}

/** 참가자 포지션 */
export type PlayerPosition = 'A1' | 'A2' | 'B1' | 'B2'

/** 팀 구분 */
export type TeamSide = 'A' | 'B'

export const ALL_POSITIONS: readonly PlayerPosition[] = ['A1', 'A2', 'B1', 'B2']

/** 포지션 → 팀 변환 */
export function positionTeam(position: PlayerPosition): TeamSide {
  return position === 'A1' || position === 'A2' ? 'A' : 'B'
}

// ------------------------------------------------------------
// 테이블 행 타입
// ------------------------------------------------------------

export interface Profile {
  id: string
  name: string
  award_level: AwardLevel
  /** 현재 클럽 컨텍스트의 역할(클럽 진입 시 club_members.role로 덮어씀) */
  role: UserRole
  is_active: boolean
  /** true면 비밀번호 미설정 게스트 (회원가입 시 실계정으로 연동 가능) */
  is_guest: boolean
  /** 소속 (게스트 수기 등록 시 입력, 일반 회원은 보통 null) */
  affiliation: string | null
  /** 플랫폼 슈퍼 관리자 */
  is_platform_admin: boolean
  created_at: string
  updated_at: string
}

export interface Club {
  id: string
  name: string
  slug: string
  youtube_enabled: boolean
  absence_enabled: boolean
  created_at: string
  updated_at: string
}

export type ClubMemberStatus = 'pending' | 'active' | 'rejected'

export interface ClubMembership {
  club_id: string
  name: string
  slug: string
  role: UserRole
  status: ClubMemberStatus
  youtube_enabled: boolean
  absence_enabled: boolean
}

export interface Match {
  id: string
  club_id: string
  match_date: string
  created_by: string
  status: MatchStatus
  /** 단식/복식 */
  match_type: MatchType
  /** true면 배팅 경기 (경기 시작 버튼은 배팅 경기에서만 사용) */
  is_betting: boolean
  /** 배팅 마감 시각 (배팅 경기에서만 존재, 경기 당일을 넘지 않음) */
  betting_deadline: string | null
  team_a_score: number | null
  team_b_score: number | null
  score_submitted_by: string | null
  score_submitted_at: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  version: number
  created_at: string
  updated_at: string
  /** 연결된 YouTube video id */
  youtube_video_id: string | null
  youtube_title: string | null
  youtube_matched_at: string | null
}

export interface MatchPlayer {
  id: string
  match_id: string
  user_id: string
  position: PlayerPosition
  registered_by: string
  created_at: string
  /** 조인된 참가자 프로필 */
  profile: Profile
}

/** 참가자 정보가 포함된 경기 */
export interface MatchWithPlayers extends Match {
  players: MatchPlayer[]
}

export interface MatchAuditLog {
  id: string
  match_id: string
  action_type: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  changed_by: string
  changed_at: string
  reason: string | null
  /** 조인된 변경자 프로필 */
  changed_by_profile?: Pick<Profile, 'id' | 'name'> | null
}

// ------------------------------------------------------------
// 운영 설정 (app_settings)
// ------------------------------------------------------------

/** 스코어 확정 방식: double = 상대 팀 확인 필요, single = 제출 즉시 확정 */
export type ConfirmMode = 'double' | 'single'

export interface AppSettings {
  confirm_mode: ConfirmMode
  allow_tie: boolean
  score_max: number
  min_matches_for_ranking: number
  allow_proxy_registration: boolean
  /** true면 신규 가입 시 비활성(승인 대기), 관리자/서브가 활성화해야 이용 가능 */
  require_signup_approval: boolean
  /** 경기 만들기 기본 유형 (단식/복식) */
  default_match_type: MatchType
  /** YouTube 채널 핸들 (@ 제외) */
  youtube_channel_handle: string
  /** @deprecated 매칭은 고정 ±2일 창 사용. DB 호환용으로만 유지 */
  youtube_upload_delay_days: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  confirm_mode: 'double',
  allow_tie: false,
  score_max: 99,
  min_matches_for_ranking: 0,
  allow_proxy_registration: true,
  require_signup_approval: false,
  default_match_type: 'doubles',
  youtube_channel_handle: '멍기멍기-k4q',
  youtube_upload_delay_days: 7,
}

// ------------------------------------------------------------
// 통계 RPC 반환 타입
// ------------------------------------------------------------

/** get_player_stats 반환 행 */
export interface PlayerStatsRow {
  user_id: string
  name: string
  award_level: AwardLevel
  matches_played: number
  wins: number
  losses: number
  ties: number
  points_for: number
  points_against: number
  days_participated: number
  total_match_days: number
  /** 기간 내 무단 결석 횟수 */
  absences: number
  is_guest?: boolean
  affiliation?: string | null
}

/** 순위·파생 지표가 부여된 통계 행 */
export interface RankedPlayerStats extends PlayerStatsRow {
  /** 공동 순위 허용 경쟁 순위 (최소 경기 수 미달이면 null) */
  rank: number | null
  win_rate: number
  point_diff: number
  participation_rate: number
}

/** get_partner_stats 반환 행 */
export interface PartnerStatsRow {
  partner_id: string
  partner_name: string
  partner_award: AwardLevel
  matches_played: number
  wins: number
  losses: number
  ties: number
}

/** get_opponent_stats 반환 행 */
export interface OpponentStatsRow {
  opponent_id: string
  opponent_name: string
  opponent_award: AwardLevel
  matches_played: number
  wins: number
  losses: number
  ties: number
}

/** get_player_monthly_trend 반환 행 */
export interface MonthlyTrendRow {
  month: string
  matches_played: number
  wins: number
  losses: number
  /** 해당 월에 경기에 참가한 날짜 수 */
  days_participated: number
}

/** get_player_recent_matches 반환 행 */
export interface RecentMatchRow {
  match_id: string
  match_date: string
  my_team: TeamSide
  team_a_score: number
  team_b_score: number
  result: 'win' | 'loss' | 'tie'
  partner_names: string[]
  /** 파트너 입상 (partner_names와 동일 순서) */
  partner_awards: AwardLevel[]
  opponent_names: string[]
  /** 상대 입상 (opponent_names와 동일 순서) */
  opponent_awards: AwardLevel[]
}

/** 신규 배팅 가능 금액 (과거 기록에는 2000원이 있을 수 있음) */
export type BetAmount = 500 | 1000

export const BET_AMOUNTS: readonly BetAmount[] = [500, 1000]

/** 배팅 정산 결과 */
export type BetResult = 'win' | 'loss' | 'push'

export interface MatchBet {
  id: string
  match_id: string
  club_id: string
  user_id: string
  /** 500/1000 (과거 기록은 2000 가능) */
  amount: number
  predicted_team: TeamSide
  result: BetResult | null
  settled_at: string | null
  created_at: string
  updated_at: string
  profile?: Pick<Profile, 'id' | 'name' | 'award_level'> | null
}

export interface PlayerBetStats {
  bets_total: number
  bets_won: number
  bets_lost: number
  bets_push: number
  bets_open: number
  amount_won: number
  amount_lost: number
  amount_total: number
}

export interface RecentBetRow {
  bet_id: string
  match_id: string
  match_date: string
  /** 500/1000 (과거 기록은 2000 가능) */
  amount: number
  predicted_team: TeamSide
  result: BetResult | null
  team_a_score: number | null
  team_b_score: number | null
  created_at: string
}
