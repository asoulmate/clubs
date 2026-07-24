import type { AppSettings, TeamSide } from '../types/domain'

// ============================================================
// 스코어 규칙 (설정값 기반 검증 — 6게임제/타이브레이크/시간제 등
// 어떤 점수제든 수용할 수 있도록 범위와 동점 허용만 검증한다)
// 최종 검증은 DB의 validate_score 함수가 다시 수행한다.
// ============================================================

/** 입력값 검증. 문제가 없으면 null, 있으면 한글 오류 메시지 반환 */
export function validateScoreInput(
  teamA: number | null,
  teamB: number | null,
  settings: AppSettings,
): string | null {
  if (teamA === null || teamB === null || Number.isNaN(teamA) || Number.isNaN(teamB)) {
    return '양 팀의 점수를 모두 입력해주세요.'
  }
  if (!Number.isInteger(teamA) || !Number.isInteger(teamB)) {
    return '점수는 정수로 입력해주세요.'
  }
  if (teamA < 0 || teamB < 0) {
    return '점수는 0 이상이어야 합니다.'
  }
  if (teamA > settings.score_max || teamB > settings.score_max) {
    return `점수는 최대 ${settings.score_max}점까지 입력할 수 있습니다.`
  }
  if (teamA === teamB && !settings.allow_tie) {
    return '동점은 허용되지 않습니다. 승부가 결정된 후 입력해주세요.'
  }
  return null
}

/** 승리 팀 계산 (동점이면 null) */
export function winnerTeam(teamAScore: number, teamBScore: number): TeamSide | null {
  if (teamAScore === teamBScore) return null
  return teamAScore > teamBScore ? 'A' : 'B'
}
