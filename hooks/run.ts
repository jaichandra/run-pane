// The Run pane's logic with no engine in it: what a command prints, which commands to suggest
// and which processes belong to a run.

import { styleAfter } from './ansi'
import type { Style } from './ansi'

export const MAX_LINES = 2000
export const MAX_SUGGESTIONS = 10
/** What the wrapper prints first, so the mod knows the shell's pid to stop the whole tree by. */
export const PID_MARKER = '@@run-pane-pid '

/** Runs `$1` in a login shell, after saying which process that is. `exec` keeps the pid. */
export const WRAPPER = `printf '${PID_MARKER}%s\\n' "$$" >&2; exec sh -lc "$1"`

// CSI sequences, OSC sequences (title, hyperlinks) and the two-byte escapes.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
// What a log has no use for: every sequence but the ones that set colours and styles (`ESC [ ... m`).
const NOT_SGR = /\u001b\[[0-9;?]*[ -/]*[@-ln-~]|\u001b\[[0-9;?]*[ -/]+m|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
const STRAY_ESC = /\u001b(?!\[[0-9;:]*m)/g
// Control characters but ESC, which the sequences kept above start with.
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g

export const stripAnsi = (text: string): string => text.replace(ANSI, '')

/** A progress bar redraws its line with `\r`: only what is left after the last one shows. */
const afterReturn = (line: string): string => line.slice(line.lastIndexOf('\r') + 1).replace(CONTROLS, '')

/** A line of output as the log keeps it: its text with its colour sequences, and the style it starts in. */
export type LogLine = { text: string; start: Style }

/** The last `MAX_LINES` lines a command printed, held as text arrives in pieces. Colours and styles are kept
 * (a line carries the style the one before left on), every other sequence is dropped. */
export class RunLog {
  private lines: LogLine[] = []
  private partial = ''
  // The style at the end of the last whole line: where the next one starts.
  private style: Style = {}
  // How many lines went off the top, so a line has a number that does not change as new ones arrive.
  private gone = 0

  push(text: string): void {
    const parts = (this.partial + text.replace(NOT_SGR, '').replace(STRAY_ESC, '')).split('\n')
    this.partial = parts.pop() ?? ''
    for (const part of parts) {
      this.lines.push({ text: afterReturn(part), start: this.style })
      this.style = styleAfter(part, this.style)
    }
    if (this.lines.length > MAX_LINES) {
      this.gone += this.lines.length - MAX_LINES
      this.lines.splice(0, this.lines.length - MAX_LINES)
    }
  }

  get size(): number {
    return this.lines.length + (this.partial ? 1 : 0)
  }

  /** How many lines went off the top: the number of the first line held. */
  get first(): number {
    return this.gone
  }

  private all(): LogLine[] {
    return this.partial ? [...this.lines, { text: afterReturn(this.partial), start: this.style }] : this.lines
  }

  /** The last `count` lines as plain text, an unfinished one included: what is said, not how it is drawn. */
  tail(count: number): string[] {
    return this.styled(count).map(line => stripAnsi(line.text))
  }

  /** The same, with the colours and styles. */
  styled(count: number): LogLine[] {
    const all = this.all()
    return count >= all.length ? [...all] : all.slice(all.length - count)
  }

  /** Everything held, as a terminal would take it: each whole line with its colours and a reset after it, and the
   * unfinished one as it is, so what comes next completes it. */
  dump(): string {
    const whole = this.lines.map(line => `${line.text}\u001b[0m`).join('\n')
    return `${whole}${this.lines.length > 0 ? '\n' : ''}${this.partial}`
  }

  clear(): void {
    this.lines = []
    this.partial = ''
    this.style = {}
    this.gone = 0
  }
}

/** A word for a shell line, in single quotes, whatever it holds. */
export const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

// The buttons' colours: light grounds with dark text, so they read on a dark theme and a light one.
export const BUTTON_COLORS = { neutral: '#bdbdc6', primary: '#c3c9fb', danger: '#ff9fb0', success: '#8ed99f' } as const
export const BUTTON_INK = '#1b1b2b'

// Commands that take over the terminal or wait for the person at it, which a pipe cannot give them.
const ALWAYS = new Set([
  // editors
  'vi', 'vim', 'nvim', 'view', 'vimdiff', 'nano', 'pico', 'emacs', 'micro', 'helix', 'hx', 'ed', 'ex', 'joe', 'kak', 'code-tunnel',
  // pagers and manuals
  'less', 'more', 'most', 'man', 'info',
  // monitors
  'top', 'htop', 'btop', 'atop', 'glances', 'nmon', 'iotop', 'nload', 'iftop', 'watch', 'ncdu', 'k9s', 'lazygit', 'lazydocker', 'tig', 'mc', 'ranger', 'nnn', 'fzf',
  // shells and sessions
  'tmux', 'screen', 'ssh', 'mosh', 'telnet', 'ftp', 'sftp', 'nc', 'login', 'su', 'passwd',
])
// Read-eval-print loops: interactive with no script or file to run, a command like any other with one.
const REPLS = new Set(['sh', 'bash', 'zsh', 'fish', 'python', 'python3', 'node', 'deno', 'bun', 'irb', 'pry', 'ipython', 'psql', 'mysql', 'sqlite3', 'redis-cli', 'mongosh', 'lua', 'ghci', 'clj', 'sbcl', 'php', 'ruby', 'perl', 'swift', 'scala', 'jshell', 'R'])
// Words that start a command without being it.
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nice', 'nohup', 'command', 'exec', 'builtin', 'xargs', 'doas', 'caffeinate'])

/** Whether a command needs a terminal of its own: an editor, a pager, a monitor, a shell, a REPL, a container
 * entered with `-it`, an editor `git` opens. `extra` is what `interactive` in hooks/run-pane.json adds (first words). */
export function isInteractive(cmd: string, extra: readonly string[] = []): boolean {
  // Each command of a list or a pipeline: `git log | less`, `cd app && vim x`.
  for (const segment of cmd.split(/&&|\|\||[;|&\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean)
    // Assignments (`EDITOR=vi git ...`), then wrappers (`sudo -u x vim`, whose options and their values are skipped).
    let at = 0
    while (at < words.length && /^[A-Za-z_]\w*=/.test(words[at] as string)) at++
    while (at < words.length && WRAPPERS.has(words[at] as string)) {
      const wrapper = words[at] as string
      at++
      while (at < words.length && (words[at] as string).startsWith('-')) {
        // `sudo -u bob vim`: these options take a value of their own.
        at += (wrapper === 'sudo' || wrapper === 'doas') && /^-[ughpCrtU]$/.test(words[at] as string) ? 2 : 1
      }
    }
    const name = (words[at] ?? '').split('/').pop() ?? ''
    if (name === '') continue
    const args = words.slice(at + 1)
    if (ALWAYS.has(name) || extra.includes(name)) return true
    const operands = args.filter(arg => !arg.startsWith('-'))
    if (REPLS.has(name) && operands.length === 0) return true
    if (['docker', 'podman', 'kubectl', 'oc', 'nerdctl'].includes(name) && /^(exec|run|attach)$/.test(operands[0] ?? '') && args.some(arg => /^-[a-zA-Z]*(it|ti)[a-zA-Z]*$/.test(arg) || arg === '--tty' || arg === '-t')) return true
    if (name === 'git') {
      const verb = operands[0]
      const has = (...flags: string[]): boolean => args.some(arg => flags.some(flag => arg === flag || arg.startsWith(`${flag}=`)))
      if (verb === 'rebase' && has('-i', '--interactive')) return true
      if (verb === 'add' && has('-p', '--patch', '-i', '--interactive')) return true
      // A commit with no message given opens the editor.
      if (verb === 'commit' && !has('-m', '--message', '-F', '--file', '-C', '--reuse-message', '--no-edit', '--dry-run')) return true
    }
  }
  return false
}

const PREFERRED = ['dev', 'start', 'serve', 'watch', 'test', 'build', 'lint']

/** `npm run <script>` for each script of a package.json, the usual ones first. */
export function packageScripts(text: string): string[] {
  let scripts: unknown
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts
  } catch {
    return []
  }
  if (typeof scripts !== 'object' || scripts === null) return []
  const names = Object.keys(scripts).filter(name => /^[\w:.-]+$/.test(name))
  const rank = (name: string): number => {
    const at = PREFERRED.indexOf(name.split(':')[0] ?? '')
    return at < 0 ? PREFERRED.length : at
  }
  return names
    .map((name, at) => ({ name, at }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.at - b.at)
    .map(({ name }) => `npm run ${name}`)
}

/** `make <target>` for each plain target of a Makefile: not a pattern, a variable or a special one. */
export function makeTargets(text: string): string[] {
  const found: string[] = []
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z0-9][\w.-]*)\s*:(?![=:])/.exec(line)
    const target = match?.[1]
    if (target && !found.includes(target)) found.push(target)
  }
  return found.map(target => `make ${target}`)
}

export type Suggestion = { cmd: string; label: string }

/** What a suggested command is for, to colour its button: running something (a dev server, a start), testing it, or
 * anything else. Told by the last word (`npm run start:ci`, `make test`, `cargo run`). */
export function suggestionKind(cmd: string): 'run' | 'test' | 'other' {
  const name = cmd.trim().split(/\s+/).pop() ?? ''
  if (/^(dev|start|serve|watch|run|up)\b/i.test(name)) return 'run'
  if (/^(test|e2e|spec|check|verify)\b/i.test(name)) return 'test'
  return 'other'
}

const TOOL_PREFIX = /^(npm run|pnpm run|yarn|pnpm|bun run|make|cargo) (\S+)$/

/** The suggestions in groups that share what they start with: `npm run` once, then `dev`, `start:ci`, `test`...
 * A command that starts with none of the tools is a group of one with no prefix. */
export function groupSuggestions(cmds: readonly string[]): { prefix: string; items: Suggestion[] }[] {
  const groups: { prefix: string; items: Suggestion[] }[] = []
  for (const cmd of cmds) {
    const match = TOOL_PREFIX.exec(cmd)
    const prefix = match?.[1] ?? ''
    const item = { cmd, label: match?.[2] ?? cmd }
    const last = groups[groups.length - 1]
    if (last && last.prefix === prefix && prefix !== '') last.items.push(item)
    else groups.push({ prefix, items: [item] })
  }
  return groups
}

export type ProjectFiles = { packageJson?: string; makefile?: string; hasCargo?: boolean; extra?: readonly string[] }

export function suggestions(files: ProjectFiles): string[] {
  // What hooks/run-pane.json lists comes first: it is what whoever set the mod up wants suggested most.
  const all = [
    ...(files.extra ?? []),
    ...(files.packageJson === undefined ? [] : packageScripts(files.packageJson)),
    ...(files.hasCargo ? ['cargo run', 'cargo test'] : []),
    ...(files.makefile === undefined ? [] : makeTargets(files.makefile)),
  ]
  return [...new Set(all)].slice(0, MAX_SUGGESTIONS)
}

/** The pid the wrapper reported, and the text after its line. Undefined while the line is incomplete. */
export function readPid(head: string): { pid?: number; rest: string } | undefined {
  if (!head.startsWith(PID_MARKER)) return head.length < PID_MARKER.length && PID_MARKER.startsWith(head) ? undefined : { rest: head }
  const end = head.indexOf('\n')
  if (end < 0) return undefined
  const pid = Number(head.slice(PID_MARKER.length, end))
  return { ...(Number.isInteger(pid) && pid > 1 ? { pid } : {}), rest: head.slice(end + 1) }
}

/** `root` and everything below it, from `ps -A -o pid=,ppid=`. */
export function descendants(ps: string, root: number): number[] {
  const children = new Map<number, number[]>()
  for (const line of ps.split('\n')) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number)
    if (pid === undefined || parent === undefined || !Number.isInteger(pid) || !Number.isInteger(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const found = [root]
  for (let at = 0; at < found.length; at++) {
    for (const child of children.get(found[at] as number) ?? []) if (!found.includes(child)) found.push(child)
  }
  return found
}

// `done`: ended with no exit code to tell (a command typed into a multiplexer pane's own shell).
export type RunStatus = 'running' | 'exited' | 'done' | 'stopped' | 'failed'

export function statusMark(status: RunStatus, code: number | null): string {
  if (status === 'running') return '●'
  if (status === 'stopped') return '■'
  if (status === 'done') return '○'
  return status === 'exited' && code === 0 ? '✓' : '✗'
}

export function statusWords(status: RunStatus, code: number | null): string {
  if (status === 'running') return 'running'
  if (status === 'stopped') return 'stopped'
  if (status === 'done') return 'done'
  if (status === 'failed') return 'could not start'
  return code === null ? 'killed' : `exit ${code}`
}

/** Whether any pattern occurs in the text, ignoring case. No patterns match nothing. */
export function matchesAny(text: string, patterns: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return patterns.some(pattern => pattern.trim() !== '' && lower.includes(pattern.trim().toLowerCase()))
}

export type PartKind = 'plain' | 'border' | 'url' | 'banner' | 'comment' | 'command' | 'heading' | 'error' | 'warning'

export type Part = { text: string; kind: PartKind }

const FRAME = '\u2502\u2503\u2551\u250c\u2510\u2514\u2518\u256d\u256e\u2570\u256f\u2500'
const FRAMED = new RegExp(`^([\\s${FRAME}]*)(.*?)([\\s${FRAME}]*)$`)
const URL = /https?:\/\/[^\s\u2502\u2503\u2551<>"']+/g
const COMMAND = /^(docker|docker-compose|curl|npm|npx|pnpm|yarn|make|cargo|git|kubectl|helm)\s/
const ERROR = /\b(ERROR|FATAL|Error:|failed|Failed)\b/
const WARNING = /\b(WARN|WARNING|warning:)\b/

/** What a line of a command's output is, for colouring: its frame, URLs, `# notes`, `▶` banners,
 * command lines to copy, headings that end in a colon, and error and warning words. */
export function highlight(line: string): Part[] {
  const framed = FRAMED.exec(line)
  const [lead = '', core = line, tail = ''] = framed ? [framed[1], framed[2], framed[3]] : ['', line, '']
  const text = core.trim()
  const hasUrl = /https?:\/\//.test(core)
  let kind: PartKind = 'plain'
  if (text.startsWith('\u25b6')) kind = 'banner'
  else if (text.startsWith('#')) kind = 'comment'
  else if (COMMAND.test(text)) kind = 'command'
  else if (text.endsWith(':') && !hasUrl) kind = 'heading'
  else if (ERROR.test(text)) kind = 'error'
  else if (WARNING.test(text)) kind = 'warning'

  const parts: Part[] = []
  if (lead) parts.push({ text: lead, kind: 'border' })
  let at = 0
  for (const match of core.matchAll(URL)) {
    const index = match.index ?? 0
    // A URL does not end in the punctuation of the sentence around it.
    const url = match[0].replace(/[.,;:)\]]+$/, '')
    if (index > at) parts.push({ text: core.slice(at, index), kind })
    parts.push({ text: url, kind: 'url' })
    at = index + url.length
  }
  if (at < core.length) parts.push({ text: core.slice(at).trimEnd(), kind })
  const border = tail.trim()
  if (border) parts.push({ text: ` ${border}`, kind: 'border' })
  return parts.filter(part => part.text !== '')
}

/** Whether a scroll move leaves the window on the last rows (or the whole tree fits). */
export function isAtBottom(move: { offset: number; bodyRows: number; contentRows: number }): boolean {
  return move.contentRows <= move.bodyRows || move.offset >= move.contentRows - move.bodyRows
}
