// The multiplexer side of /rp and /shell with no engine in it: which multiplexer the session runs
// in, the commands that split a pane, type into it, read it back and close it, and how what a pane
// shows is told from the command that was typed into it.

// `hidden`: no multiplexer of the person's, so a tmux server of the mod's own (its own socket, never shown)
// holds the terminals, and the Run pane is where they are followed.
export type Mux = 'herdr' | 'tmux' | 'hidden'

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
  /** Types a line into a pane and presses Enter: one command each. The line is one command, as typed at a prompt. */
  type: (pane: string, line: string) => string[][]
  /** The pane's last `lines` lines, joined where the terminal wrapped them. */
  read: (pane: string, lines: number) => string[]
  /** Asks what the pane's shell is doing. */
  idle: (pane: string) => string[]
  /** Whether what `idle` printed says the shell is at its prompt, with no command running in front of it. */
  isIdle: (stdout: string) => boolean
  /** The pid of the pane's shell, from what `idle` printed: what its background jobs are children of. */
  shellPid: (stdout: string) => number | undefined
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
  shellPid: stdout => {
    try {
      const pid = (JSON.parse(stdout) as { result?: { process_info?: { shell_pid?: unknown } } }).result?.process_info?.shell_pid
      return typeof pid === 'number' && pid > 1 ? pid : undefined
    } catch {
      return undefined
    }
  },
  interrupt: pane => ['herdr', 'pane', 'send-keys', pane, 'C-c'],
  close: pane => ['herdr', 'pane', 'close', pane],
}

/** The socket of the hidden tmux server and the name of its one session: every run is a window of it. */
export const HIDDEN_SOCKET = 'run-pane'
const HIDDEN_SESSION = 'run-pane'

/** What tells whether tmux is installed. */
export const TMUX_VERSION = ['tmux', '-V']

/** The line a person types into a terminal to look at the hidden server: Ctrl+B d leaves it. `env -u TMUX` lets it be
 * opened from inside a tmux of their own. */
export const HIDDEN_ATTACH = `exec env -u TMUX tmux -L ${HIDDEN_SOCKET} attach -t ${HIDDEN_SESSION}`

/** Brings a pane's window to the front of the hidden session, for the next one to attach to it. */
export const selectArgv = (pane: string): string[] => ['tmux', '-L', HIDDEN_SOCKET, 'select-window', '-t', pane]

/** Whether text is a tmux pane id (`%12`), the only kind of pane the hidden server hands out. */
export const isTmuxPane = (text: string): boolean => /^%\d+$/.test(text)

// `-d` leaves the focus where it was; `--` ends the options, so a line that starts with a dash is text.
const visibleSplit: MuxDriver['split'] = ({ target, direction, cwd, focus }) => [
  'tmux', 'split-window', ...(focus ? [] : ['-d']), direction === 'right' ? '-h' : '-v',
  '-P', '-F', '#{pane_id}', '-c', cwd, ...(target ? ['-t', target] : []),
]

// A window of the hidden session; the first run starts the server and the session (wide, so a line is not
// wrapped before it is read), and one that loses the race to do it makes its window after all. The folder
// is the script's argument, never part of its text.
const hiddenSplit: MuxDriver['split'] = ({ cwd }) => {
  const t = `tmux -L ${HIDDEN_SOCKET}`
  return [
    'sh', '-c',
    `${t} new-window -d -t ${HIDDEN_SESSION}: -P -F '#{pane_id}' -c "$1" 2>/dev/null` +
      ` || ${t} new-session -d -s ${HIDDEN_SESSION} -x 200 -y 50 -P -F '#{pane_id}' -c "$1" 2>/dev/null` +
      ` || exec ${t} new-window -d -t ${HIDDEN_SESSION}: -P -F '#{pane_id}' -c "$1"`,
    'sh', cwd,
  ]
}

/** tmux, on the person's server (no `socket`) or on the hidden one. */
function tmuxDriver(socket: readonly string[], split: MuxDriver['split']): MuxDriver {
  const t = ['tmux', ...socket]
  return {
    split,
    paneId: stdout => stdout.trim() || undefined,
    type: (pane, line) => [
      [...t, 'send-keys', '-t', pane, '-l', '--', line],
      [...t, 'send-keys', '-t', pane, 'Enter'],
    ],
    read: (pane, lines) => [...t, 'capture-pane', '-p', '-J', '-t', pane, '-S', `-${lines}`],
    // The same test as herdr's, made with ps: `pid tpgid` of the pane's shell. The pane id and the socket
    // are the script's arguments, never part of its text.
    idle: pane => ['sh', '-c', 'pane=$1; shift; ps -o pid= -o tpgid= -p "$(tmux "$@" display-message -p -t "$pane" "#{pane_pid}")"', 'sh', pane, ...socket],
    isIdle: stdout => {
      const [pid, group] = stdout.trim().split(/\s+/).map(Number)
      return Number.isInteger(pid) && pid > 0 && pid === group
    },
    shellPid: stdout => {
      const pid = Number(stdout.trim().split(/\s+/)[0])
      return Number.isInteger(pid) && pid > 1 ? pid : undefined
    },
    interrupt: pane => [...t, 'send-keys', '-t', pane, 'C-c'],
    close: pane => [...t, 'kill-pane', '-t', pane],
  }
}

const tmux = tmuxDriver([], visibleSplit)
const hidden = tmuxDriver(['-L', HIDDEN_SOCKET], hiddenSplit)

export const driver = (mux: Mux): MuxDriver => (mux === 'herdr' ? herdr : mux === 'hidden' ? hidden : tmux)

const SGR = /\u001b\[[0-9;]*m/g

const screenLines = (shown: string): string[] => shown.replace(/\r/g, '').replace(SGR, '').split('\n')

// A line ends with the command typed at a prompt: after a space (or alone), so output that merely ends in the
// same letters (`ls` in `tools`) is not taken for it.
const isEcho = (line: string, cmd: string): boolean => {
  const text = line.trimEnd()
  const typed = cmd.trim()
  return text === typed || text.endsWith(` ${typed}`) || text.endsWith(`\t${typed}`)
}

/** How many lines of the pane show `cmd` typed at a prompt. A command typed again has one more than before. */
export const echoes = (shown: string, cmd: string): number => screenLines(shown).filter(line => isEcho(line, cmd)).length

const firstWord = (line: string): string => line.trim().split(/\s+/)[0] ?? ''

/** The lines of a prompt's head (an info line above the line the command is typed on) that follow the output once
 * the command is over: the lines that head the prompt the command was typed at (the non-blank ones right above it)
 * are expected again, after a blank line, in the same shape. At most four lines. */
function promptHead(lines: readonly string[], typed: number, out: readonly string[]): number {
  const head: string[] = []
  for (let at = typed - 1; at >= 0 && head.length <= 4 && (lines[at] as string).trim() !== ''; at--) head.unshift(lines[at] as string)
  if (head.length === 0 || head.length > 4 || head.length >= out.length) return 0
  const tail = out.slice(out.length - head.length)
  const isBlankBefore = out[out.length - head.length - 1] === ''
  return isBlankBefore && tail.every((line, at) => firstWord(line) === firstWord(head[at] as string)) ? head.length : 0
}

/** What a pane showed, as the command's output: what follows the last line that has the command typed at a
 * prompt, and, once the command is over, without the prompt that follows it (all of its lines). */
export function readPane(shown: string, cmd: string, isOver: boolean): string {
  const lines = screenLines(shown)
  let typed = -1
  for (let at = lines.length - 1; at >= 0 && typed < 0; at--) if (isEcho(lines[at] as string, cmd)) typed = at
  const out = lines.slice(typed + 1)
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  // The shell's prompt is the last line once it is back; a command over leaves no other line after its output.
  if (isOver && typed >= 0) {
    out.pop()
    out.length -= promptHead(lines, typed, out)
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
