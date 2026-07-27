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

  // 타입 보정 (구버전 jsonb / 잘못된 값 대비)
  if (typeof merged.youtube_channel_handle !== 'string') {
    merged.youtube_channel_handle = DEFAULT_SETTINGS.youtube_channel_handle
  } else {
    merged.youtube_channel_handle = merged.youtube_channel_handle.replace(/^@/, '').trim()
  }
  if (
    typeof merged.youtube_upload_delay_days !== 'number' ||
    !Number.isFinite(merged.youtube_upload_delay_days)
  ) {
    merged.youtube_upload_delay_days = DEFAULT_SETTINGS.youtube_upload_delay_days
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
