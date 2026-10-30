import { expect, test } from 'claude-code/testing'

import { detectMux, driver, EXIT_MARKER, readPane, shQuote, typedLine } from '../hooks/mux'

test('herdr is told by HERDR_ENV=1 with a pane, tmux by TMUX with a pane, and herdr wins inside tmux', () => {
  expect(detectMux({ herdrEnv: '1', herdrPane: 'w4:p1' })).toBe('herdr')
  expect(detectMux({ tmux: '/tmp/tmux-1000/default,1,0', tmuxPane: '%3' })).toBe('tmux')
  expect(detectMux({ herdrEnv: '1', herdrPane: 'w4:p1', tmux: '/tmp/t,1,0', tmuxPane: '%3' })).toBe('herdr')
  expect(detectMux({})).toBeUndefined()
  expect(detectMux({ herdrEnv: '0', herdrPane: 'w4:p1' })).toBeUndefined()
  expect(detectMux({ herdrEnv: '1' })).toBeUndefined()
  expect(detectMux({ tmux: '/tmp/t,1,0' })).toBeUndefined()
})

test('a shell word is single-quoted and a quote in it is closed, escaped and reopened', () => {
  expect(shQuote('npm run dev')).toBe("'npm run dev'")
  expect(shQuote("echo it's $(rm -rf ~) `x` \"y\"")).toBe(`'echo it'\\''s $(rm -rf ~) \`x\` "y"'`)
  expect(shQuote('')).toBe("''")
})

test('the typed line is sh -c with the fixed wrapper and the command, both as one word each', () => {
  const line = typedLine("make 'all'", 'k3v1')
  expect(line.startsWith("sh -c 'trap : INT; sh -lc -- \"$1\"; c=$?; printf ")).toBe(true)
  expect(line.endsWith(` sh 'make '\\''all'\\''' 'k3v1'`)).toBe(true)
  expect(line).toContain(EXIT_MARKER)
  expect(line).not.toContain('\n')
})

test('herdr: split, type, read, interrupt and close are argument vectors', () => {
  const d = driver('herdr')
  expect(d.split({ direction: 'right', cwd: '/w/app', focus: false })).toEqual([
    'herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/w/app', '--no-focus',
  ])
  expect(d.split({ target: 'w4:p5', direction: 'down', cwd: '/w/app', focus: true })).toEqual([
    'herdr', 'pane', 'split', 'w4:p5', '--direction', 'down', '--cwd', '/w/app', '--focus',
  ])
  expect(d.paneId('{"id":"cli:pane:split","result":{"pane":{"pane_id":"w4:p5"}}}')).toBe('w4:p5')
  expect(d.paneId('not json')).toBeUndefined()
  expect(d.paneId('{"error":{"code":"x"}}')).toBeUndefined()
  expect(d.type('w4:p5', 'ls')).toEqual([['herdr', 'pane', 'run', 'w4:p5', 'ls']])
  expect(d.read('w4:p5', 2000)).toEqual(['herdr', 'pane', 'read', 'w4:p5', '--source', 'recent-unwrapped', '--lines', '2000', '--format', 'text'])
  expect(d.interrupt('w4:p5')).toEqual(['herdr', 'pane', 'send-keys', 'w4:p5', 'C-c'])
  expect(d.close('w4:p5')).toEqual(['herdr', 'pane', 'close', 'w4:p5'])
})

test('tmux: split keeps the focus unless asked, and a typed line cannot be read as an option', () => {
  const d = driver('tmux')
  expect(d.split({ direction: 'right', cwd: '/w/app', focus: false })).toEqual([
    'tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-c', '/w/app',
  ])
  expect(d.split({ target: '%4', direction: 'down', cwd: '/w/app', focus: true })).toEqual([
    'tmux', 'split-window', '-v', '-P', '-F', '#{pane_id}', '-c', '/w/app', '-t', '%4',
  ])
  expect(d.paneId('%4\n')).toBe('%4')
  expect(d.paneId('')).toBeUndefined()
  expect(d.type('%4', '-n x')).toEqual([
    ['tmux', 'send-keys', '-t', '%4', '-l', '--', '-n x'],
    ['tmux', 'send-keys', '-t', '%4', 'Enter'],
  ])
  expect(d.read('%4', 2000)).toEqual(['tmux', 'capture-pane', '-p', '-J', '-t', '%4', '-S', '-2000'])
  expect(d.interrupt('%4')).toEqual(['tmux', 'send-keys', '-t', '%4', 'C-c'])
  expect(d.close('%4')).toEqual(['tmux', 'kill-pane', '-t', '%4'])
})

test('a pane read is the command output: after the typed line, before the marker, with its exit code', () => {
  const typed = typedLine('echo hi', 'k1')
  const shown = `$ old command\nold output\n$ ${typed}\nhi\n\n${EXIT_MARKER} k1 3\n$ \n\n\n`
  expect(readPane(shown, 'k1')).toEqual({ text: 'hi', code: 3 })
})

test('while the command runs there is no code, and the empty lines a tmux capture pads with are dropped', () => {
  const shown = `$ ${typedLine('npm run dev', 'k1')}\nready on :3000\n\n\n\n`
  expect(readPane(shown, 'k1')).toEqual({ text: 'ready on :3000' })
  expect(readPane('', 'k1')).toEqual({ text: '' })
})

test('output that ends without a newline keeps its last line, and a marker alone is not taken for the typed line', () => {
  expect(readPane(`$ ${typedLine('printf x', 'k1')}\nx\n${EXIT_MARKER} k1 0\n$ `, 'k1')).toEqual({ text: 'x', code: 0 })
  // The typed line scrolled out of what was read: everything before the marker is output.
  expect(readPane(`tail of output\n\n${EXIT_MARKER} k1 130\n$ `, 'k1')).toEqual({ text: 'tail of output', code: 130 })
  // A command that prints the marker's name is not its end.
  expect(readPane(`$ ${typedLine('echo x', 'k1')}\nthe ${EXIT_MARKER} word\n`, 'k1')).toEqual({ text: `the ${EXIT_MARKER} word` })
})

test('in a pane that ran other commands only the run with this token is read, and nothing before it is typed', () => {
  const first = `$ ${typedLine('make', 'k1')}\nbuilt\n\n${EXIT_MARKER} k1 0\n`
  // The second command is typed but has not echoed yet: the first one's end is not its end.
  expect(readPane(`${first}$ `, 'k2')).toEqual({ text: '' })
  expect(readPane(`${first}$ ${typedLine('make test', 'k2')}\nrunning\n`, 'k2')).toEqual({ text: 'running' })
  expect(readPane(`${first}$ ${typedLine('make test', 'k2')}\nok\n\n${EXIT_MARKER} k2 1\n$ `, 'k2')).toEqual({ text: 'ok', code: 1 })
  // The first run's own text is still read as its own.
  expect(readPane(`${first}$ ${typedLine('make test', 'k2')}\nok\n`, 'k1')).toEqual({ text: 'built', code: 0 })
})

test('a shell is idle when it leads its terminal: herdr by its process info, tmux by ps', () => {
  const herdr = driver('herdr')
  const info = (group: number) => JSON.stringify({ result: { process_info: { foreground_process_group_id: group, shell_pid: 41 } } })
  expect(herdr.idle('w4:p5')).toEqual(['herdr', 'pane', 'process-info', '--pane', 'w4:p5'])
  expect(herdr.isIdle(info(41))).toBe(true)
  expect(herdr.isIdle(info(99))).toBe(false)
  expect(herdr.isIdle('not json')).toBe(false)
  expect(herdr.isIdle('{}')).toBe(false)

  const tmux = driver('tmux')
  expect(tmux.idle('%4').slice(0, 2)).toEqual(['sh', '-c'])
  expect(tmux.idle('%4').at(-1)).toBe('%4')
  expect(tmux.idle('%4')[2]).not.toContain('%4')
  expect(tmux.isIdle(' 4113606 4113606\n')).toBe(true)
  expect(tmux.isIdle(' 4113606 4113674\n')).toBe(false)
  expect(tmux.isIdle('')).toBe(false)
})
