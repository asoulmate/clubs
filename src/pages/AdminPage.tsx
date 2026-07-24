import { useState } from 'react'
import { LogsTab } from '../components/admin/LogsTab'
import { MatchesTab } from '../components/admin/MatchesTab'
import { SystemSettingsTab } from '../components/admin/SystemSettingsTab'
import { UsersTab } from '../components/admin/UsersTab'

type AdminTab = 'users' | 'matches' | 'logs' | 'settings'

const TABS: { value: AdminTab; label: string }[] = [
  { value: 'users', label: '사용자' },
  { value: 'matches', label: '경기' },
  { value: 'logs', label: '수정 이력' },
  { value: 'settings', label: '시스템 설정' },
]

/** 관리자 페이지 (관리자·서브 관리자 전용) */
export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">관리자</h1>

      <div className="grid grid-cols-4 gap-1 rounded-xl bg-gray-200 p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`h-10 rounded-lg text-sm font-bold ${
              tab === t.value ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'matches' && <MatchesTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'settings' && <SystemSettingsTab />}
    </div>
  )
}
