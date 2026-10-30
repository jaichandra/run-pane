import { expect, test } from 'claude-code/testing'

import { detectMux, driver, readPane, shQuote, typedLine } from '../hooks/mux'

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

test('the typed line is the script and the command, one single-quoted word each, on one line', () => {
  expect(typedLine('/p/hooks/rp-run.sh', "make 'all'")).toBe(`sh '/p/hooks/rp-run.sh' 'make '\\''all'\\'''`)
  expect(typedLine('/my dir/rp-run.sh', 'ls')).toBe("sh '/my dir/rp-run.sh' 'ls'")
  expect(typedLine('/p/rp-run.sh', 'a\nb')).toContain('a\nb')
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

const DASH = '\u2500\u2500'

test('a pane read is the command output: no command line above it, no footer and no prompt below it, and the exit code', () => {
  const shown = `$ echo hi\nhi\n\n${DASH} exit 3\n$ \n\n\n`
  expect(readPane(shown, 'echo hi')).toEqual({ text: 'hi', code: 3 })
})

test('while the command runs there is no code, and the empty lines a tmux capture pads with are dropped', () => {
  expect(readPane('$ npm run dev\nready on :3000\n\n\n\n', 'npm run dev')).toEqual({ text: 'ready on :3000' })
  expect(readPane('', 'x')).toEqual({ text: '' })
})

test('output that ends without a newline keeps its last line, and colours are not part of the footer', () => {
  expect(readPane(`$ printf x\nx\n\u001b[2m${DASH} exit 0\u001b[0m\n$ `, 'printf x')).toEqual({ text: 'x', code: 0 })
})

test('the command line is dropped only where it is the first line, and a footer-like word inside a line is not the end', () => {
  expect(readPane('$ echo $ echo\nthe $ echo word\n', 'echo')).toEqual({ text: '$ echo $ echo\nthe $ echo word' })
  expect(readPane(`$ echo x\nsee ${DASH} exit 4 here\n`, 'echo x')).toEqual({ text: `see ${DASH} exit 4 here` })
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
