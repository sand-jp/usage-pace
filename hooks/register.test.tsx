import { expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { applyArgs, contextLevel, contextPercent, duration, meterSvg, modelTag, pace, pickLanguage, resetClock, scopedLimits, setLanguage, statusLine, tokens } from './register'

const HOUR = 3_600_000
const NOW = Date.parse('2026-11-08T12:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

const PANE = {
  plugin: 'usage-pace',
  component: 'Pane',
  requestId: 'usage-pace',
  props: {
    title: '使用量のペース',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('elapsed share and the pace projection', async () => {
  // 5-hour window, 2.5 h left: half elapsed; 30% used -> 60% at reset
  const half = pace({ kind: 'five_hour', percentUsed: 30, resetsAt: at(2.5 * HOUR) }, NOW)!
  expect(half.elapsed).toBe(50)
  expect(half.projected).toBe(60)
  expect(half.note).toBe(null)

  // 80% used at half time: 100% after another 0.625 h, 1.875 h = 113 min before the reset
  const fast = pace({ kind: 'five_hour', percentUsed: 80, resetsAt: at(2.5 * HOUR) }, NOW)!
  expect(fast.projected).toBe(160)
  expect(fast.note).toBe('リセット113m前に到達見込み')

  // weekly window counts in hours: 40% more takes 56 h of the 84 h left
  const week = pace({ kind: 'seven_day', percentUsed: 60, resetsAt: at(84 * HOUR) }, NOW)!
  expect(week.note).toBe('リセット28h前に到達見込み')

  expect(pace({ kind: 'five_hour', percentUsed: 100, resetsAt: at(HOUR) }, NOW)!.note).toBe('上限に到達')
  expect(pace({ kind: 'five_hour', percentUsed: 0, resetsAt: at(5 * HOUR) }, NOW)!.projected).toBe(null)
  expect(pace({ kind: 'spend_limit', percentUsed: 10 }, NOW)).toBe(null)
  expect(duration(26 * HOUR + 5 * 60_000)).toBe('1d 2h')
})

test('the status line', async () => {
  const short = pace({ kind: 'five_hour', percentUsed: 32, resetsAt: at(2 * HOUR + 55 * 60_000) }, NOW)!
  const week = pace({ kind: 'seven_day', percentUsed: 60, resetsAt: at(84 * HOUR) }, NOW)!
  expect(statusLine([short, week])).toBe('[S] 32% 2h55m e: 76.8% , [W] 60% 3d12h e: 120.0% (-28h)')
  expect(statusLine([])).toBe(undefined)
  expect(statusLine([short], 42)).toBe('[S] 32% 2h55m e: 76.8% , [C] 42%')
  expect(statusLine([short], null, true)).toBe('[S] 32% 2h55m e: 76.8% (前回)')
  expect(statusLine([], 5)).toBe('[C] 5%')
  expect(statusLine([short, week], 42, true, true)).toBe('[S]32%,2h55m,e:76.8%[W]60%,3d12h,e:120.0%(-28h)[C]42%')
})

test('context figures and colours', async () => {
  expect(contextPercent({ window: 200_000 })).toBe(null)
  expect(contextPercent({ tokens: 84_200, window: 200_000 })).toBe(42)
  expect(contextPercent({ tokens: 1, window: 200_000, percent: 41.6 })).toBe(42)
  expect(tokens(84_200)).toBe('84.2k')
  expect(tokens(200_000, true)).toBe('200k')
  expect(tokens(1_000_000, true)).toBe('1M')
  expect(tokens(512)).toBe('512')
  expect(contextLevel(30).text).toBe(undefined)
  expect(contextLevel(55).text).toBe('yellow')
  expect(contextLevel(75).text).toBe('#e07830')
  expect(contextLevel(90).text).toBe('red')
})

test('command arguments', async () => {
  const all = { pace: true, context: true, line: true, tiny: false, clock: true, model: true }
  expect(applyArgs(all, 'line off')).toEqual({ ...all, line: false })
  expect(applyArgs(all, 'context')).toEqual({ ...all, context: false })
  expect(applyArgs(all, 'all')).toEqual({ ...all, pace: false, context: false, line: false, clock: false, model: false })
  expect(applyArgs(all, 'clock off')).toEqual({ ...all, clock: false })
  expect(applyArgs({ ...all, clock: false }, 'clock')).toEqual(all)
  expect(applyArgs({ ...all, line: false }, 'line tiny')).toEqual({ ...all, tiny: true })
  expect(applyArgs({ ...all, tiny: true }, 'line on')).toEqual(all)
  expect(applyArgs({ ...all, tiny: true }, 'line off')).toEqual({ ...all, line: false, tiny: true })
  expect(typeof applyArgs(all, 'pace tiny')).toBe('string')
  expect(applyArgs({ ...all, line: false }, 'all')).toEqual(all)
  expect(applyArgs(all, 'all off')).toEqual({ ...all, pace: false, context: false, line: false, clock: false, model: false })
  expect(typeof applyArgs(all, 'constructor')).toBe('string')
  expect(typeof applyArgs(all, 'line maybe')).toBe('string')
})

test('labels sit on the side of the marker with room', async () => {
  const early = meterSvg(pace({ kind: 'five_hour', percentUsed: 5, resetsAt: at(4.5 * HOUR) }, NOW)!)
  expect(early).toContain('text-anchor="start">▼10.0%経過')
  const late = meterSvg(pace({ kind: 'five_hour', percentUsed: 70, resetsAt: at(HOUR) }, NOW)!)
  expect(late).toContain('text-anchor="end">80.0%経過▼')
  expect(late).toContain('text-anchor="end">87.5%見込み▲')
})

test('the pane before any reading', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /まだ/ }))?.text).toContain('まだ使用量の値が無い')
    await ui.unmount()
  }
})

test('the pane with a reading, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-pace' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: { language: 'japanese' } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('ui.panes', () => ({ value: [] }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { percent: 0 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12.5, resetsAt: at(2 * HOUR) }],
    },
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toContain('13%')
    await ui.unmount()
  }
})

test('a new chat shows the last saved reading, and its context', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-pace' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: { language: 'japanese' } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('ui.panes', () => ({ value: [] }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { tokens: 150_000, window: 200_000, percent: 75 }, rateLimits: [] },
  }))
  store.set('lastLimits', [
    { kind: 'five_hour', percentUsed: 40, resetsAt: at(HOUR) },
    { kind: 'seven_day', percentUsed: 20, resetsAt: at(-HOUR) },
  ])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toContain('前回の値')
  // the weekly window had reset: left out
  expect(await ui.find({ type: 'Text', text: /週間/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /コンテキスト/ }))?.text).toContain('75% 使用')
  await ui.unmount()
})

test('the language follows Claude Code, else the system locale', async () => {
  expect(pickLanguage('japanese', 'en-US')).toBe('ja')
  expect(pickLanguage('日本語', undefined)).toBe('ja')
  expect(pickLanguage('english', 'ja-JP')).toBe('en')
  expect(pickLanguage(undefined, 'ja-JP')).toBe('ja')
  expect(pickLanguage(undefined, 'en-GB')).toBe('en')
  expect(pickLanguage(undefined, undefined)).toBe('en')
  setLanguage('en')
  try {
    const fast = pace({ kind: 'five_hour', percentUsed: 80, resetsAt: at(2.5 * HOUR) }, NOW)!
    expect(fast.label).toBe('5-hour')
    expect(fast.note).toBe('Reaches 100% 113m before the reset')
    expect(meterSvg(fast)).toContain('50.0% elapsed')
    expect(statusLine([fast], null, true)).toBe('[S] 80% 2h30m e: 160.0% (-113m) (last)')
    expect(resetClock({ resetAt: new Date(2026, 10, 14, 9, 5).getTime(), isWeekly: true })).toBe('Sat 9:05')
  } finally {
    setLanguage('ja')
  }
})

test('the reset time, in local time', () => {
  // 2026-11-14 is a Saturday
  const at9 = new Date(2026, 10, 14, 9, 5).getTime()
  expect(resetClock({ resetAt: at9, isWeekly: false })).toBe('9:05')
  expect(resetClock({ resetAt: at9, isWeekly: true })).toBe('土 9:05')
  expect(resetClock({ resetAt: new Date(2026, 10, 14, 14, 30).getTime(), isWeekly: false })).toBe('14:30')
})

// the usage endpoint's rows, as it answered on a Max plan (2026-11-10)
const USAGE_BODY = {
  five_hour: { utilization: 14, resets_at: at(3 * HOUR) },
  limits: [
    { kind: 'session', group: 'session', percent: 14, severity: 'normal', resets_at: at(3 * HOUR), scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 88, severity: 'warning', resets_at: at(15 * HOUR), scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 21, severity: 'normal', resets_at: at(15 * HOUR), scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 5, severity: 'normal', resets_at: at(15 * HOUR), scope: { model: null, surface: { display_name: 'Cowork' } }, is_active: false },
  ],
}

test('the per-model weekly windows of the usage endpoint', () => {
  expect(scopedLimits(USAGE_BODY)).toEqual([{ kind: 'seven_day_model', percentUsed: 21, model: 'Fable', resetsAt: at(15 * HOUR) }])
  expect(scopedLimits({})).toEqual([])
  expect(scopedLimits(null)).toEqual([])
  expect(scopedLimits({ limits: [null, 3, { kind: 'weekly_scoped', percent: 'x', scope: { model: { display_name: 'Fable' } } }] })).toEqual([])

  const fable = pace({ kind: 'seven_day_model', percentUsed: 30, model: 'Fable', resetsAt: at(84 * HOUR) }, NOW)!
  expect(fable.label).toBe('Fable')
  expect(fable.tag).toBe('F')
  expect(fable.isWeekly).toBe(true)
  expect(fable.projected).toBe(60)
  expect(modelTag('Sonnet')).toBe('SO')
  expect(modelTag('Opus')).toBe('O')
  expect(modelTag('')).toBe('M')
})

function chat(on: On, store: Map<string, unknown>) {
  on('command.register', () => ({ value: { command: 'usage-pace' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: { language: 'japanese' } }))
  on('ui.panes', () => ({ value: [] }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { percent: 0 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 88, resetsAt: at(15 * HOUR) }],
    },
  }) as never)
}

// the command as the person types it
const typed = (args: string) => ({ command: 'usage-pace', args }) as CommandRunInput

test('the Fable gauge: asked once, shown in the pane and the line', async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = mock.clock(on, { now: NOW })
  chat(on, store)
  const asked: string[] = []
  let lastStatus: string | undefined
  on('ui.status', (_, e) => {
    lastStatus = e.text
    return { value: undefined }
  })
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('http.fetch', (_, e) => {
    asked.push(`${e.url} ${e.init?.auth}`)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(USAGE_BODY) } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(asked).toEqual(['https://api.anthropic.com/api/oauth/usage h1'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Fable/ }))?.text).toContain('21%')
    await ui.unmount()
  }
  expect(lastStatus).toContain('[F] 21%')

  // a reading shared by the chats: not asked again within 5 minutes
  await $.command.run(typed('model on'))
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(store.get('lastScoped')).toEqual({ at: NOW, limits: scopedLimits(USAGE_BODY) })
})

test('no Fable gauge when it is off, and none past its reset', async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = mock.clock(on, { now: NOW })
  chat(on, store)
  let asked = 0
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('http.fetch', () => {
    asked++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(USAGE_BODY) } }
  })
  store.set('parts', { pace: true, context: true, line: true, tiny: false, clock: true, model: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(asked).toBe(0)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Fable/ })).toBe(undefined)
  await ui.unmount()

  // on again, with a fresh saved reading whose window has reset: not shown, not asked
  store.set('lastScoped', { at: NOW, limits: [{ kind: 'seven_day_model', percentUsed: 50, model: 'Fable', resetsAt: at(-HOUR) }] })
  await $.command.run(typed('model on'))
  await clock.settle()
  expect(asked).toBe(0)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Fable/ })).toBe(undefined)
  await ui.unmount()
})

test('no first-party credential: no request, no gauge', async ($, on) => {
  const store = new Map<string, unknown>()
  const clock = mock.clock(on, { now: NOW })
  chat(on, store)
  let asked = 0
  on('session.authorize', () => ({ value: null }))
  on('http.fetch', () => {
    asked++
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(asked).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /週間/ }))?.text).toContain('88%')
  expect(await ui.find({ type: 'Text', text: /Fable/ })).toBe(undefined)
  await ui.unmount()
})

test('a broken store file: the pane still shows this chat, Fable included', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'usage-pace' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: { language: 'japanese' } }))
  on('ui.panes', () => ({ value: [] }))
  // as the engine answers a store file that is not JSON
  on('store.get', () => {
    throw new Error('store file is malformed')
  })
  on('store.set', () => {
    throw new Error('store file is malformed')
  })
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: at(2 * HOUR) }] },
  }) as never)
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(USAGE_BODY) } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toContain('12%')
  expect((await ui.find({ type: 'Text', text: /Fable/ }))?.text).toContain('21%')
  await ui.unmount()
})
