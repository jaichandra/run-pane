import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { appleScript, ITERM_PATH, NOT_MACOS } from '../hooks/shell'

// Nothing here opens a terminal or runs osascript: `process.run` is answered by the stub below, which
// records the command it was asked to run.
type Machine = {
  /** What `uname -s` prints; null when there is no such command (it cannot start). */
  system?: string | null
  isItermInstalled?: boolean
  /** The terminal Claude Code runs in (`TERM_PROGRAM`). */
  termProgram?: string
  /** How the stubbed osascript ends: an answer, or a command that cannot start. */
  osascript?: { exitCode: number; stdout?: string; stderr?: string } | 'cannot-start'
  cwd?: string
}

type Seen = { calls: string[][]; exists: string[]; toasts: string[]; cwd: string }

const typed = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const

const PANE = {
  plugin: 'run-pane',
  component: 'Pane',
  requestId: 'run',
  props: { title: 'Run', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const done = (stdout = '', stderr = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// Stands for the engine beneath the mod. A command that cannot start answers `{ deny }`, which is how a
// call on `$` rejects.
function engine(on: On, machine: Machine = {}): Seen {
  const { system = 'Darwin', isItermInstalled = false, osascript = { exitCode: 0 }, cwd = '/w/sample-app', termProgram } = machine
  const seen: Seen = { calls: [], exists: [], toasts: [], cwd }
  on('command.register', () => ({ value: { command: 'shell' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__run-pane__run_output' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: seen.cwd }))
  on('fs.read', () => {
    throw new Error('missing')
  })
  on('env.get', (_, e) => ({ value: e.name === 'TERM_PROGRAM' ? termProgram : undefined }))
  on('fs.exists', (_, e) => {
    seen.exists.push(e.path)
    return { value: e.path === ITERM_PATH && isItermInstalled }
  })
  on('process.run', (_, e) => {
    seen.calls.push([...e.argv])
    if (e.argv[0] === 'uname') {
      if (system === null) return { deny: 'spawn uname ENOENT' }
      return done(`${system}\n`)
    }
    if (e.argv[0] === 'osascript') {
      if (osascript === 'cannot-start') return { deny: 'spawn osascript ENOENT' }
      return done(osascript.stdout ?? '', osascript.stderr ?? '', osascript.exitCode)
    }
    throw new Error(`the test did not expect ${e.argv[0]}`)
  })
  return seen
}

const osascripts = (seen: Seen): string[][] => seen.calls.filter(argv => argv[0] === 'osascript')

async function runShell($: Engine, cwd: string): Promise<string> {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  return String((await $.command.run(typed('shell', ''))).text)
}

test('/shell opens a Terminal window when iTerm is not installed', async ($, on) => {
  const seen = engine(on, { isItermInstalled: false })
  const text = await runShell($, '/w/sample-app')

  expect(text).toBe('Opened a shell window in Terminal: /w/sample-app')
  expect(seen.exists).toEqual([ITERM_PATH])
  const [call, ...more] = osascripts(seen)
  expect(more).toEqual([])
  expect(call?.[2]).toContain('tell application "Terminal"')
  expect(call?.[2]).not.toContain('iTerm')
})

test('/shell opens an iTerm window when iTerm is installed', async ($, on) => {
  const seen = engine(on, { isItermInstalled: true })
  const text = await runShell($, '/w/sample-app')

  expect(text).toBe('Opened a shell window in iTerm: /w/sample-app')
  const [call, ...more] = osascripts(seen)
  expect(more).toEqual([])
  expect(call?.[2]).toContain('tell application "iTerm"')
  expect(call?.[2]).not.toContain('tell application "Terminal"')
})

test('the window is titled with the folder name and cd-ed there by AppleScript, not by string building', async ($, on) => {
  const seen = engine(on)
  await runShell($, '/w/sample-app')

  const [call] = osascripts(seen)
  expect(call).toEqual(['osascript', '-e', appleScript('Terminal'), '--', '/w/sample-app', 'sample-app'])
  expect(call?.[2]).toContain('on run argv')
  expect(call?.[2]).toContain('"cd -- " & quoted form of targetDir')
})

// Each of these is a folder name someone could pick on purpose. Every one must reach osascript as an
// argv item after `--`, and never appear in the script, which is the same fixed text for any folder.
const HOSTILE = [
  "/w/it's",
  '/w/say "hi"',
  '/w/back\\slash',
  '/w/$(touch pwned)',
  '/w/`touch pwned`',
  '/w/a; touch pwned; #',
  '/w/a && touch pwned',
  '/w/--help',
  '-rf',
  '/w/with space and é中',
  "/w/'; do shell script \"touch pwned\"; set x to '",
]

for (const app of ['iTerm', 'Terminal'] as const) {
  test(`a hostile folder name is only ever an argv item (${app})`, async ($, on) => {
    const seen = engine(on, { isItermInstalled: app === 'iTerm' })
    await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

    for (const folder of HOSTILE) {
      seen.calls.length = 0
      seen.cwd = folder
      const text = String((await $.command.run(typed('shell', ''))).text)
      expect(text, folder).toContain(`Opened a shell window in ${app}`)

      const [call, ...more] = osascripts(seen)
      expect(more, folder).toEqual([])
      const [exe, flag, script, dashes, item, title, ...rest] = call ?? []
      expect([exe, flag, dashes], folder).toEqual(['osascript', '-e', '--'])
      expect(rest, folder).toEqual([])
      expect(item, folder).toBe(folder)
      expect(title, folder).toBe(folder.split('/').filter(Boolean).pop())
      // The script is the fixed text, so nothing of the folder can be in it.
      expect(script, folder).toBe(appleScript(app))
      expect(script, folder).not.toContain(folder)
      expect(script, folder).not.toContain(String(title))
      expect(script, folder).toContain('quoted form of targetDir')
      // And nothing else the mod ran carries it to a shell.
      expect(seen.calls.filter(argv => argv[0] !== 'osascript').flat(), folder).not.toContain(folder)
    }
  })
}

test('a folder name with a control character is not typed into a terminal', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  for (const folder of ['/w/line\nbreak', '/w/esc\u001b[2Jx', '/w/kill\u0015line', '/w/c1\u009bx']) {
    seen.cwd = folder
    const text = String((await $.command.run(typed('shell', ''))).text)
    expect(text, JSON.stringify(folder)).toContain('control character')
    expect(text).not.toContain('\n')
    expect(osascripts(seen), JSON.stringify(folder)).toEqual([])
  }
})

test('off macOS /shell says so in one line and starts nothing', async ($, on) => {
  const seen = engine(on, { system: 'Linux', isItermInstalled: true })
  const text = await runShell($, '/w/sample-app')

  expect(text).toBe(NOT_MACOS)
  expect(text).not.toContain('\n')
  expect(osascripts(seen)).toEqual([])
  expect(seen.exists).toEqual([])
})

test('where there is no uname at all /shell reads it as not macOS', async ($, on) => {
  const seen = engine(on, { system: null })
  const text = await runShell($, '/w/sample-app')

  expect(text).toBe(NOT_MACOS)
  expect(osascripts(seen)).toEqual([])
})

test('when osascript fails /shell says why in one line, with the terminal it tried', async ($, on) => {
  const seen = engine(on, {
    isItermInstalled: true,
    osascript: { exitCode: 1, stderr: '0:42: execution error: Not authorized to send Apple events to iTerm. (-1743)\n  second line\n' },
  })
  const text = await runShell($, '/w/sample-app')

  // macOS has not allowed the terminal to control iTerm: the way to allow it, and what macOS said, in one line.
  expect(text).toContain('Could not open a window in iTerm: macOS has not allowed this terminal to control iTerm.')
  expect(text).toContain('System Settings > Privacy & Security > Automation')
  expect(text).toContain('(0:42: execution error: Not authorized to send Apple events to iTerm. (-1743) second line)')
  expect(text).not.toContain('\n')
  expect(osascripts(seen)).toHaveLength(1)
})

test('a failing osascript that says nothing is still told by its exit code', async ($, on) => {
  engine(on, { osascript: { exitCode: 3 } })
  expect(await runShell($, '/w/sample-app')).toBe('Could not open a window in Terminal: osascript exited with 3')
})

test('a long osascript message is cut to one short line', async ($, on) => {
  engine(on, { osascript: { exitCode: 1, stderr: `${'word '.repeat(200)}\nend` } })
  const text = await runShell($, '/w/sample-app')
  expect(text).not.toContain('\n')
  expect(text.length).toBeLessThan(260)
  expect(text).toContain('…')
})

test('when osascript cannot start /shell answers instead of throwing', async ($, on) => {
  engine(on, { osascript: 'cannot-start' })
  const text = await runShell($, '/w/sample-app')

  expect(text).toMatch(/^Could not open a terminal window: .*spawn osascript ENOENT/)
  expect(text).not.toContain('\n')
})

test('the pane has a Shell window button that opens the same window and toasts the answer', async ($, on) => {
  const seen = engine(on, { isItermInstalled: true })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'shell' })
  await ui.unmount()

  expect(osascripts(seen)).toHaveLength(1)
  expect(osascripts(seen)[0]?.slice(3)).toEqual(['--', '/w/sample-app', 'sample-app'])
  expect(seen.toasts).toEqual(['Opened a shell window in iTerm: /w/sample-app'])
})

test('the window opens in the terminal Claude Code runs in, which needs no permission, even where iTerm is installed', async ($, on) => {
  const seen = engine(on, { isItermInstalled: true, termProgram: 'Apple_Terminal' })
  const text = await runShell($, '/w/sample-app')

  expect(text).toBe('Opened a shell window in Terminal: /w/sample-app')
  expect(osascripts(seen)[0]?.[2]).toBe(appleScript('Terminal'))
})

test('in iTerm it is iTerm, and in a terminal that is neither it is iTerm where installed', async ($, on) => {
  const inIterm = engine(on, { termProgram: 'iTerm.app' })
  expect(await runShell($, '/w/sample-app')).toBe('Opened a shell window in iTerm: /w/sample-app')
  expect(osascripts(inIterm)[0]?.[2]).toBe(appleScript('iTerm'))
})
