/**
 * ADOJAS path — POSIX 风格路径操作，用法同 Node.js path 模块。
 *
 * 专为 ADOJAS Bridge 设计，处理 ADOFAI 关卡中的文件路径引用。
 * 后端 Kotlin 运行在 Linux (Android) 上，因此统一使用 POSIX 风格。
 */

export const sep = '/'
export const delimiter = ':'

/** 连接路径片段 */
export function join(...segments: string[]): string {
  return segments
    .flatMap(s => s.split('/'))
    .filter(s => s !== '')
    .join('/')
}

/** 取目录名 */
export function dirname(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.join('/') || '.'
}

/** 取文件名（含扩展名） */
export function basename(p: string, ext?: string): string {
  const name = p.replace(/\/+$/, '').split('/').pop() || ''
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length)
  return name
}

/** 取扩展名 */
export function extname(p: string): string {
  const name = basename(p)
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i)
}

/** 解析为绝对路径 */
export function resolve(...segments: string[]): string {
  const joined = join(...segments)
  if (joined.startsWith('/')) return joined
  return '/' + joined
}

/** 是否是绝对路径 */
export function isAbsolute(p: string): boolean {
  return p.startsWith('/')
}

/** 规范化路径 */
export function normalize(p: string): string {
  const parts = p.replace(/\/+/g, '/').split('/')
  const result: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') { result.pop(); continue }
    result.push(part)
  }
  const prefix = p.startsWith('/') ? '/' : ''
  return prefix + result.join('/')
}
