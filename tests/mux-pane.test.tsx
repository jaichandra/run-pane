import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EXIT_MARKER, typedLine } from '../hooks/mux'

// The word that tells a run's end from another's: the last quoted word of the line typed for it.
const tokenOf = (line: string): string => /'([a-z0-9]+)'$/.exec(line)?.[1] ?? ''

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
  /** What each pane shows after the command was typed into it, as a function of how many reads it had. */
  screen?: (typed: string, reads: number, isInterrupted: boolean) => string
  /** Panes the multiplexer no longer has. */
  gone?: Set<string>
  /** Panes with a command of the person's running in them. */
  busy?: Set<string>
  /** Whether splitting fails. */
  isSplitBroken?: boolean
  settings?: string
}

const done = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

function engine(on: On, machine: Machine): void {
  const typed = new Map<string, string>()
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
  on('session.cwd', () => ({ value: '/w/sample-app' }))
  // A real tick, so a pane polled forever does not starve the test of the turns it needs to press a button.
  on('clock.sleep', async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 1))
    return { value: undefined }
  })
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
    const [bin, ...rest] = argv
    // Whether a pane's shell is at its prompt: herdr's process info, tmux's ps.
    if ((bin === 'herdr' && rest[1] === 'process-info') || (bin === 'sh' && rest[0] === '-c')) {
      const pane = argv[argv.length - 1] as string
      if (machine.gone?.has(pane)) return done('', 1, "can't find pane")
      const group = machine.busy?.has(pane) ? 99 : 41
      return done(bin === 'herdr' ? JSON.stringify({ result: { process_info: { foreground_process_group_id: group, shell_pid: 41 } } }) : ` 41 ${group}\n`)
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
        typed.set(target as string, argv[argv.length - 1] as string)
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
        const line = typed.get(target as string) ?? ''
        return done(machine.screen?.(line, count, interrupted.has(target as string)) ?? '')
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

const machineOf = (extra: Partial<Machine> = {}): Machine => ({ env: {}, calls: [], spawned: [], toasts: [], ...extra })
const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p0' }
const TMUX = { TMUX: '/tmp/tmux-1000/default,1,0', TMUX_PANE: '%0' }

// A command that prints a line and exits with a code on its second look.
const finishing = (code: number) => (typed: string, reads: number) =>
  reads < 2 ? `$ ${typed}\nbuilding\n` : `$ ${typed}\nbuilding\ndone\n\n${EXIT_MARKER} ${tokenOf(typed)} ${code}\n$ `

test('in herdr /rp splits a pane on the right, types the wrapped command and starts no process of its own', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(0) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  // The command is in the herdr pane already: the Run pane stays shut until /rp asks for it.
  machine.opened = []
  expect((await gt($, 'npm test')).text).toBe('Started #1 in a herdr pane: npm test. /rp opens the Run pane.')
  expect(machine.opened).toEqual([])
  expect(machine.spawned).toEqual([])
  expect(machine.calls[0]).toEqual(['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/w/sample-app', '--no-focus'])
  const typed = machine.calls[1] as string[]
  expect(typed.slice(0, 4)).toEqual(['herdr', 'pane', 'run', 'w1:p1'])
  expect(typed[4]).toBe(typedLine('npm test', tokenOf(typed[4] as string)))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /done/ })).toBeDefined()
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /exit 0/ })).toBeDefined()
  await ui.unmount()
})

test('in tmux the same: a detached split, the line typed literally, then Enter', async ($, on) => {
  const machine = machineOf({ env: TMUX, screen: finishing(2) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make')

  expect(machine.calls[0]).toEqual(['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-c', '/w/sample-app'])
  const typed = machine.calls[1] as string[]
  expect(typed.slice(0, 5)).toEqual(['tmux', 'send-keys', '-t', '%1', '-l'])
  expect(typed[6]).toBe(typedLine('make', tokenOf(typed[6] as string)))
  expect(machine.calls[2]).toEqual(['tmux', 'send-keys', '-t', '%1', 'Enter'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /exit 2/ })).toBeDefined()
  await ui.unmount()
})

test('the next run is split from the last run pane, below it, when something runs in that pane', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(0), busy: new Set(['w1:p1']) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run lint')
  await gt($, 'npm test')

  const splits = machine.calls.filter(argv => argv[2] === 'split')
  expect(splits[1]).toEqual(['herdr', 'pane', 'split', 'w1:p1', '--direction', 'down', '--cwd', '/w/sample-app', '--no-focus'])
})

test('when the last run pane was closed, the next run starts a column again', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(0) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run lint')
  machine.gone = new Set(['w1:p1'])
  const split = machine.calls.length
  await gt($, 'npm test')

  const after = machine.calls.slice(split).filter(argv => argv[2] === 'split')
  expect(after.some(argv => argv.includes('--current'))).toBe(true)
})

test('Stop types Ctrl+C into the pane and the run reads stopped when the wrapper reports 130', async ($, on) => {
  const machine = machineOf({
    env: HERDR,
    screen: (typed, _reads, isInterrupted) => (isInterrupted ? `$ ${typed}\nready\n^C\n\n${EXIT_MARKER} ${tokenOf(typed)} 130\n$ ` : `$ ${typed}\nready\n`),
  })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:1' })
  await until(() => machine.calls.some(argv => argv[2] === 'send-keys'))
  expect(machine.calls).toContainEqual(['herdr', 'pane', 'send-keys', 'w1:p1', 'C-c'])
  expect(machine.calls.some(argv => argv[2] === 'close')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /stopped/ })).toBeDefined()
  await ui.unmount()
})

test('a run that ignores Ctrl+C has its pane closed', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: typed => `$ ${typed}\nstuck\n` })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'stuck')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:1' })
  await until(() => machine.calls.some(argv => argv[2] === 'close'))
  expect(machine.calls).toContainEqual(['herdr', 'pane', 'close', 'w1:p1'])
  expect(await ui.find({ type: 'Text', text: /stopped/ })).toBeDefined()
  await ui.unmount()
})

test('a pane the person closes ends the run as stopped, after a few misses and not one', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: typed => `$ ${typed}\nrunning\n` })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  machine.gone = new Set(['w1:p1'])
  await gt($, 'npm run dev')
  await until(() => machine.calls.filter(argv => argv[2] === 'read').length >= 3)
  await new Promise<void>(resolve => setTimeout(resolve, 50))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(machine.calls.filter(argv => argv[2] === 'read')).toHaveLength(3)
  expect(await ui.find({ type: 'Text', text: /pane was closed/ })).toBeDefined()
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  await ui.unmount()
})

test('Remove and Restart close the finished run pane', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(0) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'remove:1' })
  await ui.press({ key: 'remove:1' })
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
  expect(machine.calls).toEqual([])
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

test('a pane with nothing running in it is used again, and each run is read by its own token', async ($, on) => {
  const machine = machineOf({ env: HERDR, screen: finishing(0) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run lint')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()
  await gt($, 'npm test')

  expect(machine.calls.filter(argv => argv[2] === 'split')).toHaveLength(1)
  const typed = machine.calls.filter(argv => argv[2] === 'run').map(argv => argv[4] as string)
  expect(typed).toHaveLength(2)
  expect(typed.every(line => machine.calls.some(argv => argv[3] === 'w1:p1' && argv[4] === line))).toBe(true)
  expect(tokenOf(typed[0] as string)).not.toBe(tokenOf(typed[1] as string))
})

test('a pane is not used again while a run of the mod is in it, nor while the person has something running in it', async ($, on) => {
  const running = machineOf({ env: HERDR, screen: typed => `$ ${typed}\nready\n` })
  engine(on, running)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  await gt($, 'npm run lint')
  // The first is still running: the second gets a pane of its own, below it.
  expect(running.calls.filter(argv => argv[2] === 'split').map(argv => argv[3])).toEqual(['--current', 'w1:p1'])
})

test('a busy pane of the person gets a new one, a closed one too', async ($, on) => {
  const machine = machineOf({ env: TMUX, screen: finishing(0) })
  engine(on, machine)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make a')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ key: 'restart:1' })
  await ui.unmount()

  machine.busy = new Set(['%1'])
  await gt($, 'make b')
  expect(machine.calls.filter(argv => argv[1] === 'split-window')).toHaveLength(2)
  expect(machine.calls.filter(argv => argv[1] === 'split-window')[1]).toEqual(['tmux', 'split-window', '-d', '-v', '-P', '-F', '#{pane_id}', '-c', '/w/sample-app', '-t', '%1'])
})
