import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Context, Limit, Parts, Scoped } from '../types'

const PANE = 'usage-pace'

export type Lang = 'ja' | 'en'

const TEXTS = {
  ja: {
    title: '使用量のペース',
    fiveHour: '5時間',
    week: '週間',
    atLimit: '上限に到達',
    reachAhead: (ahead: string) => `リセット${ahead}前に到達見込み`,
    limitTag: '上限',
    staleTag: '前回',
    elapsed: (v: string) => `${v}経過`,
    projected: (v: string) => `${v}見込み`,
    elapsedShort: '経過',
    projectedShort: '見込み',
    used: '使用',
    untilReset: 'リセットまで',
    resetClock: (c: string) => `(${c})`,
    weekdays: ['日', '月', '火', '水', '木', '金', '土'],
    staleValue: '前回の値',
    noUsage: 'まだ使用量の値が無い(Claude の返答が来ると出る)',
    context: 'コンテキスト',
    noContext: 'コンテキスト: まだ値が無い(Claude の返答が来ると出る)',
    nothing: '表示するものが無い(/usage-pace pace on などで出す)',
    compactStart: 'compact を始めた',
    compactSkip: (why: string) => `compact しなかった: ${why}`,
    compactDone: 'compact した',
    closed: '使用量のペースを閉じた',
    opened: '使用量のペースを開いた',
    notOpened: (why: string) => `開けなかった: ${why}`,
    description: '使用量のペースの表示を切り替える',
    names: { pace: '使用率のペース', context: 'コンテキスト', line: '入力欄の下の1行', clock: 'リセットの時刻', model: 'モデル別の週間' },
    usage: [
      '/usage-pace               パネルの開閉',
      '/usage-pace <part> [on|off]  表示の切り替え(on/off を省くと反転)',
      '    part: pace(使用率のペース) / context(コンテキスト) / line(入力欄の下の1行)',
      '          clock(パネルの見出しにリセットの時刻) / model(モデル別の週間: Fable) / all',
      '/usage-pace line tiny     入力欄の下の1行を詰めて出す(line on で元に戻る)',
      '/usage-pace status        今の設定',
    ],
  },
  en: {
    title: 'Usage pace',
    fiveHour: '5-hour',
    week: 'Weekly',
    atLimit: 'Limit reached',
    reachAhead: (ahead: string) => `Reaches 100% ${ahead} before the reset`,
    limitTag: 'limit',
    staleTag: 'last',
    elapsed: (v: string) => `${v} elapsed`,
    projected: (v: string) => `${v} projected`,
    elapsedShort: 'elapsed',
    projectedShort: 'projected',
    used: 'used',
    untilReset: 'resets in',
    resetClock: (c: string) => ` (${c})`,
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    staleValue: 'last reading',
    noUsage: 'No usage figures yet (they come with a reply from Claude)',
    context: 'Context',
    noContext: 'Context: no figures yet (they come with a reply from Claude)',
    nothing: 'Nothing to show (turn a part on, e.g. /usage-pace pace on)',
    compactStart: 'Compacting',
    compactSkip: (why: string) => `Not compacted: ${why}`,
    compactDone: 'Compacted',
    closed: 'Closed the usage pace',
    opened: 'Opened the usage pace',
    notOpened: (why: string) => `Could not open: ${why}`,
    description: 'Show or hide the parts of the usage pace',
    names: { pace: 'Usage pace', context: 'Context', line: 'Line under the prompt', clock: 'Reset time', model: 'Per-model weekly' },
    usage: [
      '/usage-pace               open or close the pane',
      '/usage-pace <part> [on|off]  show or hide a part (no on/off: flip it)',
      '    part: pace (usage pace) / context (context) / line (line under the prompt)',
      '          clock (reset time in the pane headings) / model (per-model weekly: Fable) / all',
      '/usage-pace line tiny     the line under the prompt, packed (line on: back to full)',
      '/usage-pace status        the current settings',
    ],
  },
} as const

type Texts = { [K in keyof (typeof TEXTS)['ja']]: (typeof TEXTS)['ja'][K] extends (...a: infer A) => string ? (...a: A) => string : (typeof TEXTS)['ja'][K] extends string ? string : (typeof TEXTS)['ja'][K] extends readonly string[] ? readonly string[] : Record<Part, string> }

// The language of this session, set from Claude Code's language at start.
let T: Texts = TEXTS.ja
export function setLanguage(lang: Lang): void {
  T = TEXTS[lang]
}

/** Claude Code's `language` setting, else the system locale: Japanese or English. */
export function pickLanguage(setting: unknown, locale: string | undefined): Lang {
  if (typeof setting === 'string' && setting.trim() !== '') return /^(ja|japanese|日本)/i.test(setting.trim()) ? 'ja' : 'en'
  return locale !== undefined && /^ja/i.test(locale) ? 'ja' : 'en'
}

async function detectLanguage($: EngineInterface): Promise<Lang> {
  let setting: unknown
  try {
    setting = await $.settings.read({ key: 'language' })
  } catch {}
  let locale: string | undefined
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale
  } catch {}
  if (locale === undefined || locale === 'en-US') {
    try {
      locale = (await $.env.get('LANG')) ?? locale
    } catch {}
  }
  return pickLanguage(setting, locale)
}
const MINUTE = 60_000
const HOUR = 60 * MINUTE

// Change a tag when its value's fields change: it declines what an earlier version stored.
const limits = atom({ plugin: 'usage-pace', key: 'limits' } as const, [], { shape: 'limits-1' })
const stale = atom({ plugin: 'usage-pace', key: 'stale' } as const, false)
const context = atom({ plugin: 'usage-pace', key: 'context' } as const, { window: 0 }, { shape: 'context-1' })
const scoped = atom({ plugin: 'usage-pace', key: 'scoped' } as const, [], { shape: 'scoped-1' })
const ALL_ON: Parts = { pace: true, context: true, line: true, tiny: false, clock: true, model: true }
const parts = atom({ plugin: 'usage-pace', key: 'parts' } as const, ALL_ON, { shape: 'parts-4' })
// Bumped once a minute so the elapsed share moves between responses (no request is made).
const tick = atom({ plugin: 'usage-pace', key: 'tick' } as const, 0)

// $.store keys, shared by every chat
const STORE_LIMITS = 'lastLimits'
const STORE_PARTS = 'parts'
const STORE_SCOPED = 'lastScoped'

type StoreValue = Parameters<EngineInterface['store']['set']>[1]

/** $.store.get, which throws on a broken store file: the read then has nothing, and the mod goes on. */
async function storeGet($: EngineInterface, key: string): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}

/** $.store.set; a write the store refuses is lost, the chat keeps its own values. */
async function storeSet($: EngineInterface, key: string, value: StoreValue): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {}
}

const WINDOWS: Record<string, { label: 'fiveHour' | 'week'; tag: string; ms: number; unit: 'm' | 'h' }> = {
  five_hour: { label: 'fiveHour', tag: 'S', ms: 5 * HOUR, unit: 'm' },
  seven_day: { label: 'week', tag: 'W', ms: 7 * 24 * HOUR, unit: 'h' },
  // a per-model weekly window (Fable): its label and tag come from the model
  seven_day_model: { label: 'week', tag: 'M', ms: 7 * 24 * HOUR, unit: 'h' },
}

/** The tag of a model's window: its first letter, two when that one is taken (S, W, C). */
export function modelTag(model: string): string {
  const letters = model.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (letters === '') return 'M'
  return ['S', 'W', 'C'].includes(letters.charAt(0)) ? letters.slice(0, 2) : letters.charAt(0)
}

export type Pace = {
  label: string
  tag: string
  used: number
  elapsed: number
  projected: number | null
  remainingMs: number
  /** The reset time, epoch ms. */
  resetAt: number
  /** The weekly window: its reset time reads with the weekday. */
  isWeekly: boolean
  /** How long before the reset the pace reaches 100% ("113m", "84h"); null when it does not. */
  ahead: string | null
  note: string | null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** The reset time in local time: "14:30", or "土 9:00" / "Sat 9:00" for the weekly window. */
export function resetClock(p: Pick<Pace, 'resetAt' | 'isWeekly'>): string {
  const d = new Date(p.resetAt)
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return p.isWeekly ? `${T.weekdays[d.getDay()]} ${time}` : time
}

/** duration() without spaces, at most two units: "2h55m", "5d19h", "43m". */
export const shortDuration = (ms: number) => duration(ms).replace(' ', '')

/** The figures of one window at `now`; null for a window of unknown length or reset time. */
export function pace(limit: Limit, now: number): Pace | null {
  const window = WINDOWS[limit.kind]
  const resetAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  if (!window || Number.isNaN(resetAt)) return null
  const remainingMs = clamp(resetAt - now, 0, window.ms)
  const elapsed = (1 - remainingMs / window.ms) * 100
  const used = limit.percentUsed
  const projected = elapsed >= 0.1 ? (used / elapsed) * 100 : null
  let ahead: string | null = null
  let note: string | null = null
  if (used >= 100) {
    note = T.atLimit
  } else if (projected !== null && projected > 100 && used > 0) {
    const reachInMs = ((100 - used) * (elapsed / 100) * window.ms) / used
    const aheadMs = remainingMs - reachInMs
    ahead = window.unit === 'm' ? `${Math.round(aheadMs / MINUTE)}m` : `${Math.round(aheadMs / HOUR)}h`
    note = T.reachAhead(ahead)
  }
  const label = limit.model ?? T[window.label]
  const tag = limit.model !== undefined ? modelTag(limit.model) : window.tag
  return { label, tag, used, elapsed, projected, remainingMs, resetAt, isWeekly: window.unit === 'h', ahead, note }
}

const pct = (v: number) => `${v.toFixed(1)}%`
// The windows report whole percents in practice: no decimals for the used share.
const usedPct = (v: number) => `${Math.round(v)}%`

/** The context fill as a whole percent; null before the first response of the chat. */
export function contextPercent(c: Context): number | null {
  if (c.percent !== undefined) return Math.round(c.percent)
  if (c.tokens === undefined || c.window <= 0) return null
  return Math.round((c.tokens / c.window) * 100)
}

/** 512, 84.2k, 1.2M; `trim` drops a ".0" (200k, 1M). */
export function tokens(n: number, trim = false): string {
  const text = n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`
  return trim ? text.replace('.0', '') : text
}

/** The context colour by its fill: plain, then yellow, orange and red. */
export function contextLevel(percent: number): { bar: string; text?: string } {
  if (percent >= 85) return { bar: '#d05050', text: 'red' }
  if (percent >= 70) return { bar: '#e07830', text: '#e07830' }
  if (percent >= 50) return { bar: '#d0b030', text: 'yellow' }
  return { bar: '#4a90d9' }
}

/**
 * The status line: "[S] 32% 2h55m e: 76.8% , [W] 34% 5d19h e: 200.9% (-84h) , [C] 42%".
 * Tiny: "[S]32%,2h55m,e:76.8%[W]34%,5d19h,e:200.9%(-84h)[C]42%", without the stale tag.
 */
export function statusLine(paces: Pace[], contextPct: number | null = null, isStale = false, tiny = false): string | undefined {
  if (tiny) {
    const items = paces.map(p => {
      const estimate = p.projected === null ? '-' : pct(p.projected)
      const tail = p.used >= 100 ? `(${T.limitTag})` : p.ahead ? `(-${p.ahead})` : ''
      return `[${p.tag}]${usedPct(p.used)},${shortDuration(p.remainingMs)},e:${estimate}${tail}`
    })
    if (contextPct !== null) items.push(`[C]${contextPct}%`)
    return items.length === 0 ? undefined : items.join('')
  }
  const items = paces.map(p => {
    const estimate = p.projected === null ? '-' : pct(p.projected)
    const tail = p.used >= 100 ? ` (${T.limitTag})` : p.ahead ? ` (-${p.ahead})` : ''
    return `[${p.tag}] ${usedPct(p.used)} ${shortDuration(p.remainingMs)} e: ${estimate}${tail}`
  })
  if (isStale && items.length > 0) items[items.length - 1] += ` (${T.staleTag})`
  if (contextPct !== null) items.push(`[C] ${contextPct}%`)
  return items.length === 0 ? undefined : items.join(' , ')
}

async function currentPaces($: EngineInterface): Promise<Pace[]> {
  const now = await $.clock.now()
  const isStale = await read($, stale)
  const shown = await read($, parts)
  const own = (await read($, limits))
    // a saved window whose reset has passed tells nothing until the next reading
    .filter(l => !isStale || (l.resetsAt !== undefined && Date.parse(l.resetsAt) > now))
  // the per-model windows are a saved reading too: one whose reset has passed is left out
  const models = shown.model ? (await read($, scoped)).filter(l => l.resetsAt !== undefined && Date.parse(l.resetsAt) > now) : []
  return [...own, ...models].map(l => pace(l, now)).filter((p): p is Pace => p !== null)
}

/** Text beside a marker: to its right in the left half, to its left in the right half. */
function markerText(x: number, y: number, arrow: string, text: string, width: number): string {
  const isLeft = x < width / 2
  const anchor = isLeft ? 'start' : 'end'
  const label = isLeft ? `${arrow}${text}` : `${text}${arrow}`
  return `<text x="${isLeft ? x - 5 : x + 5}" y="${y}" text-anchor="${anchor}">${label}</text>`
}

/** width: CSS pixels of the drawing; the text keeps its size at any width. */
export function meterSvg(p: Pace, width = 320): string {
  const x = (v: number) => (clamp(v, 0, 100) / 100) * width
  const usedColor = p.used >= 100 ? '#d05050' : '#4a90d9'
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 58" width="${width}" height="58" font-family="sans-serif" font-size="11" fill="#b4b4b4">`,
    `<rect x="0" y="22" width="${width}" height="12" rx="3" fill="#80808040"/>`,
    `<rect x="0" y="22" width="${x(p.used)}" height="12" rx="3" fill="${usedColor}"/>`,
    `<rect x="${x(p.elapsed) - 1}" y="17" width="2" height="22" fill="#e0a030"/>`,
    markerText(x(p.elapsed), 13, '▼', T.elapsed(pct(p.elapsed)), width),
  ]
  if (p.projected !== null) {
    const over = p.projected > 100
    parts.push(`<rect x="${x(p.projected) - 1}" y="17" width="2" height="22" fill="${over ? '#d05050' : '#50a060'}"/>`)
    parts.push(markerText(x(p.projected), 52, '▲', T.projected(pct(p.projected)), width))
  }
  parts.push('</svg>')
  return parts.join('')
}

export function contextSvg(percent: number, width = 320): string {
  const fill = (clamp(percent, 0, 100) / 100) * width
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 14" width="${width}" height="14">`,
    `<rect x="0" y="1" width="${width}" height="12" rx="3" fill="#80808040"/>`,
    `<rect x="0" y="1" width="${fill}" height="12" rx="3" fill="${contextLevel(percent).bar}"/>`,
    '</svg>',
  ].join('')
}

function textBar(percent: number): string {
  const cells = 24
  const filled = Math.round((clamp(percent, 0, 100) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

function isLimitList(v: unknown): v is Limit[] {
  return (
    Array.isArray(v) &&
    v.every(l => typeof l === 'object' && l !== null && typeof l.kind === 'string' && typeof l.percentUsed === 'number')
  )
}

function isParts(v: unknown): v is Parts {
  const p = v as Parts
  return typeof v === 'object' && v !== null && [p.pace, p.context, p.line].every(b => typeof b === 'boolean')
}

/** A saved setting, from before `tiny`, `clock` and `model` too. */
function savedParts(v: unknown): Parts | null {
  if (!isParts(v)) return null
  return { pace: v.pace, context: v.context, line: v.line, tiny: v.tiny === true, clock: v.clock !== false, model: v.model !== false }
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
// the engine keeps its own reading of the endpoint 5 minutes: no need to ask sooner
const SCOPED_EVERY = 5 * MINUTE

/** The per-model weekly windows (Fable) of a usage endpoint body; [] when it has none. */
export function scopedLimits(body: unknown): Limit[] {
  const rows = (body as { limits?: unknown } | null)?.limits
  if (!Array.isArray(rows)) return []
  const list: Limit[] = []
  for (const row of rows) {
    const r = row as { kind?: unknown; percent?: unknown; resets_at?: unknown; scope?: { model?: { display_name?: unknown } | null } | null } | null
    const model = r?.scope?.model?.display_name
    if (r?.kind !== 'weekly_scoped' || typeof model !== 'string' || model === '' || typeof r.percent !== 'number') continue
    const limit: Limit = { kind: 'seven_day_model', percentUsed: r.percent, model }
    if (typeof r.resets_at === 'string') limit.resetsAt = r.resets_at
    list.push(limit)
  }
  return list
}

function isScoped(v: unknown): v is Scoped {
  const s = v as Scoped
  return typeof v === 'object' && v !== null && typeof s.at === 'number' && isLimitList(s.limits)
}

// a turn has ended since the endpoint was last asked: its reading may have moved
let isScopedDirty = true
let scopedAsking: Promise<void> | null = null

/**
 * The per-model weekly windows: `$.session.usage()` does not carry them, so the
 * usage endpoint is asked, with the session's credential held by the host. At
 * most once in 5 minutes, shared by every chat, and only after a turn has ended
 * (or when the chat starts).
 */
async function refreshScoped($: EngineInterface): Promise<void> {
  if (!(await read($, parts)).model) return
  if (scopedAsking) return scopedAsking
  scopedAsking = (async () => {
    const now = await $.clock.now()
    const saved = await storeGet($, STORE_SCOPED)
    const last = isScoped(saved) ? saved : null
    if (last && (!isScopedDirty || now - last.at < SCOPED_EVERY)) {
      await update($, scoped, () => last.limits)
      return
    }
    isScopedDirty = false
    let list = last?.limits ?? []
    try {
      const auth = await $.session.authorize()
      if (auth) {
        const res = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'Content-Type': 'application/json' } })
        if (res.ok) list = scopedLimits(JSON.parse(res.text))
      }
    } catch {}
    // a failed ask waits the same 5 minutes, keeping the last reading
    await storeSet($, STORE_SCOPED, { at: now, limits: list })
    await update($, scoped, () => list)
  })().finally(() => {
    scopedAsking = null
  })
  return scopedAsking
}

async function drawStatus($: EngineInterface): Promise<void> {
  const shown = await read($, parts)
  if (!shown.line) {
    $.ui.status(undefined)
    return
  }
  $.ui.status(statusLine(await currentPaces($), contextPercent(await read($, context)), await read($, stale), shown.tiny))
}

/** A reading of this chat: kept, and saved for the chats that have none yet. */
async function takeLimits($: EngineInterface, list: readonly Limit[]): Promise<void> {
  const copy = list.map(r => ({ ...r }))
  await update($, limits, () => copy)
  await update($, stale, () => false)
  await storeSet($, STORE_LIMITS, copy)
}

/** Until this chat has a reading of its own, the last one any chat saved. */
async function loadSaved($: EngineInterface): Promise<void> {
  if ((await read($, limits)).length > 0 && !(await read($, stale))) return
  const saved = await storeGet($, STORE_LIMITS)
  if (isLimitList(saved) && saved.length > 0) {
    await update($, limits, () => saved)
    await update($, stale, () => true)
  }
}

/** The figures the last API response reported, as the status line has them: no request is made. */
async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  if (usage.rateLimits.length > 0) await takeLimits($, usage.rateLimits)
  else await loadSaved($)
  await update($, context, () => ({ ...usage.context }))
  await drawStatus($)
  // not waited for: a slow endpoint must not hold the hook (the pane redraws on the write)
  void refreshScoped($)
    .then(() => drawStatus($))
    .catch(() => {})
}

/**
 * The same compaction /compact makes. `$.session.compact` is not there in a
 * desktop (SDK) session: there the command goes in as a prompt, run once idle.
 */
async function compactNow($: EngineInterface): Promise<void> {
  try {
    $.ui.toast(T.compactStart)
    const result = await $.session.compact()
    $.ui.toast(result.skip !== undefined ? T.compactSkip(result.skip) : T.compactDone)
    await refresh($)
    return
  } catch {}
  // compact runs longer than a hook may wait (10s): start it and return
  $.command.run({ command: 'compact' }).catch(() =>
    $.prompt.submit({ text: '/compact', asUser: true }).catch(() => {}),
  )
}

async function setPaneShown($: EngineInterface, shown: Parts): Promise<void> {
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  const wants = shown.pace || shown.context
  if (wants && !isOpen) await $.ui.open({ id: PANE, title: T.title })
  if (!wants && isOpen) await $.ui.close({ id: PANE })
}

type Part = 'pace' | 'context' | 'line' | 'clock' | 'model'
const PART_KEYS: Part[] = ['pace', 'context', 'line', 'clock', 'model']
const usage = () => T.usage.join('\n')

const describe = (p: Parts) =>
  PART_KEYS.map(k => `${T.names[k]}: ${p[k] ? (k === 'line' && p.tiny ? 'tiny' : 'on') : 'off'}`).join('\n')

/** "context off" -> the parts after it; a string is the reason it was not understood. */
export function applyArgs(current: Parts, args: string): Parts | string {
  const [target, value, ...rest] = args.trim().toLowerCase().split(/\s+/)
  if (rest.length > 0) return usage()
  if (target === 'line' && value === 'tiny') return { ...current, line: true, tiny: true }
  if (value !== undefined && value !== 'on' && value !== 'off') return usage()
  // "line on" is the full line again
  if (target === 'line' && value === 'on') return { ...current, line: true, tiny: false }
  const keys: Part[] = target === 'all' ? PART_KEYS : PART_KEYS.filter(k => k === target)
  if (keys.length === 0) return usage()
  const next = { ...current }
  // "all" without on/off: everything on unless everything already is
  const allOn = keys.every(k => current[k])
  for (const k of keys) next[k] = value === undefined ? (target === 'all' ? !allOn : !current[k]) : value === 'on'
  return next
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    setLanguage(await detectLanguage($))
    await $.command.register({
      name: 'usage-pace',
      description: T.description,
      argumentHint: '[pace|context|line|clock|model|all] [on|off|tiny] | status',
    })
    const saved = await storeGet($, STORE_PARTS)
    const restored = savedParts(saved)
    if (restored) await update($, parts, () => restored)
    await refresh($)
    $.clock.every(MINUTE, async () => {
      await refresh($)
      await update($, tick, n => n + 1)
    })
    const shown = await read($, parts)
    if (shown.pace || shown.context) void $.ui.open({ id: PANE, title: T.title })
    return next(e)
  })

  on('command.run', { command: 'usage-pace' }, async ($, e) => {
    const args = e.args.trim()
    const current = await read($, parts)
    if (args === '') {
      if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
        await $.ui.close({ id: PANE })
        return { text: T.closed }
      }
      const opened = await $.ui.open({ id: PANE, title: T.title })
      return { text: opened.isPlaced ? T.opened : T.notOpened(opened.reason) }
    }
    if (args === 'status') return { text: describe(current) }
    const next = applyArgs(current, args)
    if (typeof next === 'string') return { text: next }
    await update($, parts, () => next)
    await storeSet($, STORE_PARTS, next)
    await setPaneShown($, next)
    await refreshScoped($)
    await drawStatus($)
    return { text: describe(next) }
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) await takeLimits($, e.rateLimits)
    await update($, context, () => ({ ...e.context }))
    await drawStatus($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    isScopedDirty = true
    await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    await read($, tick)
    const shown = await read($, parts)
    const isGraphic = e.surface !== 'terminal' && Svg !== undefined
    // fixed pixels, so the drawing is not scaled to the pane (about 7 px a column)
    const svgWidth = Math.round(clamp(e.props.bodyColumns * 7, 240, 720))
    const sections = []

    if (shown.pace) {
      const paces = await currentPaces($)
      const isStale = await read($, stale)
      if (paces.length === 0) {
        sections.push(<Text dimColor>{T.noUsage}</Text>)
      } else {
        for (const p of paces) {
          sections.push(
            <Box flexDirection="column">
              <Text>
                <Text bold>{p.label}{shown.clock ? T.resetClock(resetClock(p)) : ''} {usedPct(p.used)}</Text>
                <Text dimColor>  {T.untilReset} {duration(p.remainingMs)}{isStale ? `  (${T.staleValue})` : ''}</Text>
              </Text>
              {isGraphic ? (
                <Svg source={meterSvg(p, svgWidth)} width={svgWidth} height={58} alt={`${p.label} ${T.used} ${usedPct(p.used)}, ${T.elapsedShort} ${pct(p.elapsed)}`} />
              ) : (
                <Text>
                  {textBar(p.used)} <Text dimColor>{T.elapsedShort} {pct(p.elapsed)} / {T.projectedShort} {p.projected === null ? '-' : pct(p.projected)}</Text>
                </Text>
              )}
              {p.note && <Text color={p.used >= 100 ? 'red' : 'yellow'}>{p.note}</Text>}
            </Box>,
          )
        }
      }
    }

    if (shown.context) {
      const c = await read($, context)
      const percent = contextPercent(c)
      if (percent === null || c.tokens === undefined) {
        sections.push(<Text dimColor>{T.noContext}</Text>)
      } else {
        const level = contextLevel(percent)
        sections.push(
          <Box flexDirection="column" marginTop="sm">
            <Text>
              <Text bold color={level.text}>{T.context} {percent}% {T.used}</Text>
              <Text dimColor>  {tokens(c.tokens)} / {tokens(c.window, true)}</Text>
            </Text>
            {isGraphic ? (
              <Svg source={contextSvg(percent, svgWidth)} width={svgWidth} height={14} alt={`${T.context} ${percent}% ${T.used}`} />
            ) : (
              <Text color={level.text}>{textBar(percent)}</Text>
            )}
            <Box marginTop="sm">
              <Button key="compact" label="compact" onPress={() => compactNow($)} />
            </Box>
          </Box>,
        )
      }
    }

    if (sections.length === 0) {
      return <Text dimColor>{T.nothing}</Text>
    }
    return (
      <Box flexDirection="column" gap={1}>
        {sections}
      </Box>
    )
  })
}
