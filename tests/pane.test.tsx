import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'run-pane',
  component: 'Pane',
  requestId: 'run',
  props: {
    title: 'Run',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const status: (string | undefined)[] = []

// What the person's `> <command>` prompt does; the answer's `text` is what the pane tells them.
const gt = async ($: Parameters<Parameters<typeof test>[1]>[0], args: string) => ({
  text: (await $.prompt.submit({ text: `>${args ? ' ' + args : ''}`, origin: { kind: 'composer' }, wait: false })).drop,
})

// Stands for the engine beneath the mod: the calls the mod makes are answered here.
function engine(
  on: On,
  process: { calls: string[][]; lines: string[]; remote?: string; opened?: string[] },
  files: Record<string, string> = { 'package.json': '{"scripts":{"dev":"vite","test":"vitest"}}' },
) {
  on('command.register', () => ({ value: { command: 'dev' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.register', () => ({ value: { tool: 'mcp__run-pane__run_output' } }))
  on('ui.open', (_, e) => {
    process.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w/sample-app' }))
  on('fs.read', (_, e) => {
    const name = Object.keys(files).find(file => e.path.endsWith(file))
    if (name !== undefined) return { value: files[name] as string }
    throw new Error('missing')
  })
  on('process.run', (_, e) => {
    process.calls.push([...e.argv])
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: process.remote ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'ps') return { value: { exitCode: 0, stdout: ' 4242 1\n 4243 4242\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stderr' as const, text: '@@run-pane-pid 4242\n' }
    for (const line of process.lines) yield { stream: 'stdout' as const, text: line }
    // A dev server that goes quiet and stays up.
    await new Promise<void>(() => undefined)
  })
}

test('a > prompt starts a command and the pane lists it with its output and a Stop', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready on :3000\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const ran = await gt($, 'npm run dev')
  expect(ran.text).toContain('Started #1: npm run dev')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /ready on :3000/ }))?.text).toBe('ready on :3000')
  expect(await ui.find({ key: 'stop:1' })).toBeDefined()
  expect(await ui.find({ key: 'hint:npm run test' })).toBeDefined()
  await ui.unmount()
})

test('a prompt starting with > runs the command and never reaches the model', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready on :3000\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const sent = await $.prompt.submit({ text: '> npm run dev', origin: { kind: 'composer' }, wait: false })
  expect(sent.drop).toContain('Started #1: npm run dev')

  const plain = await $.prompt.submit({ text: 'explain >> in bash', origin: { kind: 'composer' }, wait: false })
  expect(plain.drop).toBeUndefined()
})

test('the status line keeps /shell while a command runs', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  status.length = 0
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  expect(status.at(-1)).toBe('\u25b6 1 running \u00b7 > \u00b7 /shell')
  expect(status[0]).toBe('\u25b6 > \u00b7 /shell')
})

test('the buttons are on top and again below the output', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'docker compose up')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'stop:1' })).toBeDefined()
  const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key)
  for (const key of ['stop:1', 'clear:1', 'top', 'end', 'shell', 'close']) {
    expect(keys, key).toContain(key)
    expect(keys, `${key}-b`).toContain(key === 'stop:1' || key === 'clear:1' ? `${key}-b` : `${key}-b`)
  }
  // Ctrl+C is part of Stop, not a button of its own.
  expect(keys.some(key => key?.startsWith('int:'))).toBe(false)
  await ui.unmount()
})

test('Stop signals the whole process tree and the run reads stopped', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  on('clock.sleep', () => ({ value: undefined }))
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:1' })

  // Ctrl+C first, then the signals that force it, each to the whole tree.
  const sent = process.calls.filter(argv => argv[0] === 'kill' && argv[1] !== '-0').map(argv => argv[1])
  expect(sent).toEqual(['-INT', '-TERM', '-KILL'])
  expect(process.calls.find(argv => argv[1] === '-INT')).toEqual(['kill', '-INT', '4242', '4243'])
  expect(await ui.find({ type: 'Text', text: /stopped/ })).toBeDefined()
  expect(await ui.find({ key: 'restart:1' })).toBeDefined()
  await ui.unmount()
})

test('the run_output tool returns the tail of a run for Claude', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['one\n', 'two\n', 'Error: port 3000 in use\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.find({ type: 'Text', text: /port 3000/ })
  await ui.unmount()

  const none = await $.tool.call({ tool: 'mcp__run-pane__run_output', run: 'nothing like it' })
  expect(String(none.result)).toContain('No run matches')

  const got = await $.tool.call({ tool: 'mcp__run-pane__run_output', lines: 2 })
  const text = String(got.result)
  expect(text).toContain('#1 npm run dev (running)')
  expect(text).toContain('Error: port 3000 in use')
  expect(text).not.toContain('one')
})

test('the pane closes from > close and from its Close button, and the runs go on', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ran = await gt($, 'close')
  expect(ran.text).toContain('Run pane closed')
  expect(ran.text).not.toContain('Started')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'close' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Esc leaves runs going/ })).toBeDefined()
  expect(await ui.find({ key: 'shell' })).toBeDefined()
  await ui.press({ key: 'close' })
  await ui.unmount()
})

test('suggestions from run-pane.json come first', async ($, on) => {
  const process = { calls: [] as string[][], lines: [] }
  engine(on, process, {
    'package.json': '{"scripts":{"dev":"vite"}}',
    'run-pane.json': '{"suggestions":["docker compose up","make seed"]}',
  })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, '')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'hint:docker compose up' })).toBeDefined()
  expect(await ui.find({ key: 'hint:make seed' })).toBeDefined()
  expect(await ui.find({ key: 'hint:npm run dev' })).toBeDefined()
  await ui.unmount()
})

test('the pane opens by itself in a folder run-pane.json names', async ($, on) => {
  const process = { calls: [] as string[][], lines: [], remote: 'ssh://git@host/team/Acme-Shop.git\n', opened: [] as string[] }
  engine(on, process, { 'run-pane.json': '{"openFor":["acme"]}' })
  await $.session.start({ cwd: '/w/sample-app.worktrees/PROJ-1', surface: 'terminal', isInteractive: true })
  // Drawing the pane gives the start-up work the time to settle.
  await (await $.ui.mount({ ...PANE, surface: 'terminal' })).unmount()
  expect(process.opened).toEqual(['run'])
})

test('the pane stays closed in a folder run-pane.json does not name', async ($, on) => {
  const other = { calls: [] as string[][], lines: [], remote: 'ssh://git@host/team/other-service.git\n', opened: [] as string[] }
  engine(on, other, { 'run-pane.json': '{"openFor":["acme"]}' })
  await $.session.start({ cwd: '/w/other-service', surface: 'terminal', isInteractive: true })
  // Drawing the pane gives the start-up work the time to settle.
  await (await $.ui.mount({ ...PANE, surface: 'terminal' })).unmount()
  expect(other.opened).toEqual([])
})

test('the output is coloured: a URL underlined, notes dim, a banner green', async ($, on) => {
  const process = {
    calls: [] as string[][],
    lines: ['\u25b6 OPEN THIS IN YOUR BROWSER:\n    http://localhost:3000/\n        # Dev server\n'],
  }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'docker compose up')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Dev server/ })).toBeDefined()
    const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
    expect(texts).toContain('\u25b6 OPEN THIS IN YOUR BROWSER:')
    expect(texts).toContain('http://localhost:3000/')
    expect(texts).toContain('# Dev server')
    await ui.unmount()
  }
})

const PACKAGE = '{"scripts":{"dev":"vite"}}'

// A mod installed on its own has no run-pane.json; one that is broken counts for the same.
for (const [name, files] of [
  ['there is no run-pane.json', { 'package.json': PACKAGE }],
  ['run-pane.json is not JSON', { 'package.json': PACKAGE, 'run-pane.json': 'not json {' }],
  ['run-pane.json is not an object', { 'package.json': PACKAGE, 'run-pane.json': '[1, 2]' }],
] as const) {
  test(`the defaults hold when ${name}`, async ($, on) => {
    const process = { calls: [] as string[][], lines: [], remote: 'ssh://git@host/team/Acme-Shop.git\n', opened: [] as string[] }
    engine(on, process, files)
    await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: 'hint:npm run dev' })).toBeDefined()
    await ui.unmount()
    // No words, so the pane waits for a > prompt and git is never asked.
    expect(process.opened).toEqual([])
    expect(process.calls.filter(argv => argv[0] === 'git')).toEqual([])
  })
}

test('typing > into an empty prompt leaves a space after it, and only then', async ($, on) => {
  const process = { calls: [] as string[][], lines: [] }
  engine(on, process)
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const edit = (text: string, inputText: string) =>
    $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText })
  expect(await edit('', '>')).toMatchObject({ text: '> ', cursor: 2 })
  expect(await edit('a', '>')).toMatchObject({ text: 'a>' })
  expect(await edit('', 'x')).toMatchObject({ text: 'x' })
})
