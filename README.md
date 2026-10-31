<p align="center">
  <img src=".claude-plugin/icon.png" alt="run-pane icon" width="96" height="96">
</p>

<h1 align="center">run-pane</h1>

<p align="center">
  Run dev servers, test watchers and other commands in a Run pane beside your Claude Code chat,<br>
  and let Claude read what they print.
</p>

## What you get

- **A Run pane.** Start a command, watch its output live while you keep chatting, and stop it cleanly when you are done.
- **Claude can see the output.** Ask "why did the server crash?" and Claude reads what is on your screen.
- **One-click suggestions.** The pane offers the scripts it finds in your project (`npm run dev`, `cargo test`, `make build`, ...).
- **A shell on demand.** `/shell` opens a shell in the session's folder: a terminal pane beside Claude Code in herdr or tmux, a terminal window on macOS.
- **Colours and links.** Output keeps the colours and styles the command printed, and every URL and file path in it is a press: URLs open in the browser, files open in the app your system opens them with.
- **Interactive commands get a terminal.** `vi`, `less`, `ssh`, `htop`, a REPL or a prompt run in a real terminal (a pane beside Claude Code in herdr, tmux or iTerm2, else a hidden tmux window), and the Run pane keeps showing what they print, with an **Attach** next to the run to type into it.

## Quick start

1. Install it (see [Install](#install)).
2. Type `/rp npm run dev` (or any command) at the prompt.
3. Watch it run in the Run pane. Press **Stop (Ctrl+C)** when you are finished.

| Command | What it does |
| --- | --- |
| `/rp <command>` | Runs the command in the Run pane. |
| `/rp` | Opens the Run pane. |
| `/rp close` | Closes the Run pane. Runs keep going. |
| `/shell` | Opens a shell in the session's folder: a pane in herdr or tmux, else a terminal window (macOS). |

`/rp` is a slash command, so it never reaches Claude and the prompt box clears by itself.

## Install

At the prompt of a terminal session:

```
/plugin install run-pane --marketplace jaichandra/run-pane
```

Or from a shell:

```
claude plugin install run-pane --marketplace jaichandra/run-pane
```

Answer `y` to add the marketplace, then pick a scope (the first, user scope, keeps it on in every session). It is active in the current session at once.

**Desktop app** (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `jaichandra/run-pane`, then **Add plugin**.

### Requirements

- Works in the terminal (CLI) session, which is where it is known to work. `/rp` tells you when it cannot place the Run pane.
- **Turn on the flicker-free display mode** (Claude Code calls it [fullscreen rendering](https://code.claude.com/docs/en/fullscreen)). The Run pane is built for it: it docks on the right of the chat (from about 110 columns wide) and its buttons work, because the mode adds mouse support. It is not a maximised window: a normal-sized window works. Without it the pane sits below the chat as a limited view and its buttons may not respond. Some setups start with it on (iTerm, Terminal.app) and some with it off (a plain Debian terminal, or a saved `"tui": "default"` setting). To turn it on, run `/tui fullscreen` in the session (it relaunches with your conversation intact and saves the choice), or start Claude Code with `CLAUDE_CODE_NO_FLICKER=1 claude`. `/rp` and the Run pane itself show a red notice, with a link to those docs, whenever it is in the limited view.
- `/rp` runs commands through `sh`, `ps` and `kill`: macOS and Linux, not Windows.
- `/shell` needs herdr or tmux, or macOS (Terminal or iTerm).

## Using it

### The Run pane

`/rp` opens the Run pane and gives it the keyboard. From top to bottom it shows:

- the folder's name;
- a command field, `$ `: type a command and press Enter;
- **Suggestions**, as pills in one wrapping row after a dim `Try`, the words they share (`npm run`, `make`, `cargo`) said once, and coloured by what they do (lavender for running and serving, green for testing, grey for the rest); each has a half-row cap, so rows of them are half a row apart (press to run): `npm run <script>` for every script in the folder's `package.json` (`dev`, `start`, `serve`, `watch`, `test`, `build` and `lint` first), `cargo run` and `cargo test` where there is a `Cargo.toml`, and `make <target>` for each plain target of a `Makefile`; ten at most;
- the runs, newest last: `●` running, `✓` exited with 0, `✗` exited with an error or could not start, `■` stopped; press one to see its output;
- the output of the selected run, the last 2,000 lines of it, **in the colours and styles the command printed** (16, 256 and true colour, bold, dim, italic, underline, inverse and strikethrough). Commands run as they would in a pipe, so a tool that colours only for a terminal prints plain text; to have one colour anyway, start it with `FORCE_COLOR=1` (`/rp FORCE_COLOR=1 npm test`) or set `"forceColor": true` in `hooks/run-pane.json` for every command (a script that reads its tools' output for a phrase, like `compiled successfully`, can stop finding it once that is coloured). A line the command did not style is coloured by what it looks like: `# notes` dimmed, `▶` banners green, command lines (`npm`, `docker`, `make`, `git`, ...) and warnings in the warning colour, errors in the error colour, headings that end in a colon bold. **URLs and files are presses**: a URL (`http` or `https`) opens in the browser, and a path that exists (`src/app.ts:12:5`, `./run.sh`, `~/notes/a.md`, resolved from the run's folder) opens with what your system opens it with (`open` on macOS, `xdg-open` elsewhere). A line a progress bar keeps redrawing shows its last state;
- one row of buttons, last, so it stays in view while the Run pane follows the output (scroll back down to the last line and it follows the output again). Every button is a pill: dark text on a light colour (red for Stop, lavender for Restart, Attach and Open in shell, green for tests, grey for the rest) with half-block ends, so it reads as a control and as rounded in any font.

The buttons:

| Button | What it does |
| --- | --- |
| Stop (Ctrl+C) | Ends the selected run the way a terminal would: Ctrl+C (SIGINT) to its shell and everything below it, then SIGTERM after 30 s, then SIGKILL after another 10 s, if it has not ended. While it is stopping the button reads **Force kill**, which skips the waiting. |
| Restart | Runs a finished run's command again. |
| Clear | Empties the selected run's output. |
| Remove | Takes a finished run off the list. |
| Open in shell | Opens the selected run in a terminal. A run in a hidden terminal: the same as Attach. A run in a pane beside Claude Code: says so. A process of the plugin (it runs on pipes, with no terminal to attach to): a terminal window (in the terminal Claude Code runs in, on macOS; elsewhere you get the line to type) with **all its output so far, then live**: the output is copied as it arrives to a private file (`run-pane-*.log` in `$TMPDIR`, removed with the run or when you leave) that the window tails. It is a view: typing there does not reach the process, and Ctrl+C there ends the viewing, not the run. With no run selected, the same as `/shell`. |
| Close pane | Closes the Run pane. Esc does the same. Runs keep going. |

Commands run through `sh -lc` (a login shell, so `/etc/profile` and `~/.profile` apply) in the folder the session is in. The Run pane scrolls as a whole (mouse wheel, or the keys while it has the focus), follows new output while it is scrolled to the bottom, and stays where you left it once you scroll up; scrolling back to the last line follows it again. With the pane focused, Tab and the arrow keys walk its buttons, and Esc closes it.

The list holds 12 runs at most; the oldest finished ones drop off first. Runs still going when the session ends are stopped the same way Stop does it.

### Commands that need a terminal

A command runs as a process of the plugin, with its output in the Run pane, unless it needs a terminal: an editor (`vi`, `nano`), a pager (`less`, `man`), a monitor (`top`, `htop`, `watch`), a session (`ssh`, `tmux`), a REPL (`python`, `node`, `psql` with no script), a container entered with `-it`, or `git commit` with no message and `git rebase -i`. It is told by the command's first words, in each part of a `&&`, `;` or pipe (`git log | less`), after `sudo`, `env` and assignments. Those commands get a terminal:

- in herdr, tmux or iTerm2, a pane beside Claude Code (below);
- anywhere else, a window of a hidden tmux server, with an **Attach** button next to the run in the Run pane (a terminal window on it, or the line to type);
- with neither, the command runs without a terminal and the Run pane says so.

The Run pane follows those runs too: what the command prints, and while an editor or pager holds the screen, that screen (the last 50 rows).

To change what counts, `hooks/run-pane.json` takes `"interactive": ["mytui"]` (first words that get a terminal) and `"panes": "all"` (every command gets one, as in 0.3).

#### In herdr, tmux and iTerm2

When Claude Code runs inside [herdr](https://herdr.dev) (`HERDR_ENV=1`), tmux (`$TMUX`) or iTerm2 (`TERM_PROGRAM=iTerm.app`), the plugin notices and uses it, with no setting. herdr is checked first, then tmux, then iTerm2 (a tmux inside iTerm2 is the tmux's to split).

**iTerm2** needs no tmux: the plugin splits iTerm's own panes with AppleScript, so the first time macOS may ask whether Claude Code may control iTerm (as for `/shell`). The new pane is split from the pane Claude Code runs in, never from whichever has the focus; it is read through iTerm's screen contents (scrollback included), and the shell is told to be at its prompt by the foreground process of the pane's terminal. A command with a control character in it is not typed (it would act as a key) and goes to the hidden tmux server below. `/shell` still opens a window there.

- `/rp <command>` (for a command that needs a terminal, or any command with `"panes": "all"`) types the command into the pane of the last run if nothing is running in it (none of this plugin's runs, no command of yours in front of the prompt, and no background job such as `while true; do ./x.sh; sleep 1; done &` behind it, since that prints into the pane; jobs are looked for with `pgrep`, and a shell with helper processes of its own, like some prompt themes, counts as busy). Otherwise, or for the first run, it splits a new terminal pane (the first on the right of Claude Code, the next ones below the last) and types it there. It then follows what the pane shows. Your focus stays where it was. The terminal pane is a real terminal: click into it to answer a prompt or use an editor. The Run pane opens as for any command, listing the run with what it prints, and `run_output` returns it to Claude as before.
- Stop types Ctrl+C into the terminal pane; if the command ignores it for 30 s, or Force kill is pressed, the pane is closed. A finished run's pane stays open, so you can read it and the next command can use it. Remove closes it unless another run's output is on it too. Restart types the command again, in the same pane if it is free. Closing a pane yourself ends its run as stopped.
- The command is typed into the pane exactly as you would type it, so the pane is your own shell with its history: prompt, command, result, and the earlier ones above. Your aliases and shell setup apply. The Run pane knows the command is over when the pane's shell is back at its prompt, and then marks the run `done` (○): a shell does not tell its exit code, so there is no `exit N` here. A command of several lines is not typed into a pane (it would run line by line); it runs as before.
- When you leave the session (`/exit`, Ctrl+C or Ctrl+D), every pane the plugin opened, for runs and for `/shell`, is closed at once, and what runs in them ends with them (Claude Code gives an exit about a second, so they are not asked to stop first). A `/clear` keeps them.
- If a pane cannot be made, the command runs as before, as a process of the plugin, so `/rp` never stops working because of the multiplexer.
- The output is read back about twice a second and holds the last 2000 lines.
- Anywhere else (or in iTerm2 when its pane cannot be made), if tmux is installed, the same happens in a hidden tmux server of the plugin's own (`tmux -L run-pane`, never shown): each command that needs a terminal is typed into a window of it, and the Run pane follows that. `vi`, `less` and `ssh` work there: press **Attach** on the run to open a window on the server (iTerm or Terminal on macOS; elsewhere the button tells you the line to type, `tmux -L run-pane attach -t run-pane`; Ctrl+B d leaves it). While such a command holds the screen, the Run pane shows that screen (the last 50 rows), and its output once it is over. The server ends with the session, not when you `exit` a shell in it (a keeper window holds it open; Ctrl+B d leaves it). Without tmux, commands run as processes of the plugin, which have no terminal.
- To turn this off, set `"multiplexer": false` in `hooks/run-pane.json` (see below).

### `/shell`

In herdr or tmux, `/shell` splits a terminal pane on the right of Claude Code in the session's folder and focuses it. Anywhere else on macOS it opens a new window with a shell already in the session's folder, titled with the folder's name, in the terminal Claude Code runs in (iTerm or Terminal.app; in any other terminal, iTerm if `/Applications/iTerm.app` exists and Terminal.app otherwise). An app may always control itself, so the usual case needs no permission; opening a window in the *other* terminal makes macOS ask whether this one may control it. If you say no, `/shell` (and Attach) answers with where to allow it, System Settings > Privacy & Security > Automation; anything else that goes wrong it says in one line.

Elsewhere `/shell` says so and does nothing. The folder (for the macOS window) is handed to AppleScript as an argument and quoted by AppleScript itself, never pasted into the script, so a name with quotes, spaces, backslashes, `$(...)` or a leading dash is just a name. A folder name that holds a control character (a newline, an escape) is refused, because typed into a terminal it would act as a key.

### `run_output`

A tool for Claude, not for you: `mcp__run-pane__run_output`. It returns the last lines of a run (60 by default, 500 at most) with its status. Give `run` as the run's number or a part of its command; with none, the newest run. Claude sees a run's output only when it calls this tool.

## Optional: `hooks/run-pane.json`

The mod needs no configuration. If you bundle it into your own tooling you can drop a `hooks/run-pane.json` next to `hooks/register.tsx` (a copy installed from this repository has none):

```json
{
  "suggestions": ["make dev", "docker compose up"],
  "openFor": ["acme"],
  "multiplexer": false
}
```

- `suggestions`: commands to suggest before the ones found in the folder.
- `interactive`: first words of commands that get a terminal, besides the ones the plugin knows (see Commands that need a terminal).
- `panes`: `"all"` gives every command a terminal, not only the ones that need it, as 0.3 did.
- `forceColor`: `true` starts every command with `FORCE_COLOR=1` and `CLICOLOR_FORCE=1`, so tools that colour only for a terminal colour in the pane. Off by default: colour changes the text other scripts read.
- `multiplexer`: `false` keeps `/rp` out of herdr and tmux panes and out of the hidden tmux server, so it runs commands as processes of the plugin even inside them. `/shell` keeps using them.
- `openFor`: words that make the pane open by itself, without taking the keyboard, when the folder's git remote (`origin`) or its path contains one of them (case does not matter; a linked worktree shares its repository's remote, so it counts). Anywhere else the pane waits for `/rp`.

Both are optional. A missing or unreadable file means the defaults.

## Development

The mod is a hooks module in TypeScript with no build step:

| Path | What is in it |
| --- | --- |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | The manifest, and the marketplace file that makes this repository installable. |
| `hooks/register.tsx` | The commands, the tool, the pane and the processes. |
| `hooks/run.ts` | Logic with no engine in it: the output log, colouring, suggestions, the process tree. |
| `hooks/shell.ts` | The AppleScript for `/shell` and the words it answers with. |
| `hooks/mux.ts` | Logic with no engine in it for herdr and tmux: telling which one it is, the pane commands, telling a pane's output from the command typed into it, and whether its shell is at the prompt. |
| `types/index.d.ts` | The pane's state, declared for the engine. |
| `tests/` | Tests: `run.test.ts`, `shell-script.test.ts` and `mux.test.ts` for the logic, `pane.test.tsx`, `shell.test.tsx` and `mux-pane.test.tsx` for the mod running against a stand-in engine. |

```
claude plugin validate .      # the manifest, the marketplace file and what the hooks module calls
claude plugin test .          # the tests, against the engine
claude --plugin-dir .         # try it in a session, reloading when a file is saved
```

The tests never open a terminal, run osascript or start herdr or tmux: `process.run` is answered by a stub.

To type-check, use a `tsconfig.json` like the one in the header of the engine's API types, which the engine writes to `.claude-plugin/types/` when it loads the mod from a folder (that folder is git-ignored):

```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```

then `tsc -p tsconfig.json` (TypeScript 5.4 or newer).

## License

MIT, see [LICENSE](LICENSE).
