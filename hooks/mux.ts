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

/** What to type into a pane to run `cmd`: the script that clears the pane, shows the command, runs it and
 * reports how it ended (hooks/rp-run.sh). Both words are single-quoted, so the pane's own shell never reads
 * the command, whichever shell it is. */
export const typedLine = (script: string, cmd: string): string => `sh ${shQuote(script)} ${shQuote(cmd)}`

export type PaneRead = { text: string; code?: number }

// The line the script ends with: dim, two box-drawing dashes and the exit code.
const FOOTER = /^\u2500\u2500 exit (\d+)\s*$/
const SGR = /\u001b\[[0-9;]*m/g

/** What a pane showed, as the command's output: the command's own line at the top (the Run pane lists the
 * command already) and the footer at the end, with the exit code when the footer is there, are not part of
 * it; nor is anything after the footer (the next prompt). */
export function readPane(shown: string, cmd: string): PaneRead {
  let out = shown.replace(/\r/g, '').replace(SGR, '').split('\n')
  let code: number | undefined
  for (let at = out.length - 1; at >= 0 && code === undefined; at--) {
    const found = FOOTER.exec(out[at] as string)
    if (found) {
      code = Number(found[1])
      out = out.slice(0, at)
    }
  }
  if (out[0] === `$ ${cmd}`) out = out.slice(1)
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return { text: out.join('\n'), ...(code === undefined ? {} : { code }) }
}
