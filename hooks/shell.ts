// The /shell command's logic with no engine in it: which terminal to open, the AppleScript that
// opens it and the words the person gets back.

export type TerminalApp = 'iTerm' | 'Terminal'

/** Where iTerm lives when it is installed. Without it the window opens in Terminal.app. */
export const ITERM_PATH = '/Applications/iTerm.app'

// Both scripts are fixed text: the folder and the window's title are never written into them.
// osascript hands them over as `argv`, and the folder reaches the shell only through AppleScript's
// `quoted form of`, which makes one shell word of it whatever characters it holds. `cd --` ends the
// options, so a folder that starts with a dash is still a folder.
const ITERM_SCRIPT = `on run argv
  set targetDir to item 1 of argv
  set tabTitle to item 2 of argv
  set cdLine to "cd -- " & quoted form of targetDir
  tell application "iTerm"
    activate
    set newWindow to (create window with default profile)
    tell current session of newWindow
      write text cdLine
      try
        set name to tabTitle
      end try
    end tell
  end tell
end run
`

const TERMINAL_SCRIPT = `on run argv
  set targetDir to item 1 of argv
  set tabTitle to item 2 of argv
  set cdLine to "cd -- " & quoted form of targetDir
  tell application "Terminal"
    activate
    set newTab to do script cdLine
    try
      set custom title of newTab to tabTitle
      set title displays custom title of newTab to true
    end try
  end tell
end run
`

// The same windows with a fixed line typed in, not a `cd`: the line is the script's first argument.
const ITERM_LINE_SCRIPT = `on run argv
  set typedLine to item 1 of argv
  set tabTitle to item 2 of argv
  tell application "iTerm"
    activate
    set newWindow to (create window with default profile)
    tell current session of newWindow
      write text typedLine
      try
        set name to tabTitle
      end try
    end tell
  end tell
end run
`

const TERMINAL_LINE_SCRIPT = `on run argv
  set typedLine to item 1 of argv
  set tabTitle to item 2 of argv
  tell application "Terminal"
    activate
    set newTab to do script typedLine
    try
      set custom title of newTab to tabTitle
      set title displays custom title of newTab to true
    end try
  end tell
end run
`

export const appleScript = (app: TerminalApp): string => (app === 'iTerm' ? ITERM_SCRIPT : TERMINAL_SCRIPT)

/** The terminal to open a window in: the one Claude Code runs in (an app may always control itself; macOS asks before
 * one controls another, and answers -1743 until it is allowed), else iTerm where it is installed, else Terminal. */
export function pickApp(termProgram: string | undefined, isItermInstalled: boolean): TerminalApp {
  if (termProgram === 'iTerm.app') return 'iTerm'
  if (termProgram === 'Apple_Terminal') return 'Terminal'
  return isItermInstalled ? 'iTerm' : 'Terminal'
}

/** Why osascript failed, in one line; when macOS has not allowed this terminal to control the app, how to allow it. */
export function osascriptFailure(app: TerminalApp, stdout: string, stderr: string, code: number): string {
  const said = oneLine(stderr || stdout) || `osascript exited with ${code}`
  if (!/-1743|not authori[sz]ed to send apple events/i.test(said)) return `Could not open a window in ${app}: ${said}`
  return `Could not open a window in ${app}: macOS has not allowed this terminal to control ${app}. Allow it in System Settings > Privacy & Security > Automation (switch ${app} on under the terminal Claude Code runs in), or run Claude Code in ${app}. (${said})`
}

/** The window's title: the folder's name. */
export function shellTitle(folder: string): string {
  return folder.split('/').filter(Boolean).pop() ?? 'shell'
}

/** Whether the text holds a control character. Typed into a terminal, one acts as a key (Ctrl+U, Ctrl+C,
 * Enter, Esc) and can end the `cd` line early, so a folder that holds one is not opened. */
export const hasControls = (text: string): boolean => /[\u0000-\u001f\u007f-\u009f]/.test(text)

/** The osascript command: the script as `-e`, then `--` (so a folder that starts with a dash is not an
 * option), then the folder and the title as the script's `argv`. */
export const osascriptArgv = (app: TerminalApp, folder: string): string[] => [
  'osascript',
  '-e',
  appleScript(app),
  '--',
  folder,
  shellTitle(folder),
]

/** The osascript command that opens a window and types `line` into it. The line is the mod's own fixed text,
 * never something a command or a folder made. */
export const lineArgv = (app: TerminalApp, line: string, title: string): string[] => [
  'osascript',
  '-e',
  app === 'iTerm' ? ITERM_LINE_SCRIPT : TERMINAL_LINE_SCRIPT,
  '--',
  line,
  title,
]

/** What an error or a stream said, as one short line. */
export const oneLine = (text: string, max = 200): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export const NOT_MACOS = '/shell opens a pane in herdr or tmux, or a Terminal or iTerm window on macOS: open a terminal in this folder yourself.'
