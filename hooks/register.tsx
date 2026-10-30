import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  descendants,
  highlight,
  isAtBottom,
  matchesAny,
  MAX_LINES,
  readPid,
  RunLog,
  statusMark,
  statusWords,
  suggestions,
  WRAPPER,
} from './run'
import type { PartKind, RunStatus } from './run'
import { hasControls, ITERM_PATH, NOT_MACOS, oneLine, osascriptArgv } from './shell'
import type { TerminalApp } from './shell'

const PANE = 'run'
const TOOL = 'mcp__run-pane__run_output'
const REDRAW_MS = 120
const FOLLOW_MS = 40
const KEEP_RUNS = 12
const POLL_MS = 500
// How long a run gets to wind itself down after Ctrl+C (a stack tearing down its containers: 30 s),
// and then after SIGTERM (10 s), before the next signal. "Force kill" skips the waiting.
const INTERRUPT_POLLS = 60
const TERM_POLLS = 20

const rev = atom({ plugin: 'run-pane', key: 'rev' } as const, 0, { shape: 'rev-1' })
const draft = atom({ plugin: 'run-pane', key: 'draft' } as const, '', { shape: 'draft-1' })
const selected = atom({ plugin: 'run-pane', key: 'selected' } as const, 0, { shape: 'selected-1' })

type Run = {
  id: number
  cmd: string
  cwd: string
  status: RunStatus
  code: number | null
  log: RunLog
  pid?: number
  // Stop was asked: however the process ends, the run reads stopped.
  isStopping?: boolean
  // Force kill was pressed: no more waiting.
  isForced?: boolean
  // Ends the read loop, which leaves the stream and so kills the shell the engine started.
  release?: () => void
}

// Theme keys, so the colours follow the person's theme. A URL is underlined, not a `Link`: a
// terminal without OSC 8 links draws a Link's text and then its address, so it would show twice,
// and terminals that open URLs on a click do so for plain text.
const STYLE: Record<Exclude<PartKind, 'plain' | 'url'>, { color?: string; dimColor?: true; bold?: true }> = {
  border: { dimColor: true },
  banner: { color: 'success', bold: true },
  comment: { dimColor: true },
  command: { color: 'warning' },
  heading: { bold: true },
  error: { color: 'error' },
  warning: { color: 'warning' },
}

const folderName = (cwd: string): string => cwd.split('/').filter(Boolean).pop() ?? cwd

const runs: Run[] = []
const hints = new Map<string, string[]>()
let seq = 0
let isRedrawQueued = false
// Whether the pane is scrolled to its bottom: then new output keeps it there. Scrolling up (the
// person's wheel or keys) ends that; scrolling back down to the bottom, or End, brings it back.
let isFollowing = true

// After a draw that grew the output: back to the bottom, if that is where the pane was.
async function follow($: EngineInterface): Promise<void> {
  if (!isFollowing) return
  await $.clock.sleep(FOLLOW_MS)
  if (isFollowing) await $.ui.scroll({ in: PANE, to: 'end' })
}

function redraw($: EngineInterface): void {
  if (isRedrawQueued) return
  isRedrawQueued = true
  void $.clock
    .sleep(REDRAW_MS)
    .then(() => {
      isRedrawQueued = false
      return update($, rev, n => n + 1).then(() => follow($))
    })
    .catch(() => {
      isRedrawQueued = false
    })
}

function showStatus($: EngineInterface): void {
  const running = runs.filter(run => run.status === 'running').length
  $.ui.status(running > 0 ? `▶ ${running} running · /rp · /shell` : '▶ /rp · /shell')
}

// hooks/run-pane.json is optional and meant for whoever bundles the mod: `suggestions` (commands to
// suggest first) and `openFor` (words that make the pane open by itself). Without it, the defaults.
type Settings = { suggestions?: unknown; openFor?: unknown }

async function settings($: EngineInterface): Promise<Settings> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(`${$.plugin.root}/hooks/run-pane.json`))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Settings) : {}
  } catch {
    return {}
  }
}

// The pane opens by itself, without taking the keyboard, in a folder whose git remote or path
// names one of the `openFor` words (hooks/run-pane.json); anywhere else it waits for `/rp`. A linked
// worktree shares its repository's remote, so it counts too.
async function openIfWanted($: EngineInterface): Promise<void> {
  const { openFor } = await settings($)
  const words = Array.isArray(openFor) ? openFor.filter((one): one is string => typeof one === 'string') : []
  if (words.length === 0) return
  const cwd = await $.session.cwd()
  let remote = ''
  try {
    remote = (await $.process.run(['git', '-C', cwd, 'remote', 'get-url', 'origin'], { timeoutMs: 3_000 })).stdout
  } catch {
    // Not a repository, or git is not there: the path alone decides.
  }
  if (matchesAny(`${remote}\n${cwd}`, words)) await $.ui.open({ id: PANE, title: 'Run', closeOnEscape: true })
}

async function suggest($: EngineInterface, cwd: string): Promise<string[]> {
  const known = hints.get(cwd)
  if (known) return known
  const text = (name: string): Promise<string | undefined> => $.fs.read(`${cwd}/${name}`).catch(() => undefined)
  const [packageJson, makefile, cargo] = await Promise.all([text('package.json'), text('Makefile'), text('Cargo.toml')])
  const { suggestions: more } = await settings($)
  const extra = Array.isArray(more) ? more.filter((one): one is string => typeof one === 'string' && one.trim() !== '') : []
  const found = suggestions({
    extra,
    ...(packageJson === undefined ? {} : { packageJson }),
    ...(makefile === undefined ? {} : { makefile }),
    hasCargo: cargo !== undefined,
  })
  hints.set(cwd, found)
  return found
}

async function signal($: EngineInterface, pid: number, name: 'INT' | 'TERM' | 'KILL'): Promise<void> {
  try {
    const ps = await $.process.run(['ps', '-A', '-o', 'pid=,ppid='], { timeoutMs: 5_000 })
    const pids = descendants(ps.stdout, pid)
    await $.process.run(['kill', `-${name}`, ...pids.map(String)], { timeoutMs: 5_000 })
  } catch {
    // Already gone.
  }
}

async function waitForEnd($: EngineInterface, run: Run, polls: number): Promise<boolean> {
  for (let at = 0; at < polls && run.status === 'running' && !run.isForced; at++) await $.clock.sleep(POLL_MS)
  return run.status !== 'running'
}

// Ctrl+C (SIGINT to the shell and everything below it, as a terminal sends it) first, so it can
// clean up; SIGTERM and then SIGKILL only if it does not end in time, or at once when forced.
async function stop($: EngineInterface, run: Run): Promise<void> {
  if (run.status !== 'running') return
  run.isStopping = true
  const pid = run.pid
  if (pid !== undefined) {
    await signal($, pid, 'INT')
    if (await waitForEnd($, run, INTERRUPT_POLLS)) return
    await signal($, pid, 'TERM')
    if (await waitForEnd($, run, TERM_POLLS)) return
    await signal($, pid, 'KILL')
  }
  run.release?.()
}

function finish($: EngineInterface, run: Run, status: RunStatus, code: number | null): void {
  if (run.status !== 'running') return
  run.status = run.isStopping && status === 'exited' ? 'stopped' : status
  run.code = code
  run.release = undefined
  showStatus($)
  redraw($)
}

async function start($: EngineInterface, cmd: string): Promise<Run> {
  isFollowing = true
  const run: Run = { id: ++seq, cmd, cwd: await $.session.cwd(), status: 'running', code: null, log: new RunLog() }
  runs.push(run)
  const done = runs.filter(one => one.status !== 'running')
  for (const old of done.slice(0, Math.max(0, runs.length - KEEP_RUNS))) runs.splice(runs.indexOf(old), 1)
  await update($, selected, () => run.id)
  showStatus($)
  redraw($)

  const stopped = new Promise<'stop'>(resolve => {
    run.release = () => resolve('stop')
  })
  void (async () => {
    const stream = $.process.spawn({ argv: ['sh', '-c', WRAPPER, 'sh', cmd], cwd: run.cwd })
    const it = stream[Symbol.asyncIterator]()
    let head: string | undefined = ''
    try {
      for (;;) {
        const step = await Promise.race([it.next(), stopped])
        if (step === 'stop') {
          void it.return({ code: null, signal: 'SIGTERM' }).catch(() => undefined)
          finish($, run, 'stopped', null)
          return
        }
        if (step.done) {
          finish($, run, 'exited', step.value.code)
          return
        }
        if (head === undefined) {
          run.log.push(step.value.text)
        } else {
          head += step.value.text
          const parsed = readPid(head)
          if (parsed) {
            head = undefined
            if (parsed.pid !== undefined) run.pid = parsed.pid
            if (parsed.rest) run.log.push(parsed.rest)
          }
        }
        redraw($)
      }
    } catch (error) {
      run.log.push(`${error instanceof Error ? error.message : String(error)}\n`)
      finish($, run, 'failed', null)
    }
  })()
  return run
}

// A new window with a shell in the session's folder: iTerm where it is installed, else Terminal.app.
// macOS only. Whatever goes wrong comes back as one line of words, never as a throw.
async function openShell($: EngineInterface): Promise<string> {
  try {
    const system = await $.process.run(['uname', '-s'], { timeoutMs: 3_000 }).catch(() => undefined)
    if (system?.stdout.trim() !== 'Darwin') return NOT_MACOS
    const folder = await $.session.cwd()
    if (hasControls(folder)) return "The folder's name has a control character in it, so /shell will not type it into a terminal: open one there yourself."
    const app: TerminalApp = (await $.fs.exists(ITERM_PATH)) ? 'iTerm' : 'Terminal'
    const made = await $.process.run(osascriptArgv(app, folder), { timeoutMs: 15_000 })
    if (made.exitCode === 0) return `Opened a shell window in ${app}: ${folder}`
    return `Could not open a window in ${app}: ${oneLine(made.stderr || made.stdout) || `osascript exited with ${made.exitCode}`}`
  } catch (error) {
    return `Could not open a terminal window: ${oneLine(error instanceof Error ? error.message : String(error)) || 'osascript did not start'}`
  }
}

// Columns the pane asks for while docked beside a fullscreen transcript (the engine caps it at 45%).
const DOCK_COLUMNS = 60

// Said when the pane sits above the prompt (the classic renderer): the buttons need the mouse support
// of the flicker-free display mode, which is also the one that docks the pane on the right.
const DOCS_URL = 'https://code.claude.com/docs/en/fullscreen'
const DOCK_HINT = `Limited view: the buttons need Claude Code's flicker-free display mode. Run /tui fullscreen (it saves the choice), or start with CLAUDE_CODE_NO_FLICKER=1 claude. Details: ${DOCS_URL}`

// What `/rp` does: open the pane, and start the command if there is one.
async function runPrompt($: EngineInterface, args: string, isFullscreen: boolean): Promise<string> {
  const cmd = args.trim()
  if (cmd === 'close') {
    await $.ui.close({ id: PANE })
    return 'Run pane closed. Commands keep running; /rp shows them again.'
  }
  const placed = await $.ui.open({ id: PANE, title: 'Run', focus: true, closeOnEscape: true, columns: DOCK_COLUMNS })
  showStatus($)
  // Docked beside the transcript only in the fullscreen layout; otherwise it sits above the prompt.
  const hint = placed.isPlaced && !isFullscreen ? ` ${DOCK_HINT}` : ''
  if (cmd === '') return placed.isPlaced ? `Run pane opened.${hint}` : 'The Run pane needs a wider terminal (about 110 columns) or the flicker-free display mode (CLAUDE_CODE_NO_FLICKER=1 claude).'
  const run = await start($, cmd)
  return `Started #${run.id}: ${cmd}${placed.isPlaced ? hint : ' (the Run pane needs a wider terminal to show it)'}`
}

const open = (id: number): Run | undefined => runs.find(run => run.id === id)

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rp',
      description: 'Run a command in the Run pane; with none, open the pane (/rp close closes it)',
      argumentHint: '[command | close]',
      immediate: true,
    })
    await $.command.register({
      name: 'shell',
      description: 'Open a terminal window with a shell in this folder (macOS)',
      immediate: true,
    })
    await $.tool.register({
      name: 'run_output',
      description:
        'The latest output of a command the person started in the Run pane (a dev server, a test run). Give `run` as its number or part of its command; with none, the newest run.',
      inputSchema: {
        type: 'object',
        properties: {
          run: { type: 'string', description: 'The run number, or part of its command' },
          lines: { type: 'number', description: 'How many of the last lines to return (default 60, at most 500)' },
        },
      },
    })
    showStatus($)
    void openIfWanted($).catch(() => undefined)
    return next(e)
  })

  // `/rp npm run dev` runs a command in the pane, `/rp` opens it, `/rp close` closes it.
  on('command.run', { command: 'rp' }, async ($, e) => ({ text: await runPrompt($, e.args, e.presentation?.isFullscreen === true) }))

  on('command.run', { command: 'shell' }, async $ => ({ text: await openShell($) }))

  on('tool.call', { tool: TOOL }, ($, e) => {
    const wanted = typeof e.run === 'string' ? e.run.trim() : ''
    const run = wanted
      ? runs.find(one => String(one.id) === wanted.replace(/^#/, '')) ?? [...runs].reverse().find(one => one.cmd.includes(wanted))
      : runs[runs.length - 1]
    if (!run) return { result: runs.length === 0 ? 'Nothing has been run in the Run pane yet.' : `No run matches "${wanted}".` }
    const count = typeof e.lines === 'number' && e.lines > 0 ? Math.min(Math.floor(e.lines), 500) : 60
    const lines = run.log.tail(count)
    return {
      result: [`#${run.id} ${run.cmd} (${statusWords(run.status, run.code)}), last ${lines.length} of ${run.log.size} lines:`, ...lines].join('\n'),
    }
  })

  // Every move of the pane's window, the person's or this mod's own, says whether it ends at the
  // bottom.
  on('ui.scroll', { requestId: PANE }, (_$, e, next) => {
    isFollowing = isAtBottom(e)
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await Promise.all(runs.filter(run => run.status === 'running').map(run => stop($, run)))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const tags = $.ui.resolve(e)
    const { Box, Text, Button } = tags
    const Input = 'Input' in tags ? tags.Input : undefined
    await read($, rev)
    const cwd = await $.session.cwd()
    const typed = await read($, draft)
    const picked = open(await read($, selected)) ?? runs[runs.length - 1]
    const hints = await suggest($, cwd)

    const go = (cmd: string): void => {
      const text = cmd.trim()
      if (text === '') return
      void update($, draft, () => '')
      void start($, text)
    }

    // The pane scrolls as a whole (wheel, or the keys while it has the focus), so the output is
    // drawn in full and everything above it scrolls away with the top of it. The buttons are
    // drawn above the output and below it, so they are in reach at either end.
    const output = picked?.log.tail(MAX_LINES) ?? []

    const toolbar = (at: string): JSX.Element => (
      <Box flexWrap="wrap" columnGap={1}>
        {picked?.status === 'running' && (
          <Button
            key={`${picked.isStopping ? 'force' : 'stop'}:${picked.id}${at}`}
            label={picked.isStopping ? 'Force kill' : 'Stop (Ctrl+C)'}
            onPress={() => {
              if (picked.isStopping) picked.isForced = true
              else void stop($, picked)
            }}
          />
        )}
        {picked && picked.status !== 'running' && (
          <Button
            key={`restart:${picked.id}${at}`}
            label="Restart"
            onPress={() => {
              runs.splice(runs.indexOf(picked), 1)
              void start($, picked.cmd)
            }}
          />
        )}
        {picked && (
          <Button
            key={`clear:${picked.id}${at}`}
            label="Clear"
            onPress={() => {
              picked.log.clear()
              redraw($)
            }}
          />
        )}
        {picked && picked.status !== 'running' && (
          <Button
            key={`remove:${picked.id}${at}`}
            label="Remove"
            onPress={() => {
              runs.splice(runs.indexOf(picked), 1)
              redraw($)
            }}
          />
        )}
        <Button key={`top${at}`} label="Top" onPress={() => void $.ui.scroll({ in: PANE, to: 'start' })} />
        <Button key={`end${at}`} label="End" onPress={() => void $.ui.scroll({ in: PANE, to: 'end' })} />
        <Button key={`shell${at}`} label="Shell window" onPress={() => void openShell($).then(text => $.ui.toast(text))} />
        <Button key={`close${at}`} label="Close pane" onPress={() => void $.ui.close({ id: PANE })} />
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-start">
          {folderName(cwd)}
        </Text>
        {e.props.placement === 'inline' && (
          <Text color="error" bold wrap="wrap">
            {DOCK_HINT}
          </Text>
        )}
        {toolbar('')}
        <Text dimColor>
          {picked ? `#${picked.id}: Stop sends Ctrl+C and waits up to 30 s for it to clean up before forcing it. ` : ''}Close pane or Esc leaves runs going.
        </Text>
        {Input ? (
          <Input
            key="cmd"
            label="$ "
            placeholder="a command, then Enter"
            value={typed}
            onInput={value => void update($, draft, () => value)}
            onSubmit={go}
          />
        ) : (
          <Text dimColor>Type &gt; &lt;command&gt; to start one.</Text>
        )}
        {hints.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Suggestions</Text>
            {hints.map(cmd => (
              <Button plain key={`hint:${cmd}`} label={cmd} onPress={() => go(cmd)} />
            ))}
          </Box>
        )}
        <Text dimColor> </Text>
        {runs.length === 0 && <Text dimColor>Nothing running. Pick a suggestion or type a command.</Text>}
        {runs.map(run => (
          <Box key={`run:${run.id}`}>
            <Button
              plain
              key={`pick:${run.id}`}
              label={`${picked?.id === run.id ? '\u25b8' : ' '} ${statusMark(run.status, run.code)} #${run.id} ${run.cmd}`}
              onPress={() => void update($, selected, () => run.id)}
            />
            <Text dimColor> {run.isStopping && run.status === 'running' ? 'stopping\u2026' : statusWords(run.status, run.code)}</Text>
          </Box>
        ))}
        {picked && (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text dimColor wrap="truncate-end">
              #{picked.id} output ({picked.log.size} lines)
            </Text>
            {output.map(line => (
              <Text wrap="truncate-end">
                {line === ''
                  ? ' '
                  : highlight(line).map(part =>
                      part.kind === 'url' ? (
                        <Text color="suggestion" underline>
                          {part.text}
                        </Text>
                      ) : part.kind === 'plain' ? (
                        part.text
                      ) : (
                        <Text {...STYLE[part.kind]}>{part.text}</Text>
                      ),
                    )}
              </Text>
            ))}
            {picked.log.size === 0 && <Text dimColor>No output yet.</Text>}
          </Box>
        )}
        {toolbar('-b')}
      </Box>
    )
  })
}
