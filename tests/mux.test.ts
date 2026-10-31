import { expect, test } from 'claude-code/testing'

import { detectMux, driver, echoes, HIDDEN_ATTACH, isTmuxPane, itermSessionId, readPane } from '../hooks/mux'

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
  // What its background jobs are children of.
  expect(herdr.shellPid(info(41))).toBe(41)
  expect(herdr.shellPid('{}')).toBeUndefined()
  expect(herdr.shellPid('not json')).toBeUndefined()
  expect(tmux.shellPid(' 4113606 4113674\n')).toBe(4113606)
  expect(tmux.shellPid('')).toBeUndefined()
})

test('the hidden tmux server is the same driver on a socket of its own, with the folder and the pane as arguments', () => {
  const hidden = driver('hidden')
  expect(hidden.type('%2', '-x')).toEqual([
    ['tmux', '-L', 'run-pane', 'send-keys', '-t', '%2', '-l', '--', '-x'],
    ['tmux', '-L', 'run-pane', 'send-keys', '-t', '%2', 'Enter'],
  ])
  expect(hidden.read('%2', 50)).toEqual(['tmux', '-L', 'run-pane', 'capture-pane', '-p', '-J', '-t', '%2', '-S', '-50'])
  expect(hidden.interrupt('%2')).toEqual(['tmux', '-L', 'run-pane', 'send-keys', '-t', '%2', 'C-c'])
  expect(hidden.close('%2')).toEqual(['tmux', '-L', 'run-pane', 'kill-pane', '-t', '%2'])
  expect(hidden.idle('%2').slice(-3)).toEqual(['%2', '-L', 'run-pane'])
  // A folder with quotes in it is only ever an argument.
  const split = hidden.split({ direction: 'right', cwd: "/w/it's $(x)", focus: false })
  expect(split.slice(0, 2)).toEqual(['sh', '-c'])
  expect(split[2]).not.toContain('$(x)')
  expect(split.slice(3)).toEqual(['sh', "/w/it's $(x)"])
  // The visible tmux is unchanged: no socket.
  expect(driver('tmux').idle('%2')).toEqual(['sh', '-c', expect.any(String), 'sh', '%2'])
  expect(HIDDEN_ATTACH).toBe('exec env -u TMUX tmux -L run-pane attach -t run-pane')
  expect(isTmuxPane('%12')).toBe(true)
  for (const text of ['', '%', '%1;x', '1', '%1\n', '$(x)']) expect(isTmuxPane(text), text).toBe(false)
})

test('a prompt of two lines goes whole once the command is over, the output above it stays', () => {
  const info = (time: string) => `# jail @ host in ~/app on git:master x [${time}] `
  const shown = ['', info('7:39:41'), '$ cat a.json', '{', '  "a": 1', '}', '', info('7:42:36'), '$ '].join('\n')
  expect(readPane(shown, 'cat a.json', true)).toBe('{\n  "a": 1\n}')
  // Still running: nothing is taken off.
  expect(readPane(shown.replace(/\n\n#[^\n]*\n\$ $/, '\n'), 'cat a.json', false)).toBe('{\n  "a": 1\n}')
  // A prompt of one line has no head to take off, so an output that ends in a `# note` keeps it; one that
  // has a head the same way above the command line does lose it (the shape is all there is to go by).
  expect(readPane('$ ls\na\n\n# note\n$ ', 'ls', true)).toBe('a\n\n# note')
  expect(readPane('# first\n$ ls\na\n\n# note\n$ ', 'ls', true)).toBe('a')
})

test('iTerm2 is told by its program and a session id with a uuid, after herdr and tmux', () => {
  const uuid = '36B98952-11FE-4BEB-AABF-EA2E02581F1A'
  const iterm = { termProgram: 'iTerm.app', itermSession: `w0t3p0:${uuid}` }
  expect(detectMux(iterm)).toBe('iterm')
  expect(detectMux({ ...iterm, tmux: '/tmp/x,1,0', tmuxPane: '%0' })).toBe('tmux')
  expect(detectMux({ ...iterm, herdrEnv: '1', herdrPane: 'w1:p0' })).toBe('herdr')
  expect(detectMux({ ...iterm, termProgram: 'Apple_Terminal' })).toBeUndefined()
  expect(detectMux({ termProgram: 'iTerm.app', itermSession: 'w0t0p0:not-a-uuid' })).toBeUndefined()
  expect(detectMux({ termProgram: 'iTerm.app' })).toBeUndefined()
  expect(itermSessionId(`w0t3p0:${uuid}`)).toBe(uuid)
  expect(itermSessionId(undefined)).toBeUndefined()
})

test('iTerm2: every pane command is an osascript with the pane and the line as arguments of a fixed script', () => {
  const iterm = driver('iterm')
  const id = '0EBEFCEA-B4FA-4E75-8AD7-A4143A445073'
  const type = iterm.type(id, "it's $(x)")[0] as string[]
  expect(type.slice(0, 2)).toEqual(['osascript', '-e'])
  expect(type.slice(3)).toEqual(['--', id, "it's $(x)"])
  expect(type[2]).not.toContain('$(x)')
  const split = iterm.split({ direction: 'down', cwd: '/w/a b', focus: true, target: id, home: 'HOME' })
  expect(split.slice(3)).toEqual(['--', id, 'down', '/w/a b', 'focus'])
  // With no pane to split from, the one Claude Code runs in.
  expect(iterm.split({ direction: 'right', cwd: '/w', focus: false, home: 'HOME' }).slice(3)).toEqual(['--', 'HOME', 'right', '/w', 'keep'])
  expect(iterm.paneId(`${id}\n`)).toBe(id)
  expect(iterm.paneId('execution error: not allowed')).toBeUndefined()
  // The read keeps osascript's failure as its own, and the pane is an argument.
  const read = iterm.read(id, 50)
  expect(read.slice(0, 2)).toEqual(['sh', '-c'])
  expect(read.slice(-3)).toEqual([expect.stringContaining('contents'), id, '50'])
  expect(iterm.idle(id).slice(-2)).toEqual([expect.stringContaining('tty'), id])
  expect(iterm.interrupt(id)[2]).toContain('ASCII character 3')
  expect(iterm.close(id)[2]).toContain('close')
})

test('iTerm2: the shell leads its terminal when it is the foreground group; login above it is not the shell', () => {
  const iterm = driver('iterm')
  // pid ppid tpgid: login (parent is iTerm's), the shell, a command the shell started.
  const idle = '14109 93093 14121\n14121 14109 14121\n'
  const busy = '14109 93093 16225\n14121 14109 16225\n16225 14121 16225\n'
  expect(iterm.isIdle(idle)).toBe(true)
  expect(iterm.shellPid(idle)).toBe(14121)
  expect(iterm.isIdle(busy)).toBe(false)
  expect(iterm.shellPid(busy)).toBe(14121)
  // A profile that runs the shell itself: no login above it.
  expect(iterm.isIdle('200 1 200\n')).toBe(true)
  expect(iterm.isIdle('200 1 300\n')).toBe(false)
  for (const text of ['', 'garbage', '1 1\n']) {
    expect(iterm.isIdle(text), text).toBe(false)
    expect(iterm.shellPid(text), text).toBeUndefined()
  }
})

test('rows that end in spaces (iTerm2 pads every row) read as the lines they are', () => {
  const shown = ['# jail @ host [7:59:00] ', '$ ls \u00a0', 'a ', 'b  ', ' ', '# jail @ host [8:00:00] ', '$  ', ' ', ' '].join('\n')
  expect(echoes(shown, 'ls')).toBe(1)
  expect(readPane(shown, 'ls', true)).toBe('a\nb')
  expect(readPane(shown, 'ls', false)).toBe('a\nb\n\n# jail @ host [8:00:00]\n$')
})
