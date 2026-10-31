import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BUTTON_COLORS, BUTTON_INK } from '../hooks/run'

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
const openedColumns: (number | undefined)[] = []

// What the person's `/rp <command>` does; the answer's `text` is what the pane tells them.
const gt = async ($: Parameters<Parameters<typeof test>[1]>[0], args: string) => ({
  text: (await $.command.run({ command: 'rp', args })).text,
})

// Stands for the engine beneath the mod: the calls the mod makes are answered here.
function engine(
  on: On,
  process: { calls: string[][]; lines: string[]; remote?: string; opened?: string[]; toasts?: string[]; writes?: { argv: string[]; stdin?: string | undefined }[]; later?: { gate: Promise<void>; lines: string[] }; isFsHung?: boolean; spawns?: { argv: readonly string[]; env?: Record<string, string> | undefined }[]; existing?: string[] },
  files: Record<string, string> = { 'package.json': '{"scripts":{"dev":"vite","test":"vitest"}}' },
) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.register', () => ({ value: { tool: 'mcp__run-pane__run_output' } }))
  on('ui.open', (_, e) => {
    process.opened?.push(e.id)
    openedColumns.push(e.columns)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    process.toasts?.push(e.text)
    return { value: undefined }
  })
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
    if (e.init?.stdin !== undefined) process.writes?.push({ argv: [...e.argv], stdin: e.init.stdin })
    // No tmux here: the commands are processes of the mod.
    if (e.argv[0] === 'tmux') return { value: { exitCode: 127, stdout: '', stderr: 'tmux: not found', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: process.remote ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'ps') return { value: { exitCode: 0, stdout: ' 4242 1\n 4243 4242\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', async (_, e) => {
    // A file system that never answers: a render must not wait for it.
    if (process.isFsHung) await new Promise<void>(() => undefined)
    return { value: process.existing?.includes(e.path) === true }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/me' : undefined }))
  on('process.spawn', async function* (_, e) {
    process.spawns?.push({ argv: e.argv, env: e.env })
    yield { stream: 'stderr' as const, text: '@@run-pane-pid 4242\n' }
    for (const line of process.lines) yield { stream: 'stdout' as const, text: line }
    if (process.later) {
      await process.later.gate
      for (const line of process.later.lines) yield { stream: 'stdout' as const, text: line }
    }
    // A dev server that goes quiet and stays up.
    await new Promise<void>(() => undefined)
  })
}

test('/rp starts a command and the pane lists it with its output and a Stop', async ($, on) => {
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

test('/rp asks for a 60 column dock and says how to go fullscreen when the pane is inline', async ($, on) => {
  const process = { calls: [] as string[][], lines: [] }
  engine(on, process)
  openedColumns.length = 0
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  expect(openedColumns).toEqual([])
  const opened = await gt($, '')
  expect(openedColumns).toEqual([60])
  expect(opened.text).toContain('CLAUDE_CODE_NO_FLICKER=1 claude')
  expect((await gt($, 'npm run dev')).text).toContain('CLAUDE_CODE_NO_FLICKER=1')
})

test('an inline pane shows the fullscreen hint in the error colour, a docked one does not', async ($, on) => {
  const process = { calls: [] as string[][], lines: [] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const inline = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline' }, surface: 'terminal' })
  expect((await inline.find({ type: 'Text', text: /CLAUDE_CODE_NO_FLICKER=1 claude/ }))?.props?.color).toBe('error')
  await inline.unmount()

  const docked = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await docked.find({ type: 'Text', text: /CLAUDE_CODE_NO_FLICKER/ })).toBeUndefined()
  await docked.unmount()
})

test('a prompt starting with > is left alone, for the model to read', async ($, on) => {
  const process = { calls: [] as string[][], lines: [] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const sent = await $.prompt.submit({ text: '> npm run dev', origin: { kind: 'composer' }, wait: false })
  expect(sent.drop).toBeUndefined()
  expect(process.calls).toEqual([])
})

test('the status line keeps /shell while a command runs', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  status.length = 0
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  expect(status.at(-1)).toBe('\u25b6 1 running \u00b7 /rp \u00b7 /shell')
  expect(status[0]).toBe('\u25b6 /rp \u00b7 /shell')
})

test('the buttons are one row below the output', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'docker compose up')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'stop:1' })).toBeDefined()
  const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key)
  for (const key of ['stop:1', 'clear:1', 'shell', 'close']) {
    expect(keys.filter(one => one === key), key).toHaveLength(1)
  }
  // Scrolling down to the last line follows the output again, so there is no End button, nor a Top.
  expect(keys).not.toContain('end')
  expect(keys).not.toContain('top')
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

test('the pane closes from /rp close and from its Close button, and the runs go on', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ran = await gt($, 'close')
  expect(ran.text).toContain('Run pane closed')
  expect(ran.text).not.toContain('Started')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'close' })).toBeDefined()
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

const ESC = '\u001b'

// Output arrives in pieces after the run starts: wait until the tool has all of what it printed.
async function untilPrinted($: Parameters<Parameters<typeof test>[1]>[0], text: string): Promise<void> {
  for (let tick = 0; tick < 400; tick++) {
    if (String((await $.tool.call({ tool: 'mcp__run-pane__run_output' })).result).includes(text)) return
    await new Promise<void>(resolve => setTimeout(resolve, 5))
  }
}

// A button's face is a pill: a half block in the button's colour, the label on that colour, a half block. Its props.
async function faceOf(ui: { find: (query: never) => Promise<unknown> }, label: string): Promise<{ edge?: unknown; label?: Record<string, unknown>; end?: unknown } | undefined> {
  const pill = (await ui.find({ type: 'Text', text: `\u2590 ${label} \u258c` } as never)) as { children?: { props?: Record<string, unknown> }[] } | undefined
  if (!pill?.children) return undefined
  return { edge: pill.children[0]?.props?.color, label: pill.children[1]?.props, end: pill.children[2]?.props?.color }
}

// The props a part of a line is drawn with: the line is a Text, and each coloured part a Text nested in it.
async function partOf(ui: { find: (query: never) => Promise<unknown> }, line: RegExp, word: string): Promise<Record<string, unknown> | undefined> {
  const row = (await ui.find({ type: 'Text', text: line } as never)) as { children?: unknown[] } | undefined
  const part = row?.children?.find(child => typeof child === 'object' && child !== null && (child as { children?: unknown[] }).children?.[0] === word)
  return (part as { props?: Record<string, unknown> } | undefined)?.props
}

test('a command is a process of the mod, run as it is (no colour forced), and the colours it prints are drawn', async ($, on) => {
  const process = {
    calls: [] as string[][],
    spawns: [] as { argv: readonly string[]; env?: Record<string, string> | undefined }[],
    lines: [`${ESC}[31mfailed${ESC}[0m and ${ESC}[1;32mok${ESC}[0m, ${ESC}[38;5;196mhot${ESC}[0m ${ESC}[38;2;18;52;86mblue${ESC}[0m\n`, `${ESC}[2K${ESC}[3;4mnote${ESC}[0m\n`],
  }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  await untilPrinted($, 'note')

  // No terminal for it, and no change to the environment it runs in: a script may read its tools' output for a
  // phrase (`compiled successfully`), which colour would break.
  expect(process.calls.some(argv => argv[0] === 'tmux')).toBe(false)
  expect(process.spawns[0]?.env).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await partOf(ui, /failed/, 'failed'))?.color).toBe('red')
  const ok = await partOf(ui, /failed/, 'ok')
  expect(ok?.color).toBe('green')
  expect(ok?.bold).toBe(true)
  expect((await partOf(ui, /failed/, 'hot'))?.color).toBe('#ff0000')
  expect((await partOf(ui, /failed/, 'blue'))?.color).toBe('#123456')
  const note = await partOf(ui, /note/, 'note')
  expect(note?.italic).toBe(true)
  expect(note?.underline).toBe(true)
  await ui.unmount()

  // What Claude reads has no escape sequences in it.
  const got = String((await $.tool.call({ tool: 'mcp__run-pane__run_output' })).result)
  expect(got).toContain('failed and ok, hot blue')
  expect(got).not.toContain(ESC)
})

test('a colour on a line goes on into the next ones, and a line with none keeps the colours its looks give it', async ($, on) => {
  const process = { calls: [] as string[][], lines: [`${ESC}[33mwarn one\n`, 'warn two\n', `${ESC}[0m`, '\u25b6 All done\n', 'ERROR: it broke\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'make')
  await untilPrinted($, 'ERROR: it broke')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await partOf(ui, /warn one/, 'warn one'))?.color).toBe('yellow')
  expect((await partOf(ui, /warn two/, 'warn two'))?.color).toBe('yellow')
  // Plain lines: the banner and the error word are told by what they say.
  expect((await partOf(ui, /All done/, '\u25b6 All done'))?.color).toBe('success')
  expect((await partOf(ui, /ERROR: it broke/, 'ERROR: it broke'))?.color).toBe('error')
  await ui.unmount()
})

test('a URL in the output is a press that opens it in the browser', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['Local: https://localhost:3000/app?x=1 (ready)\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const link = await ui.find({ key: 'link:1:0:1' })
  expect(link).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'https://localhost:3000/app?x=1' }))?.props?.underline).toBe(true)
  await ui.press({ key: 'link:1:0:1' })
  await new Promise<void>(resolve => setTimeout(resolve, 20))
  // The URL is an argument of the opener, with no shell around it.
  expect(process.calls).toContainEqual(['open', 'https://localhost:3000/app?x=1'])
  await ui.unmount()
})

test('a file in the output that exists is a press that opens it, one that does not stays text', async ($, on) => {
  const process = {
    calls: [] as string[][],
    existing: ['/w/sample-app/src/app.ts', '/Users/me/notes/a.md'],
    lines: ['src/app.ts:12:5 - error TS1\n', 'see ~/notes/a.md\n', 'src/gone.ts:1 and a/b\n'],
  }
  engine(on, process)
  // The redraw after the lookup waits its debounce on the clock: a short real one.
  on('clock.sleep', async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 1))
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'tsc')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The paths are looked up after the first drawing, which the lookup then draws again: `find` waits for it.
  expect(await ui.find({ key: 'link:1:0:0' })).toBeDefined()
  expect(await ui.find({ key: 'link:1:1:1' })).toBeDefined()
  // Neither the missing file nor the word with a slash is a link.
  expect(await ui.find({ key: 'link:1:2:0' })).toBeUndefined()
  expect(await ui.find({ key: 'link:1:2:1' })).toBeUndefined()
  await ui.press({ key: 'link:1:0:0' })
  await ui.press({ key: 'link:1:1:1' })
  await new Promise<void>(resolve => setTimeout(resolve, 20))
  // Resolved from the run's folder, and from the home folder for `~/`; the line number is not part of the path.
  expect(process.calls).toContainEqual(['open', '/w/sample-app/src/app.ts'])
  expect(process.calls).toContainEqual(['open', '/Users/me/notes/a.md'])
  await ui.unmount()
})

test('a command that needs a terminal where there is none runs without one and says so', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['prompt\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'vi notes.txt')

  const got = String((await $.tool.call({ tool: 'mcp__run-pane__run_output' })).result)
  expect(got).toContain('no terminal to give it here')
})

test('buttons have a light background so they read as controls: a pill, its label in dark ink with a space each side', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['ready\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const stop = await faceOf(ui, 'Stop (Ctrl+C)')
  expect(stop?.label).toMatchObject({ color: BUTTON_INK, backgroundColor: BUTTON_COLORS.danger })
  // The half blocks at the ends are in the button's own colour, so it reads as rounded.
  expect(stop?.edge).toBe(BUTTON_COLORS.danger)
  expect(stop?.end).toBe(BUTTON_COLORS.danger)
  expect((await faceOf(ui, 'Clear'))?.label).toMatchObject({ color: BUTTON_INK, backgroundColor: BUTTON_COLORS.neutral })
  expect((await faceOf(ui, 'Open in shell'))?.label).toMatchObject({ backgroundColor: BUTTON_COLORS.primary })
  expect((await faceOf(ui, 'Close pane'))?.label).toMatchObject({ backgroundColor: BUTTON_COLORS.neutral })
  // The Shell button is the Open in shell one.
  expect(await faceOf(ui, 'Shell')).toBeUndefined()
  await ui.unmount()
})

test('the suggestions are pills in one wrapping row after a dim Try, with npm run said once and a colour for what they do', async ($, on) => {
  const process = { calls: [] as string[][], lines: [] }
  engine(on, process, { 'package.json': '{"scripts":{"dev":"vite","test":"vitest","build":"tsc","start:ci":"x"}}' })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const boxes = await ui.findAll({ type: 'Box' })
  const row = boxes.find(box => box.props?.flexWrap === 'wrap' && /^Try\s*npm run/.test(box.text ?? '') && (box.text ?? '').includes('\u2590 dev \u258c'))
  expect(row).toBeDefined()
  // Over each pill a cap, half a row in its colour (a space each side, two blocks more than the label is wide).
  const cap = await ui.find({ type: 'Text', text: ` ${'\u2584'.repeat(5)} ` })
  expect(cap?.props?.color).toBe(BUTTON_COLORS.primary)
  expect(row?.props?.alignItems).toBe('flex-end')
  // The words every one starts with are in the row once, not in each button.
  expect(((row?.text ?? '').match(/npm run/g) ?? []).length).toBe(1)
  expect((await faceOf(ui, 'dev'))?.label).toMatchObject({ backgroundColor: BUTTON_COLORS.primary })
  expect((await faceOf(ui, 'start:ci'))?.label).toMatchObject({ backgroundColor: BUTTON_COLORS.primary })
  expect((await faceOf(ui, 'test'))?.label).toMatchObject({ backgroundColor: BUTTON_COLORS.success })
  expect((await faceOf(ui, 'build'))?.label).toMatchObject({ backgroundColor: BUTTON_COLORS.neutral })
  // Pressing one still runs the whole command.
  expect(await ui.find({ key: 'hint:npm run dev' })).toBeDefined()
  await ui.press({ key: 'hint:npm run test' })
  await new Promise<void>(resolve => setTimeout(resolve, 30))
  const got = String((await $.tool.call({ tool: 'mcp__run-pane__run_output' })).result)
  expect(got).toContain('npm run test')
  await ui.unmount()
})

test('Open in shell on a process of the plugin opens a window with all its output so far, copied to a private file', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['one\n', '\u001b[32mtwo\u001b[0m\n', 'partial'], toasts: [] as string[], writes: [] as { argv: string[]; stdin?: string | undefined }[] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  await untilPrinted($, 'partial')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'shell' })
  await new Promise<void>(resolve => setTimeout(resolve, 60))
  // The whole log goes to a file nobody else can read (umask 077), whole lines with a reset after each, the
  // unfinished one as it is.
  const made = process.writes.find(write => write.argv[2]?.includes('cat >'))
  expect(made?.argv[2]).toContain('umask 077')
  expect(made?.stdin).toBe('one\u001b[0m\n\u001b[32mtwo\u001b[0m\u001b[0m\npartial')
  const path = made?.argv[4] ?? ''
  expect(path).toMatch(/^\/tmp\/run-pane-[a-z0-9]+-1\.log$/)
  // The window tails it from its first line: all so far, then live. The path is quoted, never part of a script.
  const window = process.calls.find(argv => argv[0] === 'osascript')
  expect(window?.slice(3)).toEqual(['--', `tail -n +1 -f -- '${path}'`, '#1 npm run dev'])
  expect(process.toasts.some(text => text.includes("Opened #1's output in Terminal") && text.includes('does not reach the process'))).toBe(true)
  await ui.unmount()
})

test('after Open in shell what the run prints goes to the same file, and its end is said there', async ($, on) => {
  let open!: () => void
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  const process = {
    calls: [] as string[][],
    lines: ['first\n'],
    later: { gate, lines: ['second\n'] },
    toasts: [] as string[],
    writes: [] as { argv: string[]; stdin?: string | undefined }[],
  }
  engine(on, process)
  on('clock.sleep', async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 1))
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm run dev')
  await untilPrinted($, 'first')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'shell' })
  await new Promise<void>(resolve => setTimeout(resolve, 60))
  open()
  await untilPrinted($, 'second')
  await new Promise<void>(resolve => setTimeout(resolve, 60))
  const appended = process.writes.filter(write => write.argv[2]?.includes('cat >>'))
  expect(appended.map(write => write.stdin).join('')).toContain('second\n')
  // Everything goes to the file the window follows.
  expect(new Set(appended.map(write => write.argv[4])).size).toBe(1)
  await ui.unmount()
})

test('pressing Open in shell again opens another window on the same file', async ($, on) => {
  const process = { calls: [] as string[][], lines: ['one\n'], toasts: [] as string[], writes: [] as { argv: string[]; stdin?: string | undefined }[] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')
  await untilPrinted($, 'one')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'shell' })
  await new Promise<void>(resolve => setTimeout(resolve, 60))
  await ui.press({ key: 'shell' })
  await new Promise<void>(resolve => setTimeout(resolve, 60))
  const windows = process.calls.filter(argv => argv[0] === 'osascript')
  expect(windows).toHaveLength(2)
  expect(windows[0]?.[4]).toBe(windows[1]?.[4])
  expect(process.writes.filter(write => write.argv[2]?.includes('cat >') && !write.argv[2]?.includes('cat >>'))).toHaveLength(1)
  await ui.unmount()
})

test('a file system that does not answer does not hold up the drawing of the output', async ($, on) => {
  const process = {
    calls: [] as string[][],
    isFsHung: true,
    lines: ['pulling docker.io/library/nginx:latest\n', 'src/app.ts:1 done\n', 'all of it printed\n'],
  }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'docker compose up')
  await untilPrinted($, 'all of it printed')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Every line is on the screen, and the unanswered paths are plain text, not links.
  expect(await ui.find({ type: 'Text', text: /all of it printed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /pulling docker.io\/library\/nginx:latest/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/app.ts:1 done/ })).toBeDefined()
  await ui.unmount()
})

test('a pane that has a lot of output draws it, whatever the lines say', async ($, on) => {
  const lines = Array.from({ length: 300 }, (_, at) => `layer ${at} sha256:abc${at} docker.io/library/img${at}/x ./f${at}/g https://x.dev/${at}\n`)
  const process = { calls: [] as string[][], lines: [...lines, 'the very last line\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'sandbox start ci')
  await untilPrinted($, 'the very last line')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /the very last line/ })).toBeDefined()
  await ui.unmount()
})

test('"forceColor" in run-pane.json asks the commands to colour their output', async ($, on) => {
  const process = { calls: [] as string[][], spawns: [] as { argv: readonly string[]; env?: Record<string, string> | undefined }[], lines: ['ready\n'] }
  engine(on, process, { 'run-pane.json': '{"forceColor":true}', 'package.json': '{}' })
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'npm test')

  expect(process.spawns[0]?.env).toEqual({ FORCE_COLOR: '1', CLICOLOR_FORCE: '1' })
})

test('the output a script reads for a phrase reaches the pane as the command wrote it', async ($, on) => {
  // The sandbox's awk gate looks for `compiled successfully` in the output it is piped: the pane must not change it.
  const process = { calls: [] as string[][], spawns: [] as { argv: readonly string[]; env?: Record<string, string> | undefined }[], lines: ['webpack compiled successfully in 12 ms\n'] }
  engine(on, process)
  await $.session.start({ cwd: '/w/sample-app', surface: 'terminal', isInteractive: true })
  await gt($, 'sandbox start ci')
  await untilPrinted($, 'compiled successfully')

  expect(process.spawns[0]?.argv.slice(-1)).toEqual(['sandbox start ci'])
  expect(process.spawns[0]?.env).toBeUndefined()
})
