import { useMemo, useState } from 'react'
import { ExportTab } from '../components/admin/ExportTab'
import { LogsTab } from '../components/admin/LogsTab'
import { MatchesTab } from '../components/admin/MatchesTab'
import { SystemSettingsTab } from '../components/admin/SystemSettingsTab'
import { UsersTab } from '../components/admin/UsersTab'
import { useAuthStore } from '../stores/authStore'
import { isAdmin, isAdminOrSub } from '../utils/permissions'

type AdminTab = 'users' | 'matches' | 'logs' | 'settings' | 'export'

/** 관리자 페이지 (관리자·서브 관리자 전용, 데이터 탭은 서브부터) */
export function AdminPage() {
  const profile = useAuthStore((s) => s.profile)
  const tabs = useMemo(() => {
    const all: { value: AdminTab; label: string; visible: boolean }[] = [
      { value: 'users', label: '사용자', visible: isAdminOrSub(profile) },
      { value: 'matches', label: '경기', visible: isAdminOrSub(profile) },
      { value: 'logs', label: '이력', visible: isAdminOrSub(profile) },
      { value: 'export', label: '데이터', visible: isAdminOrSub(profile) },
      { value: 'settings', label: '설정', visible: isAdmin(profile) },
    ]
    return all.filter((t) => t.visible)
  }, [profile])

  const [tab, setTab] = useState<AdminTab>('users')

  const activeTab = tabs.some((t) => t.value === tab) ? tab : (tabs[0]?.value ?? 'users')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">관리자</h1>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-gray-200 p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`h-10 shrink-0 rounded-lg px-3 text-sm font-bold ${
              activeTab === t.value ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'matches' && <MatchesTab />}
      {activeTab === 'logs' && <LogsTab />}
      {activeTab === 'export' && <ExportTab />}
      {activeTab === 'settings' && <SystemSettingsTab />}
    </div>
  )
}
