import { expect, test } from 'claude-code/testing'

import { appleScript, hasControls, ITERM_PATH, lineArgv, oneLine, osascriptArgv, osascriptFailure, pickApp, shellTitle } from '../hooks/shell'

test('each terminal has one fixed script that reads the folder and the title from argv', async () => {
  for (const app of ['iTerm', 'Terminal'] as const) {
    const script = appleScript(app)
    expect(script.startsWith('on run argv\n')).toBe(true)
    expect(script).toContain('set targetDir to item 1 of argv')
    expect(script).toContain('set tabTitle to item 2 of argv')
    // The one place the folder meets the shell: made a single shell word by AppleScript itself.
    expect(script).toContain('set cdLine to "cd -- " & quoted form of targetDir')
    // The only text the script types is that line.
    expect(script.match(/write text|do script/g)).toHaveLength(1)
    expect(script).not.toContain('do shell script')
  }
  expect(appleScript('iTerm')).toContain('tell application "iTerm"')
  expect(appleScript('iTerm')).toContain('create window with default profile')
  expect(appleScript('Terminal')).toContain('tell application "Terminal"')
  expect(appleScript('Terminal')).not.toContain('iTerm')
})

test('the osascript command ends its options before the folder', async () => {
  expect(osascriptArgv('Terminal', '-rf')).toEqual(['osascript', '-e', appleScript('Terminal'), '--', '-rf', '-rf'])
  expect(osascriptArgv('iTerm', '/w/app/')).toEqual(['osascript', '-e', appleScript('iTerm'), '--', '/w/app/', 'app'])
  expect(ITERM_PATH).toBe('/Applications/iTerm.app')
})

test('the title is the last part of the folder', async () => {
  expect(shellTitle('/w/sample-app')).toBe('sample-app')
  expect(shellTitle('/w/sample-app/')).toBe('sample-app')
  expect(shellTitle('/')).toBe('shell')
  expect(shellTitle('')).toBe('shell')
})

test('control characters are told from other text', async () => {
  for (const text of ['a\nb', 'a\rb', 'a\tb', 'a\u001bb', 'a\u0015b', 'a\u0000b', 'a\u007fb', 'a\u009bb']) expect(hasControls(text), JSON.stringify(text)).toBe(true)
  for (const text of ['', '/w/sample app', "/w/it's", '/w/$(x)', '/w/é中\u{1f600}', '/w/\\']) expect(hasControls(text), text).toBe(false)
})

test('a message is made one line and cut when long', async () => {
  expect(oneLine('  first\n second\t\tthird  ')).toBe('first second third')
  expect(oneLine('')).toBe('')
  expect(oneLine('x'.repeat(500))).toHaveLength(200)
  expect(oneLine('x'.repeat(500)).endsWith('…')).toBe(true)
  expect(oneLine('x'.repeat(200))).toBe('x'.repeat(200))
})

test('a line typed into a window is the script\'s argument, never part of its text', async () => {
  const [bin, flag, script, dash, line, title] = lineArgv('Terminal', 'exec tmux x', 'run #1')
  expect([bin, flag, dash, line, title]).toEqual(['osascript', '-e', '--', 'exec tmux x', 'run #1'])
  expect(script).toContain('set typedLine to item 1 of argv')
  expect(script).not.toContain('exec tmux x')
  expect(script).not.toContain('do shell script')
  expect(script.match(/write text|do script/g)).toHaveLength(1)
  expect(lineArgv('iTerm', 'x', 't')[2]).toContain('create window with default profile')
})

test('a window opens in the terminal Claude Code runs in, else iTerm where it is installed', async () => {
  expect(pickApp('iTerm.app', false)).toBe('iTerm')
  expect(pickApp('Apple_Terminal', true)).toBe('Terminal')
  expect(pickApp('WezTerm', true)).toBe('iTerm')
  expect(pickApp('WezTerm', false)).toBe('Terminal')
  expect(pickApp(undefined, false)).toBe('Terminal')
})

test('an osascript failure is one line, and a refusal by macOS says how to allow it', async () => {
  expect(osascriptFailure('Terminal', '', 'boom\n  again', 1)).toBe('Could not open a window in Terminal: boom again')
  expect(osascriptFailure('Terminal', '', '', 3)).toBe('Could not open a window in Terminal: osascript exited with 3')
  const refused = osascriptFailure('iTerm', '', '193:227: execution error: Not authorized to send Apple events to iTerm. (-1743)', 1)
  expect(refused).toContain('Automation')
  expect(refused).toContain('switch iTerm on')
  expect(refused).not.toContain('\n')
})
