// The multiplexer side of /rp and /shell with no engine in it: which multiplexer the session runs
// in, the commands that split a pane, type into it, read it back and close it, and how a command
// typed into a pane reports that it ended.

export type Mux = 'herdr' | 'tmux'

/** The variables that tell which multiplexer a session runs in. */
export type MuxEnv = { herdrEnv?: string | undefined; herdrPane?: string | undefined; tmux?: string | undefined; tmuxPane?: string | undefined }

/** herdr first: it is the one that is made for agents, and `HERDR_ENV=1` is what its own skill checks.
 * Run inside tmux, tmux's variables are inherited too, so they cannot tell the inner one. */
export function detectMux(env: MuxEnv): Mux | undefined {
  if (env.herdrEnv === '1' && env.herdrPane) return 'herdr'
  if (env.tmux && env.tmuxPane) return 'tmux'
  return undefined
}

export type Direction = 'right' | 'down'

export type SplitOptions = { target?: string | undefined; direction: Direction; cwd: string; focus: boolean }

/** The commands of one multiplexer. Each is an argument vector (never a shell string), and the pane
 * to act on is the id `split` made. */
export type MuxDriver = {
  /** A new pane next to `target` (the pane Claude Code runs in when there is none). Prints the new pane. */
  split: (options: SplitOptions) => string[]
  /** The new pane's id, from what `split` printed. */
  paneId: (stdout: string) => string | undefined
  /** Types a line into a pane and presses Enter: one command each. */
  type: (pane: string, line: string) => string[][]
  /** The pane's last `lines` lines, joined where the terminal wrapped them. */
  read: (pane: string, lines: number) => string[]
  /** Asks what the pane's shell is doing. */
  idle: (pane: string) => string[]
  /** Whether what `idle` printed says the shell is at its prompt, with no command running in it. */
  isIdle: (stdout: string) => boolean
  /** Ctrl+C. */
  interrupt: (pane: string) => string[]
  close: (pane: string) => string[]
}

const herdr: MuxDriver = {
  split: ({ target, direction, cwd, focus }) => [
    'herdr', 'pane', 'split', ...(target ? [target] : ['--current']),
    '--direction', direction, '--cwd', cwd, focus ? '--focus' : '--no-focus',
  ],
  paneId: stdout => {
    try {
      const id = (JSON.parse(stdout) as { result?: { pane?: { pane_id?: unknown } } }).result?.pane?.pane_id
      return typeof id === 'string' && id !== '' ? id : undefined
    } catch {
      return undefined
    }
  },
  type: (pane, line) => [['herdr', 'pane', 'run', pane, line]],
  read: (pane, lines) => ['herdr', 'pane', 'read', pane, '--source', 'recent-unwrapped', '--lines', String(lines), '--format', 'text'],
  // The shell is at its prompt when it is the foreground process group of its terminal.
  idle: pane => ['herdr', 'pane', 'process-info', '--pane', pane],
  isIdle: stdout => {
    try {
      const info = (JSON.parse(stdout) as { result?: { process_info?: { foreground_process_group_id?: unknown; shell_pid?: unknown } } }).result?.process_info
      return typeof info?.shell_pid === 'number' && info.foreground_process_group_id === info.shell_pid
    } catch {
      return false
    }
  },
  interrupt: pane => ['herdr', 'pane', 'send-keys', pane, 'C-c'],
  close: pane => ['herdr', 'pane', 'close', pane],
}

// `-d` leaves the focus where it was; `--` ends the options, so a line that starts with a dash is text.
const tmux: MuxDriver = {
  split: ({ target, direction, cwd, focus }) => [
    'tmux', 'split-window', ...(focus ? [] : ['-d']), direction === 'right' ? '-h' : '-v',
    '-P', '-F', '#{pane_id}', '-c', cwd, ...(target ? ['-t', target] : []),
  ],
  paneId: stdout => stdout.trim() || undefined,
  type: (pane, line) => [
    ['tmux', 'send-keys', '-t', pane, '-l', '--', line],
    ['tmux', 'send-keys', '-t', pane, 'Enter'],
  ],
  read: (pane, lines) => ['tmux', 'capture-pane', '-p', '-J', '-t', pane, '-S', `-${lines}`],
  // The same test as herdr's, made with ps: `pid tpgid` of the pane's shell. The pane id is the script's
  // argument, never part of its text.
  idle: pane => ['sh', '-c', 'ps -o pid= -o tpgid= -p "$(tmux display-message -p -t "$1" "#{pane_pid}")"', 'sh', pane],
  isIdle: stdout => {
    const [pid, group] = stdout.trim().split(/\s+/).map(Number)
    return Number.isInteger(pid) && pid > 0 && pid === group
  },
  interrupt: pane => ['tmux', 'send-keys', '-t', pane, 'C-c'],
  close: pane => ['tmux', 'kill-pane', '-t', pane],
}

export const driver = (mux: Mux): MuxDriver => (mux === 'herdr' ? herdr : tmux)

/** One shell word for any text, in the shells people use (bash, zsh, fish, sh): inside single quotes
 * nothing is special, and a single quote itself is closed, escaped and reopened. */
export const shQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

export const EXIT_MARKER = '@@run-pane-exit'

// Runs `$1` in a login shell, then says how it ended, with `$2`: a word that is this run's alone, so a
// pane that ran other commands before (this mod's, in the same pane) never has its old ends read as this one's. `trap :` catches Ctrl+C (a caught signal is
// reset by `exec`, so the command still gets it) and keeps this shell alive to print the marker. `--` keeps
// a command that starts with a dash from being read as options.
const WRAPPER = `trap : INT; sh -lc -- "$1"; c=$?; printf "\\n${EXIT_MARKER} %s %s\\n" "$2" "$c"`

/** What to type into a pane to run `cmd` the way the Run pane does: the wrapper and the command are
 * single-quoted, so the pane's own shell never reads them, whichever shell it is. */
export const typedLine = (cmd: string, token: string): string => `sh -c ${shQuote(WRAPPER)} sh ${shQuote(cmd)} ${shQuote(token)}`

export type PaneRead = { text: string; code?: number }

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What a pane showed, as the output of the command typed into it with `token`: nothing before the line
 * that was typed (the shell's banner and earlier commands, whose own ends carry other tokens), nothing
 * after the marker (the next prompt), and the exit code when the marker is there. Before the typed line
 * has shown up at all there is nothing to read. */
export function readPane(shown: string, token: string): PaneRead {
  const lines = shown.replace(/\r/g, '').split('\n')
  const marker = new RegExp(`^${EXIT_MARKER} ${escaped(token)} (\\d+)\\s*$`)
  // The typed line holds the marker's name inside the wrapper, and the token; the marker is a line of its own.
  let typed = -1
  for (let at = lines.length - 1; at >= 0 && typed < 0; at--) {
    const line = lines[at] as string
    if (line.includes(EXIT_MARKER) && line.includes(token) && !marker.test(line)) typed = at
  }
  let out = lines.slice(typed + 1)
  const ended = out.findIndex(line => marker.test(line))
  if (typed < 0 && ended < 0) return { text: '' }
  let code: number | undefined
  if (ended >= 0) {
    code = Number(marker.exec(out[ended] as string)?.[1])
    out = out.slice(0, ended)
    // The wrapper puts a blank line before the marker, so the output may end without a newline.
    if (out[out.length - 1] === '') out.pop()
  } else {
    while (out.length > 0 && out[out.length - 1] === '') out.pop()
  }
  return { text: out.join('\n'), ...(code === undefined ? {} : { code }) }
}
