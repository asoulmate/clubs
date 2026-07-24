import { supabase } from '../lib/supabase'
import type { AppSettings } from '../types/domain'
import { DEFAULT_SETTINGS } from '../types/domain'

// ============================================================
// 운영 설정(app_settings) 데이터 접근 계층
// ============================================================

/** 전체 설정 조회 (없는 키는 기본값으로 채움) */
export async function fetchAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from('app_settings').select('key, value')
  if (error) throw error

  const merged: AppSettings = { ...DEFAULT_SETTINGS }
  const record = merged as unknown as Record<string, unknown>
  for (const row of data ?? []) {
    if (row.key in merged) {
      // jsonb 값을 그대로 사용 ("double" 같은 문자열, true/false, 숫자)
      record[row.key] = row.value
    }
  }
  return merged
}

/** 설정값 변경 (관리자만 — RLS로 보호) */
export async function updateAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)

  if (error) throw error
}
