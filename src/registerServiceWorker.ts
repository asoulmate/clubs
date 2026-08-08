/**
 * 서비스워커 등록 — 홈 화면 추가 시 주소창 없는 standalone 모드로 실행되기 위한 요건.
 * 개발 서버에서는 캐시가 혼선을 주므로 프로덕션 빌드에서만 등록한다.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  const base = import.meta.env.BASE_URL // 항상 '/' 로 끝난다 (예: '/clubs/')
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // 등록 실패 시에도 앱은 정상 동작한다 (설치/오프라인 기능만 비활성)
    })
  })
}
