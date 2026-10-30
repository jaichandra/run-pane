import { expect, test } from 'claude-code/testing'

import { detectMux, driver, echoes, readPane } from '../hooks/mux'

test('herdr is told by HERDR_ENV=1 with a pane, tmux by TMUX with a pane, and herdr wins inside tmux', () => {
  expect(detectMux({ herdrEnv: '1', herdrPane: 'w4:p1' })).toBe('herdr')
  expect(detectMux({ tmux: '/tmp/tmux-1000/default,1,0', tmuxPane: '%3' })).toBe('tmux')
  expect(detectMux({ herdrEnv: '1', herdrPane: 'w4:p1', tmux: '/tmp/t,1,0', tmuxPane: '%3' })).toBe('herdr')
  expect(detectMux({})).toBeUndefined()
  expect(detectMux({ herdrEnv: '0', herdrPane: 'w4:p1' })).toBeUndefined()
  expect(detectMux({ herdrEnv: '1' })).toBeUndefined()
  expect(detectMux({ tmux: '/tmp/t,1,0' })).toBeUndefined()
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

test('the command is the line typed at a prompt, and a command typed again is one echo more', () => {
  const shown = 'me@h:~$ echo hi\nhi\nme@h:~$ '
  expect(echoes(shown, 'echo hi')).toBe(1)
  expect(echoes(`${shown}echo hi\nhi\nme@h:~$ `, 'echo hi')).toBe(2)
  expect(echoes(`${shown}echo hi\nhi\nme@h:~$ echo hi\nhi\n$ `, 'echo hi')).toBe(3)
  expect(echoes('', 'echo hi')).toBe(0)
  // Output that ends in the same letters as the command is not the command.
  expect(echoes('me@h:~$ ls\ntools\nlib\nme@h:~$ ', 'ls')).toBe(1)
  expect(echoes('me@h:~$ ls  \n', ' ls ')).toBe(1)
})

test('a pane read is what follows the last typed command; once over, without the prompt after it', () => {
  const shown = 'me@h:~$ echo old\nold\nme@h:~$ echo hi\nhi\nthere\nme@h:~$ '
  expect(readPane(shown, 'echo hi', true)).toBe('hi\nthere')
  // Still running: the last line is output, not a prompt.
  expect(readPane('me@h:~$ npm run dev\nready on :3000\nwatching\n', 'npm run dev', false)).toBe('ready on :3000\nwatching')
})

test('a command with no output reads as nothing, and what is not there yet reads as nothing', () => {
  expect(readPane('me@h:~$ true\nme@h:~$ ', 'true', true)).toBe('')
  expect(readPane('', 'true', false)).toBe('')
  // The command was typed and is running with nothing printed.
  expect(readPane('me@h:~$ sleep 5\n', 'sleep 5', false)).toBe('')
})

test('colours are not part of the text, and the empty lines a tmux capture pads with are dropped', () => {
  expect(readPane('$ ls\n\u001b[34mdir\u001b[0m\n$ \n\n\n\n', 'ls', true)).toBe('dir')
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
