import { supabase } from '../lib/supabase'
import type { AppSettings } from '../types/domain'
import { DEFAULT_SETTINGS } from '../types/domain'

/** 클럽 설정 조회 */
export async function fetchClubSettings(clubId: string): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('club_settings')
    .select('key, value')
    .eq('club_id', clubId)
  if (error) throw error

  const merged: AppSettings = { ...DEFAULT_SETTINGS }
  const record = merged as unknown as Record<string, unknown>
  for (const row of data ?? []) {
    if (row.key in merged) {
      record[row.key] = row.value
    }
  }
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

export async function updateClubSetting<K extends keyof AppSettings>(
  clubId: string,
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const { error } = await supabase
    .from('club_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('club_id', clubId)
    .eq('key', key)
  if (error) throw error
}
