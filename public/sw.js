/*
 * 서비스워커 — 설치형(standalone) 실행 요건 충족 + 오프라인 대응.
 *
 * 정책
 * - 문서(내비게이션) 요청: 네트워크 우선, 실패 시 캐시된 앱 셸. 배포 직후에도 항상 최신 index.html 을 받는다.
 * - 정적 자산(해시 파일명): 캐시 우선. 파일명이 바뀌므로 오래된 내용이 노출될 일이 없다.
 * - Supabase 등 외부 origin, GET 이외 요청: 가로채지 않는다.
 *
 * 새 버전 배포 시 CACHE_VERSION 을 올릴 필요는 없다(자산은 해시 파일명, 문서는 네트워크 우선).
 * 캐시 구조 자체를 바꿀 때만 올린다.
 */
const CACHE_VERSION = 'v1'
const SHELL_CACHE = `clubs-shell-${CACHE_VERSION}`
const ASSET_CACHE = `clubs-assets-${CACHE_VERSION}`
const ACTIVE_CACHES = [SHELL_CACHE, ASSET_CACHE]

/** 등록 스코프(= 배포 base 경로). GitHub Pages 하위 경로 배포에서도 그대로 동작한다. */
const SCOPE_URL = self.registration.scope
const SCOPE_PATH = new URL(SCOPE_URL).pathname
const ASSET_PATTERN = /\.(?:js|css|png|jpe?g|svg|ico|webp|woff2?)$/i

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        // HTTP 캐시를 우회해 최신 셸을 받아 둔다.
        const response = await fetch(SCOPE_URL, { cache: 'reload' })
        if (response.ok) await cache.put(SCOPE_URL, response)
      } catch {
        // 오프라인 설치 시도 등 — 첫 온라인 방문에서 다시 채워진다.
      }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !ACTIVE_CACHES.includes(key)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith(SCOPE_PATH)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
    return
  }
  if (ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirstAsset(request))
  }
})

/** 문서 요청: 네트워크 우선 → 실패 시 캐시된 앱 셸 */
async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(SCOPE_URL, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(SCOPE_URL)
    if (cached) return cached
    throw error
  }
}

/** 정적 자산: 캐시 우선 → 없으면 네트워크에서 받아 캐시 */
async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
  return response
}
