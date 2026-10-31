import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BUTTON_COLORS, BUTTON_INKS } from '../hooks/run'

// Nothing here starts herdr or tmux: `process.run` is answered by the stub below, which keeps a pane's
// screen the way the multiplexer would show it, and records what it was asked to run.
const PANE = {
  plugin: 'run-pane',
  component: 'Pane',
  requestId: 'run',
  props: { title: 'Run', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const gt = async ($: Parameters<Parameters<typeof test>[1]>[0], args: string) => ({
  text: (await $.command.run({ command: 'rp', args })).text,
})

type Machine = {
  env: Record<string, string>
  calls: string[][]
  spawned: string[][]
  toasts: string[]
  opened?: string[]
  /** What a pane shows once a command was typed into it (the command's own line included, as a prompt
   * would have it), and whether the command is still running, as a function of how many reads it had. */
  screen?: (cmd: string, reads: number, isInterrupted: boolean) => { text: string; isBusy: boolean }
  /** Panes the multiplexer no longer has. */
  gone?: Set<string>
  /** Panes with a command of the person's running in them. */
  busy?: Set<string>
  /** Panes whose shell has a background job (`cmd &`): nothing in front of the prompt, but not free. */
  jobs?: Set<string>
  /** Whether pgrep is missing, so the jobs cannot be told. */
  isPgrepMissing?: boolean
  /** Whether the hidden tmux server has ended (every shell in it exited). */
  isHiddenGone?: boolean
  /** Whether tmux is installed, for the hidden terminals used where the person has no multiplexer. */
  hasTmux?: boolean
  /** Whether splitting fails. */
  isSplitBroken?: boolean
  settings?: string
}

const done = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

function engine(on: On, machine: Machine): void {
  const typed = new Map<string, string>()
  // What an earlier command left on a pane: the next one is typed under it.
  const earlier = new Map<string, string>()
  const reads = new Map<string, number>()
  const interrupted = new Set<string>()
  let panes = 0
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: { tool: 'mcp__run-pane__run_output' } }))
  on('ui.open', (_, e) => {
    machine.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    machine.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('session.cwd', () => ({ value: '/w/sample-app' }))
  // A real tick, so a pane polled forever does not starve the test of the turns it needs to press a button.
  on('clock.sleep', async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 1))
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('env.get', (_, e) => ({ value: machine.env[e.name] }))
  on('fs.read', (_, e) => {
    if (machine.settings !== undefined && e.path.endsWith('run-pane.json')) return { value: machine.settings }
    throw new Error('missing')
  })
  on('process.spawn', async function* (_, e) {
    machine.spawned.push([...e.argv])
    yield { stream: 'stderr' as const, text: '@@run-pane-pid 4242\n' }
    await new Promise<void>(() => undefined)
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    machine.calls.push(argv)
    const [bin, ...all] = argv
    // The hidden server is the same tmux on a socket of its own.
    const rest = bin === 'tmux' && all[0] === '-L' ? all.slice(2) : all
    if (bin === 'tmux' && rest[0] === '-V') return machine.hasTmux ? done('tmux 3.4\n') : done('', 127, 'tmux: not found')
    if (bin === 'uname') return done('Darwin\n')
    if (bin === 'tmux' && rest[0] === 'has-session') return machine.isHiddenGone ? done('', 1, 'no server running') : done()
    // The hidden server's windows are made by a script that starts tmux itself.
    if (bin === 'sh' && rest[0] === '-c' && rest[1]?.includes('new-window')) return machine.isSplitBroken ? done('', 1, 'no server') : done(`%${++panes}\n`)
    // iTerm2: its panes are ids, driven by osascript; the read and the idle test are `sh` scripts around it.
    const script = bin === 'osascript' ? String(rest[1]) : bin === 'sh' ? String(rest[3]) : ''
    if (script.includes('findSession')) {
      const args = bin === 'osascript' ? rest.slice(3) : rest.slice(4)
      const pane = String(args[0])
      const n = Number(/(\d+)$/.exec(pane)?.[1])
      const gonePane = machine.gone?.has(pane) === true
      if (script.includes('split vertically')) {
        if (machine.gone?.has(pane) || machine.isSplitBroken) return done('', 1, 'no iTerm pane')
        return done(`00000000-0000-0000-0000-${String(++panes).padStart(12, '0')}\n`)
      }
      if (gonePane) return done('', 1, 'no iTerm pane')
      if (script.includes('ASCII character 3')) {
        interrupted.add(pane)
        return done()
      }
      if (script.includes('to close')) {
        machine.gone ??= new Set()
        machine.gone.add(pane)
        return done()
      }
      if (script.includes('write text (item 2')) {
        const before = typed.get(pane)
        if (before !== undefined) earlier.set(pane, `${earlier.get(pane) ?? ''}${machine.screen?.(before, 99, false).text ?? ''}`)
        typed.set(pane, String(args[1]))
        reads.set(pane, 0)
        interrupted.delete(pane)
        return done()
      }
      if (script.includes('return contents')) {
        const count = (reads.get(pane) ?? 0) + 1
        reads.set(pane, count)
        const line = typed.get(pane)
        return done(`${earlier.get(pane) ?? ''}${line === undefined ? '' : (machine.screen?.(line, count, interrupted.has(pane)).text ?? '')}`)
      }
      if (script.includes('return tty')) {
        const line = typed.get(pane)
        const isBusy = line === undefined ? machine.busy?.has(pane) === true : machine.screen?.(line, reads.get(pane) ?? 0, interrupted.has(pane))?.isBusy === true
        // login (its parent is iTerm's), and the shell below it.
        return done(`  90 1 ${isBusy ? 99 : 100 + n}\n ${100 + n} 90 ${isBusy ? 99 : 100 + n}\n`)
      }
    }
    // Whether a pane's shell is at its prompt: herdr's process info, tmux's ps.
    if ((bin === 'herdr' && rest[1] === 'process-info') || (bin === 'sh' && rest[0] === '-c')) {
      const pane = (bin === 'sh' ? argv[4] : argv[argv.length - 1]) as string
      if (machine.gone?.has(pane)) return done('', 1, "can't find pane")
      const line = typed.get(pane)
      const isBusy = line === undefined ? machine.busy?.has(pane) === true : machine.screen?.(line, reads.get(pane) ?? 0, interrupted.has(pane))?.isBusy === true
      // Each pane's shell has a pid of its own, which `pgrep -P` below turns back into the pane.
      const shell = 100 + Number(/(\d+)$/.exec(pane)?.[1])
      const group = isBusy ? 99 : shell
      return done(bin === 'herdr' ? JSON.stringify({ result: { process_info: { foreground_process_group_id: group, shell_pid: shell } } }) : ` ${shell} ${group}\n`)
    }
    if (bin === 'pgrep') {
      if (machine.isPgrepMissing) throw new Error('spawn pgrep ENOENT')
      const pane = [...(machine.jobs ?? [])].find(one => 100 + Number(/(\d+)$/.exec(one)?.[1]) === Number(rest[1]))
      return pane ? done('4242\n') : done('', 1)
    }
    if (bin === 'herdr' || bin === 'tmux') {
      const isHerdr = bin === 'herdr'
      const verb = isHerdr ? rest[1] : rest[0]
      const target = isHerdr ? rest[2] : rest[rest.indexOf('-t') + 1]
      if (verb === 'split' || verb === 'split-window') {
        // A split from a pane that is gone fails, as it does in the multiplexers.
        if (machine.gone?.has(target as string)) return done('', 1, 'pane not found')
        if (machine.isSplitBroken) return done('', 1, 'no such session')
        const id = isHerdr ? `w1:p${++panes}` : `%${++panes}`
        return done(isHerdr ? JSON.stringify({ result: { pane: { pane_id: id } } }) : `${id}\n`)
      }
      if (verb === 'run' || (verb === 'send-keys' && rest.includes('-l'))) {
        const pane = target as string
        const before = typed.get(pane)
        if (before !== undefined) earlier.set(pane, `${earlier.get(pane) ?? ''}${machine.screen?.(before, 99, false).text ?? ''}`)
        typed.set(pane, argv[argv.length - 1] as string)
        reads.set(pane, 0)
        interrupted.delete(pane)
        return done()
      }
      if (verb === 'send-keys' && rest.includes('C-c')) {
        interrupted.add(target as string)
        return done()
      }
      if (verb === 'read' || verb === 'capture-pane') {
        if (machine.gone?.has(target as string)) return done('', 1, "can't find pane")
        const count = (reads.get(target as string) ?? 0) + 1
        reads.set(target as string, count)
        const line = typed.get(target as string)
        const shown = line === undefined ? '' : (machine.screen?.(line, count, interrupted.has(target as string)).text ?? '')
        return done(`${earlier.get(target as string) ?? ''}${shown}`)
      }
      if (verb === 'close' || verb === 'kill-pane') {
        machine.gone ??= new Set()
        machine.gone.add(target as string)
        return done()
      }
    }
    return done()
  })
}

// Work a button left running (a stop waits on ticks of the clock) has no promise to await.
async function until(isMet: () => boolean): Promise<void> {
  for (let tick = 0; tick < 500 && !isMet(); tick++) await new Promise<void>(resolve => setTimeout(resolve, 5))
}

// A run reads over once the tool says so: the poll that ends it runs on a clock of its own, so a test that
// looks at the pane right after /rp would race it.
async function untilOver($: Parameters<Parameters<typeof test>[1]>[0]): Promise<void> {
  for (let tick = 0; tick < 500; tick++) {
    const got = await $.tool.call({ tool: 'mcp__run-pane__run_output' })
    if (/\((done|stopped|exit|killed)/.test(String(got.result))) return
    await new Promise<void>(resolve => setTimeout(resolve, 5))
  }
}

// These tests are about commands that get a terminal, so every command does (`panes: "all"`), unless a test says otherwise.
const ALL = '{"panes":"all"}'
const machineOf = (extra: Partial<Machine> = {}): Machine => ({ env: {}, calls: [], spawned: [], toasts: [], settings: ALL, ...extra })
const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p0' }
const TMUX = { TMUX: '/tmp/tmux-1000/default,1,0', TMUX_PANE: '%0' }
const ITERM_HOME = '36B98952-11FE-4BEB-AABF-EA2E02581F1A'
const ITERM = { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: `w0t0p0:${ITERM_HOME}` }

// A command that prints two lines, runs through its first look and is over on its second.
const PROMPT = 'me@h:~/app$'
const finishing = () => (cmd: string, reads: number) =>
  reads < 2 ? { text: `${PROMPT} ${cmd}\nbuilding\n`, isBusy: true } : { text: `${PROMPT} ${cmd}\nbuilding\ndone\n${PROMPT} `, isBusy: false }

test('in herdr /rp splits a pane on the right, types the command as it is and starts no process of its own', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  // The Run pane opens to follow it, and the reply says where it runs.
  machine.opened = []
  expect((await gt($, 'npm test')).text).toContain('Started #1: npm test (in a herdr pane beside Claude Code)')
  expect(machine.opened).toEqual(['run'])
  expect(machine.spawned).toEqual([])
  await untilOver($)
  expect(machine.calls.find(argv => argv[2] === 'split')).toEqual(['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/w/sample-app', '--no-focus'])
  // Nothing but the command, so the pane reads as the person's own shell.
  expect(machine.calls.find(argv => argv[2] === 'run')).toEqual(['herdr', 'pane', 'run', 'w1:p1', 'npm test'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /done/ })).toBeDefined()
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /building/ })).toBeDefined()
  await ui.unmount()
})

test('in tmux the same: a detached split, the command typed literally, then Enter', async ($, on) => {
  const machine = machineOf({ env: TMUX, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make')

  expect(machine.calls[0]).toEqual(['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-c', '/w/sample-app'])
  expect(machine.calls.find(argv => argv[1] === 'send-keys')).toEqual(['tmux', 'send-keys', '-t', '%1', '-l', '--', 'make'])
  expect(machine.calls.find(argv => argv[3] === '%1' && argv[4] === 'Enter')).toBeDefined()
})

test('the run reads its output without the command line above it or the prompt below it', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()

  const got = await $.tool.call({ tool: 'mcp__run-pane__run_output' })
  expect(String(got.result)).toBe('#1 npm test (done), last 2 of 2 lines:\nbuilding\ndone')
})

test('the next run is split from the last run pane, below it, when something runs in that pane', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(), busy: new Set(['w1:p1']) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run lint')
  await gt($, 'npm test')

  const splits = machine.calls.filter(argv => argv[2] === 'split')
  expect(splits[1]).toEqual(['herdr', 'pane', 'split', 'w1:p1', '--direction', 'down', '--cwd', '/w/sample-app', '--no-focus'])
})

test('when the last run pane was closed, the next run starts a column again', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run lint')
  machine.gone = new Set(['w1:p1'])
  const split = machine.calls.length
  await gt($, 'npm test')

  const after = machine.calls.slice(split).filter(argv => argv[2] === 'split')
  expect(after.some(argv => argv.includes('--current'))).toBe(true)
})

test('Stop types Ctrl+C into the pane and the run reads stopped once the shell is at its prompt again', async ($, on) => {
  const machine = machineOf({
    env: HERDR,
    screen: (cmd, _reads, isInterrupted) =>
      isInterrupted ? { text: `${PROMPT} ${cmd}\nready\n^C\n${PROMPT} `, isBusy: false } : { text: `${PROMPT} ${cmd}\nready\n`, isBusy: true },
  })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:1' })
  await until(() => machine.calls.some(argv => argv[2] === 'send-keys'))
  expect(machine.calls).toContainEqual(['herdr', 'pane', 'send-keys', 'w1:p1', 'C-c'])
  expect(machine.calls.some(argv => argv[2] === 'close')).toBe(false)
  await untilOver($)
  expect(await ui.find({ type: 'Text', text: /stopped/ })).toBeDefined()
  await ui.unmount()
})

test('a run that ignores Ctrl+C has its pane closed', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: cmd => ({ text: `${PROMPT} ${cmd}\nstuck\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'stuck')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:1' })
  await until(() => machine.calls.some(argv => argv[2] === 'close'))
  expect(machine.calls).toContainEqual(['herdr', 'pane', 'close', 'w1:p1'])
  // The run reads stopped once its poll sees the pane gone, and the pane redraws a moment after.
  await untilOver($)
  expect(await ui.find({ type: 'Text', text: /stopped/ })).toBeDefined()
  await ui.unmount()
})

test('a pane the person closes ends the run as stopped, after a few misses and not one', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: cmd => ({ text: `${PROMPT} ${cmd}\nrunning\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  machine.gone = new Set(['w1:p1'])
  await until(() => machine.calls.filter(argv => argv[2] === 'read').length >= 5)
  await new Promise<void>(resolve => setTimeout(resolve, 50))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /pane was closed/ })).toBeDefined()
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  await ui.unmount()
})

test('Remove closes the finished run pane, and Restart types the command again where it is free', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  await untilOver($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.press({ key: 'restart:1' })
  await until(() => machine.calls.filter(argv => argv[2] === 'run').length === 2)
  expect(machine.calls.filter(argv => argv[2] === 'split')).toHaveLength(1)
  expect(machine.calls.filter(argv => argv[2] === 'run').map(argv => argv[3])).toEqual(['w1:p1', 'w1:p1'])
  await untilOver($)
  await ui.find({ key: 'remove:2' })
  await ui.press({ key: 'remove:2' })
  expect(machine.calls).toContainEqual(['herdr', 'pane', 'close', 'w1:p1'])
  await ui.unmount()
})

test('where no pane can be made the command runs as a process of the mod, as without a multiplexer', async ($, on) => {
  const machine = machineOf({ env: HERDR, isSplitBroken: true })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  machine.opened = []
  expect((await gt($, 'npm test')).text).toContain('Started #1: npm test')
  expect(machine.spawned).toHaveLength(1)
  // Nothing else shows this run, so the Run pane opens.
  expect(machine.opened).toEqual(['run'])
})

test('a command of several lines is not typed into a pane, where it would run line by line', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'echo a\necho b')

  expect(machine.spawned).toHaveLength(1)
  expect(machine.calls.some(argv => argv[2] === 'split')).toBe(false)
})

test('"multiplexer": false in run-pane.json keeps the commands out of the panes', async ($, on) => {
  const machine = machineOf({ env: HERDR, settings: '{"multiplexer":false}' })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  expect(machine.spawned).toHaveLength(1)
  expect(machine.calls.some(argv => argv[0] === 'herdr')).toBe(false)
})

test('outside a multiplexer nothing asks one for a pane', async ($, on) => {
  const machine = machineOf()
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  expect(machine.spawned).toHaveLength(1)
  // Only whether tmux is there, which it is not.
  expect(machine.calls).toEqual([['tmux', '-V']])
})

test('/shell splits a focused pane in the folder, in herdr and in tmux', async ($, on) => {
  const herdr = machineOf({ env: HERDR })
  engine(on, herdr)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  const said = await $.command.run({ command: 'shell', args: '' })
  expect(herdr.calls).toEqual([['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/w/sample-app', '--focus']])
  expect(said.text).toBe('Opened a shell pane in herdr: /w/sample-app')
})

test('/shell in tmux, and when the split fails it says why in one line', async ($, on) => {
  const machine = machineOf({ env: TMUX, isSplitBroken: true })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  const said = await $.command.run({ command: 'shell', args: '' })
  expect(machine.calls).toEqual([['tmux', 'split-window', '-h', '-P', '-F', '#{pane_id}', '-c', '/w/sample-app']])
  expect(said.text).toBe('Could not open a pane in tmux: no such session')
})

test('/rp alone opens the Run pane in a multiplexer too', async ($, on) => {
  const machine = machineOf({ env: HERDR, opened: [] })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, '')
  expect(machine.opened).toEqual(['run'])
})

test('a pane with nothing running in it is used again with its history kept, and the same command is told from its earlier run', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()
  // Typed again, the same line: the old one on the pane is not this run's.
  await gt($, 'npm test')
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await again.find({ key: 'restart:2' })
  await again.unmount()

  expect(machine.calls.filter(argv => argv[2] === 'split')).toHaveLength(1)
  expect(machine.calls.filter(argv => argv[2] === 'run').map(argv => [argv[3], argv[4]])).toEqual([['w1:p1', 'npm test'], ['w1:p1', 'npm test']])
  expect(machine.calls.some(argv => argv[2] === 'close' || argv[2] === 'send-keys')).toBe(false)
})

test('a pane is not used again while a run of the mod is in it', async ($, on) => {
  const running = machineOf({ env: HERDR, screen: cmd => ({ text: `${PROMPT} ${cmd}\nready\n`, isBusy: true }) })
  engine(on, running)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  await gt($, 'npm run lint')
  // The first is still running: the second gets a pane of its own, below it.
  expect(running.calls.filter(argv => argv[2] === 'split').map(argv => argv[3])).toEqual(['--current', 'w1:p1'])
})

test('a busy pane of the person gets a new one', async ($, on) => {
  const machine = machineOf({ env: TMUX, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make a')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()

  machine.busy = new Set(['%1'])
  // The person typed their own command there: the stub reports a pane that has none of this mod's as busy.
  machine.screen = cmd => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true })
  await gt($, 'make b')
  expect(machine.calls.filter(argv => argv[1] === 'split-window')[1]).toEqual(['tmux', 'split-window', '-d', '-v', '-P', '-F', '#{pane_id}', '-c', '/w/sample-app', '-t', '%1'])
})

const ending = (reason: 'prompt_input_exit' | 'clear') => ({ reason, sessionId: 's1', resume: { id: 's1' } }) as never

test('leaving the session closes every pane the mod opened, runs and /shell ones, and nothing else', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: cmd => ({ text: `${PROMPT} ${cmd}\nready\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  await gt($, 'npm run lint')
  await $.command.run({ command: 'shell', args: '' })
  const before = machine.calls.length

  await $.session.end(ending('prompt_input_exit'))
  const closed = machine.calls.slice(before).filter(argv => argv[2] === 'close').map(argv => argv[3])
  expect(closed.sort()).toEqual(['w1:p1', 'w1:p2', 'w1:p3'])
  // Not asked to stop first: the exit has about a second.
  expect(machine.calls.slice(before).some(argv => argv[2] === 'send-keys')).toBe(false)
})

test('a /clear keeps the panes, and a pane already closed is not closed twice', async ($, on) => {
  const machine = machineOf({ env: TMUX, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make')
  await untilOver($)
  await $.session.end(ending('clear'))
  expect(machine.calls.some(argv => argv[1] === 'kill-pane')).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'remove:1' })
  await ui.press({ key: 'remove:1' })
  const closedBefore = machine.calls.filter(argv => argv[1] === 'kill-pane').length
  await $.session.end(ending('prompt_input_exit'))
  expect(closedBefore).toBe(1)
  expect(machine.calls.filter(argv => argv[1] === 'kill-pane')).toHaveLength(1)
  await ui.unmount()
})

test('a pane whose shell has a background job is not used again: it prints there, so the run gets a pane of its own', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()

  // The person started `while true; do ./script.sh; sleep 1; done &` there: the prompt is back, the loop is not over.
  machine.jobs = new Set(['w1:p1'])
  await gt($, 'echo second')
  const splits = machine.calls.filter(argv => argv[2] === 'split')
  expect(splits).toHaveLength(2)
  expect(splits[1]).toEqual(['herdr', 'pane', 'split', 'w1:p1', '--direction', 'down', '--cwd', '/w/sample-app', '--no-focus'])
  expect(machine.calls.filter(argv => argv[2] === 'run').map(argv => argv[3])).toEqual(['w1:p1', 'w1:p2'])
})

test('the same in tmux, and a finished background job frees the pane again', async ($, on) => {
  const machine = machineOf({ env: TMUX, screen: finishing(), jobs: new Set(['%1']) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make a')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()
  await gt($, 'make b')
  expect(machine.calls.filter(argv => argv[1] === 'split-window')).toHaveLength(2)

  machine.jobs = new Set()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await again.find({ key: 'restart:2' })
  await again.unmount()
  await gt($, 'make c')
  expect(machine.calls.filter(argv => argv[1] === 'split-window')).toHaveLength(2)
  expect(machine.calls).toContainEqual(['tmux', 'send-keys', '-t', '%2', '-l', '--', 'make c'])
})

test('where pgrep cannot run the jobs are not assumed, and the pane is used again', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(), isPgrepMissing: true })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()
  await gt($, 'npm run lint')
  expect(machine.calls.filter(argv => argv[2] === 'split')).toHaveLength(1)
})

test('without a multiplexer of the person\'s, a command runs in a window of a hidden tmux server and the Run pane follows it', async ($, on) => {
  const machine = machineOf({ hasTmux: true, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  machine.opened = []
  // Nobody sees the hidden window, so the Run pane opens.
  expect((await gt($, 'vi notes.txt')).text).toContain('Started #1')
  expect(machine.opened).toEqual(['run'])
  expect(machine.spawned).toEqual([])
  await untilOver($)
  const split = machine.calls.find(argv => argv[0] === 'sh' && argv[2]?.includes('new-window'))
  expect(split?.slice(3)).toEqual(['sh', '/w/sample-app'])
  expect(split?.[2]).toContain('tmux -L run-pane')
  expect(machine.calls.find(argv => argv[1] === '-L' && argv.includes('-l'))).toEqual(['tmux', '-L', 'run-pane', 'send-keys', '-t', '%1', '-l', '--', 'vi notes.txt'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /building/ })).toBeDefined()
  await ui.unmount()
})

test('a running hidden run has an Attach button that opens a window on the hidden server, at its window', async ($, on) => {
  const machine = machineOf({ hasTmux: true, screen: cmd => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi notes.txt')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'attach:1' })
  await until(() => machine.calls.some(argv => argv[0] === 'osascript'))
  expect(machine.calls).toContainEqual(['tmux', '-L', 'run-pane', 'select-window', '-t', '%1'])
  const window = machine.calls.find(argv => argv[0] === 'osascript')
  expect(window?.slice(3)).toEqual(['--', 'env -u TMUX tmux -L run-pane attach -t run-pane', 'run #1'])
  await ui.unmount()
})

test('where tmux is missing the command runs as a process of the mod', async ($, on) => {
  const machine = machineOf({ hasTmux: false })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  await gt($, 'npm run lint')

  expect(machine.spawned).toHaveLength(2)
  // Asked once.
  expect(machine.calls.filter(argv => argv[0] === 'tmux')).toEqual([['tmux', '-V']])
})

test('"multiplexer": false keeps the hidden terminals away too', async ($, on) => {
  const machine = machineOf({ hasTmux: true, settings: '{"multiplexer":false}' })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  expect(machine.spawned).toHaveLength(1)
  expect(machine.calls).toEqual([])
})

test('leaving the session ends the hidden server; a /clear leaves it', async ($, on) => {
  const machine = machineOf({ hasTmux: true, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  await $.session.end(ending('clear'))
  expect(machine.calls.some(argv => argv.includes('kill-server'))).toBe(false)
  await $.session.end(ending('prompt_input_exit'))
  expect(machine.calls).toContainEqual(['tmux', '-L', 'run-pane', 'kill-server'])
})

test('/shell does not use the hidden server: nobody would see that pane', async ($, on) => {
  const machine = machineOf({ hasTmux: true })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'shell', args: '' })

  expect(machine.calls.some(argv => argv[0] === 'tmux')).toBe(false)
})

test('a pane just made is looked at until its shell has settled before the command is typed into it', async ($, on) => {
  const machine = machineOf({ hasTmux: true, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi notes.txt')

  const typedAt = machine.calls.findIndex(argv => argv.includes('-l'))
  expect(typedAt).toBeGreaterThan(0)
  // More than the one read that counts the command's earlier echoes: the stub's pane never shows a prompt,
  // so the wait runs its course and the command is typed anyway.
  expect(machine.calls.slice(0, typedAt).filter(argv => argv.includes('capture-pane')).length).toBeGreaterThan(2)
})

test('in iTerm2 /rp splits a pane on the right of the pane Claude Code runs in and types the command there', async ($, on) => {
  const machine = machineOf({ env: ITERM, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  machine.opened = []
  expect((await gt($, 'vi notes.txt')).text).toContain('Started #1: vi notes.txt (in an iTerm2 pane beside Claude Code)')
  expect(machine.opened).toEqual(['run'])
  expect(machine.spawned).toEqual([])
  // No tmux is asked about: iTerm has its own panes.
  expect(machine.calls.some(argv => argv[0] === 'tmux')).toBe(false)
  const split = machine.calls.find(argv => argv[0] === 'osascript' && argv[2]?.includes('split vertically'))
  expect(split?.slice(3)).toEqual(['--', ITERM_HOME, 'right', '/w/sample-app', 'keep'])
  const typed = machine.calls.find(argv => argv[0] === 'osascript' && argv[2]?.includes('write text (item 2'))
  expect(typed?.slice(3)).toEqual(['--', '00000000-0000-0000-0000-000000000001', 'vi notes.txt'])
  // The command is an argument of the script, never part of its text.
  expect(typed?.[2]).not.toContain('vi notes.txt')

  await untilOver($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /building/ })).toBeDefined()
  expect(await ui.find({ key: 'attach:1' })).toBeUndefined()
  await ui.unmount()
})

test('in iTerm2 the next run is split below the last, Stop types Ctrl+C, and leaving closes the panes', async ($, on) => {
  const machine = machineOf({ env: ITERM, screen: cmd => ({ text: `${PROMPT} ${cmd}\nready\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  await gt($, 'npm test')

  const splits = machine.calls.filter(argv => argv[0] === 'osascript' && argv[2]?.includes('split vertically'))
  expect(splits[1]?.slice(3)).toEqual(['--', '00000000-0000-0000-0000-000000000001', 'down', '/w/sample-app', 'keep'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The newest run is the one the pane shows.
  await ui.press({ key: 'stop:2' })
  await until(() => machine.calls.some(argv => argv[2]?.includes('ASCII character 3')))
  expect(machine.calls.find(argv => argv[2]?.includes('ASCII character 3'))?.slice(3)).toEqual(['--', '00000000-0000-0000-0000-000000000002'])
  await ui.unmount()

  await $.session.end(ending('prompt_input_exit'))
  const closed = machine.calls.filter(argv => argv[2]?.includes('to close')).map(argv => argv[4])
  expect(closed.sort()).toEqual(['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'])
})

test('in iTerm2 a command with a control character is not typed: the pane made for it is closed and the hidden tmux takes the run', async ($, on) => {
  const machine = machineOf({ env: ITERM, hasTmux: true, screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'echo \u0015x')

  expect(machine.calls.some(argv => argv[2]?.includes('write text (item 2'))).toBe(false)
  expect(machine.calls.some(argv => argv[2]?.includes('to close'))).toBe(true)
  expect(machine.calls.some(argv => argv[0] === 'tmux' && argv.includes('send-keys'))).toBe(true)
})

test('in iTerm2 where the split fails and tmux is missing, the command runs as a process of the mod', async ($, on) => {
  const machine = machineOf({ env: ITERM, hasTmux: false, isSplitBroken: true })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  expect(machine.spawned).toHaveLength(1)
})

test('/shell still opens a window in iTerm2, not a pane', async ($, on) => {
  const machine = machineOf({ env: ITERM })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'shell', args: '' })

  expect(machine.calls.some(argv => argv[2]?.includes('split vertically'))).toBe(false)
  expect(machine.calls.some(argv => argv[0] === 'osascript' && argv.includes('/w/sample-app'))).toBe(true)
})

test('Attach on a hidden terminal that has ended says so and opens no window', async ($, on) => {
  const machine = machineOf({ hasTmux: true, screen: cmd => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi notes.txt')
  machine.isHiddenGone = true

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'attach:1' })
  await until(() => machine.toasts.length > 0)
  expect(machine.toasts[0]).toContain('The hidden terminal has ended')
  expect(machine.calls.some(argv => argv[0] === 'osascript')).toBe(false)
  expect(machine.calls.some(argv => argv.includes('select-window'))).toBe(false)
  await ui.unmount()
})

test('by default an ordinary command stays in the Run pane, even inside herdr, and asks for no terminal', async ($, on) => {
  const machine = machineOf({ env: HERDR, hasTmux: true, settings: '{}' })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  expect(machine.spawned).toHaveLength(1)
  expect(machine.calls.some(argv => argv[0] === 'herdr' || argv[0] === 'tmux')).toBe(false)
})

test('a command that needs a terminal gets one, and the Run pane lists it with an Attach next to it', async ($, on) => {
  const machine = machineOf({ hasTmux: true, settings: '{}', screen: cmd => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  machine.opened = []
  const said = (await gt($, 'vim notes.txt')).text
  expect(said).toContain('needs a terminal: press Attach in the Run pane')
  expect(machine.opened).toEqual(['run'])
  expect(machine.spawned).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'attach:1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Needs a terminal: press Attach/ })).toBeDefined()
  await ui.unmount()
})

test('in herdr a command that needs a terminal is typed into a pane beside Claude Code, and the Run pane says so', async ($, on) => {
  const machine = machineOf({ env: HERDR, settings: '{}', screen: cmd => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  expect((await gt($, 'less log.txt')).text).toContain('(in a herdr pane beside Claude Code)')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /in a terminal pane/ })).toBeDefined()
  // The pane is already beside Claude Code: nothing to attach to.
  expect(await ui.find({ key: 'attach:1' })).toBeUndefined()
  await ui.unmount()
})

test('"interactive" in run-pane.json adds commands that get a terminal', async ($, on) => {
  const machine = machineOf({ hasTmux: true, settings: '{"interactive":["mytui"]}', screen: finishing() })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'mytui --go')
  await gt($, 'othertool')

  expect(machine.calls.some(argv => argv.includes('send-keys') && argv.includes('mytui --go'))).toBe(true)
  expect(machine.spawned).toHaveLength(1)
})

test('what a full-screen program shows is the run output while it holds the screen, and the command output once it is over', async ($, on) => {
  let isQuit = false
  const machine = machineOf({
    hasTmux: true,
    settings: '{}',
    screen: (cmd, reads) => {
      if (isQuit) return { text: `${PROMPT} ${cmd}\n${PROMPT} `, isBusy: false }
      // Typed and echoed, then the editor takes the screen: the command line is no longer on it.
      return reads < 2 ? { text: `${PROMPT} ${cmd}\n`, isBusy: true } : { text: 'line one of the file\n~\n~\n-- INSERT --\n', isBusy: true }
    },
  })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi notes.txt')

  const read = async () => String((await $.tool.call({ tool: 'mcp__run-pane__run_output' })).result)
  for (let tick = 0; tick < 400 && !(await read()).includes('-- INSERT --'); tick++) await new Promise<void>(resolve => setTimeout(resolve, 5))
  expect(await read()).toContain('-- INSERT --')
  expect(await read()).toContain('(running)')
  isQuit = true
  await untilOver($)
  expect(await read()).toContain('(done)')
  expect(await read()).not.toContain('-- INSERT --')
})

test('Open in shell on a run in a hidden terminal is the Attach, and in a pane beside Claude Code it says so', async ($, on) => {
  const busy = { screen: (cmd: string) => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true }) }
  const hidden = machineOf({ hasTmux: true, settings: '{}', ...busy })
  engine(on, hidden)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi notes.txt')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'shell' })
  await until(() => hidden.calls.some(argv => argv[0] === 'osascript'))
  expect(hidden.calls.find(argv => argv[0] === 'osascript')?.slice(3)).toEqual(['--', 'env -u TMUX tmux -L run-pane attach -t run-pane', 'run #1'])
  // No second window made for it.
  expect(hidden.calls.filter(argv => argv[0] === 'sh' && argv[2]?.includes('new-window'))).toHaveLength(1)
  await ui.unmount()
})

test('the Attach button has a space before it in the run row and a background', async ($, on) => {
  const machine = machineOf({ hasTmux: true, settings: '{}', screen: cmd => ({ text: `${PROMPT} ${cmd}\n`, isBusy: true }) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi package.json')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = await ui.find({ type: 'Box', text: /vi package\.json.*running.*Attach/ })
  // `vi package.json running` then a space, then the button: "running [ Attach ]".
  expect(row?.text).toMatch(/running\s+Attach/)
  expect((await ui.find({ type: 'Text', text: ' Attach ' }))?.props).toMatchObject({ inverse: true, color: BUTTON_COLORS.primary, backgroundColor: BUTTON_INKS.primary })
  await ui.unmount()
})
