# Changelog

## 0.4.0

The Run pane is where commands run, with their colours and links; a terminal is for the ones that need one.

- **Commands run in the Run pane.** Every command that does not need a terminal is a process of the plugin with its output in the pane, in herdr, tmux and iTerm2 too (0.3 typed every command into a pane). Commands that need a terminal (editors, pagers, monitors, `ssh`, REPLs with no script, `-it` containers, `git commit` with no message) get one: a pane beside Claude Code in herdr, tmux or iTerm2, else a window of a hidden tmux server (`tmux -L run-pane`, started with a keeper window so exiting a shell in it does not end the server, and ended with the session). The Run pane follows what they print, including the screen an editor or pager holds, and an **Attach** button sits next to the run in the list (a window in the terminal Claude Code runs in on macOS; elsewhere the line to type). With no terminal to give, the command runs without one and says so. In `hooks/run-pane.json`: `"interactive": ["mytui"]` adds first words, `"panes": "all"` gives every command a terminal as 0.3 did, `"multiplexer": false` keeps everything out of herdr, tmux and the hidden server.
- **iTerm2 without tmux.** In iTerm2, a command that needs a terminal is typed into a real iTerm pane split beside Claude Code (from the pane Claude Code runs in, not the focused one), with AppleScript. If the split fails, or the command holds a control character, the hidden tmux server takes it.
- **Colours.** The output keeps the colours and styles the command printed (16, 256 and true colour, bold, dim, italic, underline, inverse, strikethrough), carried across lines, with no other escape sequence in it (the part of a colour library that a log needs is in `hooks/ansi.ts`: the plugin has no build step). Lines the command did not style are still coloured by what they look like (banners, errors, warnings, notes). What Claude reads through `run_output` has no escape sequences. Commands are not asked to colour (`FORCE_COLOR=1` changes the text scripts read: `sandbox start ci` waits for `compiled successfully` in webpack's output before it prints its banner, and colour put escape codes inside the phrase), so a tool that colours only for a terminal prints plain text; `FORCE_COLOR=1` in the command, or `"forceColor": true` in `hooks/run-pane.json`, asks for colour where it is safe.
- **Links.** A URL in the output opens in the browser when pressed, and a path in it that exists (`src/app.ts:12:5`, `./x`, `~/y`, from the run's folder) opens with what the system opens it with. They are drawn underlined, and Tab walks them like the buttons. Which paths are files is found in the background, so drawing the output never waits on the file system.
- **Open in shell** (the old Shell button) opens the selected run. A run in a hidden terminal: the Attach. A process of the plugin, which is on pipes and has no terminal to attach to: a window with everything it printed so far, then what it prints on (copied as it arrives to a private file in `$TMPDIR`, which the window tails; removed with the run). It is a view: typing there does not reach the process. With no run selected it is `/shell`.
- **`/shell` and Attach open their window in the terminal Claude Code runs in** (iTerm or Terminal.app), not in iTerm whenever it is installed: run in Terminal.app with iTerm installed, they failed with `Not authorized to send Apple events to iTerm (-1743)`, because macOS lets an app control itself but asks before one controls another. When macOS does refuse, the message says where to allow it (System Settings > Privacy & Security > Automation).
- **A new look.** Buttons are rectangles of a light colour (red for Stop, lavender for Restart, Attach and Open in shell, green for tests, grey for the rest) with a deep shade of it for the text, drawn so that the engine's own swap under the pointer and the focus does not make them black, and the same colour 10% darker under the pointer. The suggestions are in one wrapping row after a dim `Try`, the words they share (`npm run`, `make`, `cargo`) said once, coloured by what they do, and one row high like the buttons at the bottom. A row of space follows the title, the command field and the suggestions, and sits between "Nothing running..." and the buttons. Attach has a space before it in the run row. The End button is gone: scrolling down to the last line follows the output again.
- **The Run pane's output scrolls on its own** (wheel or keys, stopping at the first and last line) while the commands and the row of buttons stay in place, and the buttons are one row at the end instead of the same row above and below the output (Top and the dim help line are gone). Docs say **Run pane** for the plugin's own pane and **terminal pane** for the split a command runs in.
- **Fixes in terminal panes.** A pane just made is waited on (until its shell has drawn its prompt, five seconds at most) before the command is typed, so the terminal's echo of the line is not taken for the command and the first run no longer shows `0 lines` and `done` at once. A finished run no longer ends with the first line of a two-line prompt, and rows that end in spaces (iTerm2 pads every row) read as the lines they are.

## 0.3.0

- Inside herdr or tmux, `/rp` runs each command in the last run's pane when nothing is running in it (shell at its prompt), else in a new pane beside Claude Code (below the last run's after the first); it types the command into the pane exactly as typed, so the pane keeps its history, and the Run pane follows the pane's output until the shell is at its prompt again, then marks the run done (a shell tells no exit code). `/rp <command>` leaves the Run pane shut there (`/rp` alone opens it) and answers with just `$ <command>`. If no pane can be made, the command runs as a process of the plugin as before. `"multiplexer": false` in `hooks/run-pane.json` turns it off.
- A pane whose shell has a background job (`cmd &`, a `while ... &` loop) is not reused for the next `/rp`: the job prints there, so the run gets a pane of its own.
- Leaving the session closes every multiplexer pane the plugin opened, for runs and for `/shell`; a `/clear` keeps them.
- `/shell` splits a focused pane in the session's folder in herdr or tmux. Outside them it is unchanged (a Terminal or iTerm window on macOS). The pane's button is now called Shell.

## 0.2.5

- The limited-view notice now says the buttons need Claude Code's flicker-free display mode, offers `/tui fullscreen` (switches in the session and saves the choice) next to `CLAUDE_CODE_NO_FLICKER=1 claude`, and links to https://code.claude.com/docs/en/fullscreen.
- README: the same, with the link.

## 0.2.4

- The notice for a pane above the prompt now says what is wrong: it is a limited view whose buttons may not respond, and the full pane (on the right, buttons working) needs the flicker-free display mode, `CLAUDE_CODE_NO_FLICKER=1 claude` (not a maximised window).
- README: "Turn on the flicker-free display mode" is now the first requirement.

## 0.2.3

- When the pane sits above the prompt, it shows the `CLAUDE_CODE_NO_FLICKER=1 claude` hint in bold red at its top, where it is hard to miss. The `/rp` reply keeps its plain-text hint (the transcript line cannot be coloured).

## 0.2.2

- The `/rp` hint for an inline pane now names the fix: start Claude Code with `CLAUDE_CODE_NO_FLICKER=1 claude` to dock the pane on the right.
- README: a note on why the pane may sit below the chat (fullscreen is off by default in some terminals) and how to turn it on.

## 0.2.1

- The pane asks for a 60 column dock when it sits beside a fullscreen transcript (the engine caps it at 45% of the terminal).
- `/rp` says to open Claude Code fullscreen when the pane is inline above the prompt, since only the fullscreen layout docks it beside the chat.

## 0.2.0

- New `/rp` command: `/rp <command>` runs a command in the pane, `/rp` opens it, `/rp close` closes it. It never reaches Claude and leaves nothing in the transcript.
- The `>` prompt prefix is removed, so a prompt that starts with `>` (a quote, say) is sent to Claude as typed.

## 0.1.4

- What a `> <command>` did is shown as a toast instead of a "Prompt dropped by a hook" line in the transcript.

## 0.1.3

- The prompt box is cleared again just after the engine puts the submitted `> <command>` back, so it is really empty.

## 0.1.2

- The prompt box is cleared after a `> <command>` runs, ready for the next one.

## 0.1.1

- `/dev` is removed; use the `>` prompt prefix. Typing `>` into an empty prompt now adds a space after it.

## 0.1.0

First release as a repository of its own: the mod, taken out of the project it grew in.

- `>` at the start of a prompt opens the Run pane; `> <command>` runs a command in it; `> close` closes it. Typing `>` into an empty prompt adds a space after it.
- The pane lists runs with their status and the last 2,000 lines of each one's output, coloured with the theme, and follows the bottom while it is scrolled there.
- Suggestions from `package.json` scripts, `Cargo.toml` and `Makefile` targets.
- Stop sends Ctrl+C to the whole process tree, then SIGTERM, then SIGKILL; Force kill skips the waiting. Restart, Clear, Remove, Top and End as well.
- The `run_output` tool lets Claude read the latest output of a run.
- `/shell` opens a new Terminal or iTerm window in the session's folder (macOS), done inside the mod with osascript; the folder is passed as an argument and never written into the script.
- The state, the tool (`mcp__run-pane__run_output`) and the pid marker carry the name run-pane.
- Optional `hooks/run-pane.json` (`suggestions`, `openFor`) for people who bundle the mod.
