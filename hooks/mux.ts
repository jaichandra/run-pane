// The multiplexer side of /rp and /shell with no engine in it: which multiplexer the session runs
// in, the commands that split a pane, type into it, read it back and close it, and how what a pane
// shows is told from the command that was typed into it.

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
  shellPid: stdout => {
    const pid = Number(stdout.trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  },
  interrupt: pane => ['tmux', 'send-keys', '-t', pane, 'C-c'],
  close: pane => ['tmux', 'kill-pane', '-t', pane],
}

export const driver = (mux: Mux): MuxDriver => (mux === 'herdr' ? herdr : tmux)

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

/** What a pane showed, as the command's output: what follows the last line that has the command typed at a
 * prompt, and, once the command is over, without the prompt that follows it. */
export function readPane(shown: string, cmd: string, isOver: boolean): string {
  const lines = screenLines(shown)
  let typed = -1
  for (let at = lines.length - 1; at >= 0 && typed < 0; at--) if (isEcho(lines[at] as string, cmd)) typed = at
  const out = lines.slice(typed + 1)
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  // The shell's prompt is the last line once it is back; a command over leaves no other line after its output.
  if (isOver && typed >= 0) out.pop()
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
