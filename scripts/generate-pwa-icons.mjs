// PWA 아이콘(PNG) 생성 스크립트 — 외부 의존성 없이 Node 내장 zlib 으로 PNG 를 직접 기록한다.
// 사용법: node scripts/generate-pwa-icons.mjs
// 결과물은 public/icons/ 아래에 생성되며 저장소에 커밋한다(배포 시 재생성하지 않음).

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'public/icons')

/** 브랜드 색: 배경(green-800), 공(lime-300), 실밥(green-50) */
const BG = [0x16, 0x65, 0x34]
const BALL = [0xbe, 0xf2, 0x64]
const SEAM = [0xf0, 0xfd, 0xf4]

/** 슈퍼샘플링 배율 — 하드 엣지로 그린 뒤 축소하여 안티에일리어싱을 얻는다. */
const SS = 4

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** RGBA 픽셀 버퍼를 8비트 트루컬러+알파 PNG 로 인코딩 */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 라운드 사각형 내부 판정 (radius 0 이면 정사각 풀블리드) */
function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return true
  const dx = Math.max(radius - x, x - (size - radius), 0)
  const dy = Math.max(radius - y, y - (size - radius), 0)
  return dx * dx + dy * dy <= radius * radius
}

/**
 * 테니스공 아이콘을 그린다.
 * @param size 최종 픽셀 크기
 * @param cornerRatio 라운드 반경 비율(0 이면 풀블리드 — maskable/apple-touch 용)
 * @param ballRatio 아이콘 크기 대비 공 지름 비율
 */
function drawIcon(size, { cornerRatio, ballRatio }) {
  const S = size * SS
  const hi = Buffer.alloc(S * S * 4)
  const center = S / 2
  const radius = S * cornerRatio
  const ballR = (S * ballRatio) / 2
  // 실밥: 공 좌우 바깥에 중심을 둔 원의 호(arc) 두 개가 서로 마주보며 안쪽으로 휘는 형태
  const seamOffset = ballR * 1.5
  const seamR = seamOffset - ballR * 0.35
  const seamHalf = Math.max(SS * 0.5, ballR * 0.075)

  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const i = (y * S + x) * 4
      const px = x + 0.5
      const py = y + 0.5

      if (!insideRoundedRect(px, py, S, radius)) {
        // 투명 픽셀도 배경색을 유지해 축소 시 테두리가 탁해지지 않게 한다.
        hi[i] = BG[0]
        hi[i + 1] = BG[1]
        hi[i + 2] = BG[2]
        hi[i + 3] = 0
        continue
      }

      const dx = px - center
      const dy = py - center
      let color = BG
      if (dx * dx + dy * dy <= ballR * ballR) {
        const left = Math.hypot(px - (center - seamOffset), dy)
        const right = Math.hypot(px - (center + seamOffset), dy)
        const onSeam =
          Math.abs(left - seamR) <= seamHalf || Math.abs(right - seamR) <= seamHalf
        color = onSeam ? SEAM : BALL
      }
      hi[i] = color[0]
      hi[i + 1] = color[1]
      hi[i + 2] = color[2]
      hi[i + 3] = 255
    }
  }

  // 박스 필터로 SS 배 축소
  const out = Buffer.alloc(size * size * 4)
  const area = SS * SS
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4
          r += hi[i]
          g += hi[i + 1]
          b += hi[i + 2]
          a += hi[i + 3]
        }
      }
      const o = (y * size + x) * 4
      out[o] = Math.round(r / area)
      out[o + 1] = Math.round(g / area)
      out[o + 2] = Math.round(b / area)
      out[o + 3] = Math.round(a / area)
    }
  }
  return out
}

const TARGETS = [
  // Android/데스크톱 설치 아이콘 (그대로 표시되므로 라운드 처리)
  { file: 'icon-192.png', size: 192, cornerRatio: 0.22, ballRatio: 0.78 },
  { file: 'icon-512.png', size: 512, cornerRatio: 0.22, ballRatio: 0.78 },
  // maskable: 런처가 임의 모양으로 자르므로 풀블리드 + 안전영역(80%) 안쪽에 공 배치
  { file: 'icon-maskable-192.png', size: 192, cornerRatio: 0, ballRatio: 0.6 },
  { file: 'icon-maskable-512.png', size: 512, cornerRatio: 0, ballRatio: 0.6 },
  // iOS 홈 화면: OS 가 자체 마스크를 씌우므로 풀블리드
  { file: 'apple-touch-icon.png', size: 180, cornerRatio: 0, ballRatio: 0.78 },
  { file: 'favicon-32.png', size: 32, cornerRatio: 0.22, ballRatio: 0.86 },
  { file: 'favicon-64.png', size: 64, cornerRatio: 0.22, ballRatio: 0.86 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const target of TARGETS) {
  const rgba = drawIcon(target.size, target)
  const png = encodePng(target.size, rgba)
  writeFileSync(resolve(OUT_DIR, target.file), png)
  console.log(`generated ${target.file} (${target.size}x${target.size}, ${png.length} bytes)`)
}
