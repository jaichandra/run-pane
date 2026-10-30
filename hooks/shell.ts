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

export const appleScript = (app: TerminalApp): string => (app === 'iTerm' ? ITERM_SCRIPT : TERMINAL_SCRIPT)

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

/** What an error or a stream said, as one short line. */
export const oneLine = (text: string, max = 200): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export const NOT_MACOS = '/shell opens a pane in herdr or tmux, or a Terminal or iTerm window on macOS: open a terminal in this folder yourself.'
