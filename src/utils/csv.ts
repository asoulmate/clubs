/** CSV 셀 이스케이프 (쉼표·따옴표·개행) */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** 객체 배열 → CSV 문자열 (UTF-8 BOM 포함, Excel 한글 호환) */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '\uFEFF'
  const headers = Object.keys(rows[0])
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

/** 브라우저에서 CSV 파일 다운로드 */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
