# Changelog

## Unreleased

- **Open in shell now shows the run's output.** For a process of the plugin it opens a terminal window with everything the run printed so far, then what it prints on (the output is copied as it arrives to a private file in `$TMPDIR`, and the window runs `tail -n +1 -f` on it; the file goes when the run is removed, restarted or the session ends). Before it opened an empty shell with the command typed in. It is a view, not an attach: the process is on pipes, so typing there does not reach it. A run in a hidden terminal still attaches.
- **Lighter buttons.** Dark text on light colours, which read on a dark or a light theme (they are no longer the theme's own colours), and each suggestion pill has a half-row cap, so rows of them sit half a row apart (a terminal cannot do less), with a row between the pills and the runs.
- **Buttons are pills.** Half-block ends (`▐ label ▌`) in the button's colour make each one read as rounded in any font. The suggestions say what they share once (a dim `npm run`, `make` or `cargo`, then `dev`, `start:ci`, `test`...), so each is short and ten fit in about two rows, and they are coloured by what they do: accent for running, serving and starting, green for testing, grey for the rest. Pressing one still runs the whole command.
- **Fixed: commands no longer start with `FORCE_COLOR=1`.** It was added for the colours, but it changes the text a command prints, and a script that reads its tools' output for a phrase stopped finding it: `sandbox start ci` waits for `compiled successfully` in webpack's output before it prints the URL banner, and with colour on the phrase had escape codes inside it, so the banner never came. Commands run as they would in a pipe again; `"forceColor": true` in `hooks/run-pane.json` (or `FORCE_COLOR=1` in the command) brings colour back where it is safe.
- Drawing the output no longer waits on the file system. Which of the paths in the output are files (to be links) is found in the background, once for each path and at most 40 at a time, and the pane is drawn again when one is; before, each drawing asked for every new path-like word first (docker prints one on most lines), which could hold the output back. A file system that does not answer now only means no file links.
- A vertical gap between the suggestion chips, so rows of them do not run together.
- **Buttons have a background** (their label on a theme colour with a space each side: red for Stop, the accent colour for Restart, Attach and Open in shell, grey for the rest), so they read as controls; Attach has a space before it in the run row (`vi package.json running [ Attach ]`). The End button is gone: scrolling down to the last line follows the output again.
- **Shell is now Open in shell**, and it opens the selected run. In a hidden terminal it is the Attach. For a process of the plugin, which has no terminal to attach to, it opens a window on a new hidden shell in the run's folder with its command typed at the prompt and not run (a second copy of a dev server could clash with the first); with no tmux, a plain shell window and the line to type. In a pane beside Claude Code it says so. With no run selected it is `/shell`, as before.
- **Suggestions are chips in one wrapping row** after a dim `Try`, not a line each: ten of them take one or two rows instead of eleven, and the output gets the rest.
- **The Run pane is where commands run.** Every command that does not need a terminal is a process of the plugin with its output in the Run pane, in herdr, tmux and iTerm2 too (0.3 typed every command into a pane). `"panes": "all"` in `hooks/run-pane.json` brings that back. Commands that need a terminal (editors, pagers, monitors, `ssh`, REPLs, `-it` containers, `git commit` with no message) get one as before (a pane beside Claude Code, or the hidden tmux window), the Run pane follows what they print, including the screen an editor or pager holds, and the **Attach** button now sits next to the run in the list. `"interactive": ["mytui"]` adds first words. With no terminal to give, the command runs without one and says so.
- **Colours.** The output keeps the colours and styles the command printed (16, 256 and true colour, bold, dim, italic, underline, inverse, strikethrough), carried across lines, with no other escape sequence in it; a tool that colours only for a terminal prints plain text, unless it is started with `FORCE_COLOR=1` or `"forceColor": true` is set in `hooks/run-pane.json`. Lines the command did not style are still coloured by what they look like (banners, errors, warnings, notes). What Claude reads through `run_output` has no escape sequences. There is no colour library to import (the plugin has no build step), so the part of one that a log needs is in `hooks/ansi.ts`.
- **Links.** A URL in the output opens in the browser when pressed, and a path in it that exists (`src/app.ts:12:5`, `./x`, `~/y`, from the run's folder) opens with what the system opens it with; they are drawn underlined, and Tab walks them like the buttons.
- `/shell` and Attach open their window in the terminal Claude Code runs in (`TERM_PROGRAM`: iTerm or Terminal.app), no longer in iTerm whenever it is installed. Run in Terminal.app with iTerm installed, they failed with `Not authorized to send Apple events to iTerm (-1743)`, because macOS lets an app control itself but asks before one controls another. In any other terminal the choice is as before. When macOS does refuse, the message now says where to allow it (System Settings > Privacy & Security > Automation).
- The hidden tmux server no longer ends when you exit the shell of the last run: its session starts with a keeper window (it says so, and sleeps), so the next `/rp` finds the server as it was. Attach checks the server is there first and says so when it is not, and the line it types is no longer `exec`ed, so an error stays in the window instead of the window closing on it.
- In iTerm2, `/rp` splits a real iTerm pane beside Claude Code (to the right for the first run, below it for the next ones) with AppleScript, types the command into it and follows what the pane shows, as it does in herdr and tmux. No tmux is needed, and `vi`, prompts and `ssh` work in place with no Attach. The pane is split from the one Claude Code runs in (`ITERM_SESSION_ID`), not the focused one. If the split fails, or the command holds a control character, the hidden tmux server takes the run. `/shell` still opens a window in iTerm2.
- A row of a pane that ends in spaces (iTerm2 pads every row) reads as the line it is, so the prompt that follows a finished command is found and taken off.
- Outside herdr and tmux, `/rp` now runs each command in a window of a hidden tmux server of its own (`tmux -L run-pane`), so a command that needs a terminal (`vi`, `less`, a prompt) has one. The Run pane follows the window as it does a multiplexer pane, and a running run has an **Attach** button: on macOS it opens an iTerm or Terminal window on the hidden server, elsewhere it toasts the line to type (`tmux -L run-pane attach -t run-pane`). Without tmux, or with `"multiplexer": false`, commands run as processes of the plugin as before. The hidden server ends with the session; a `/clear` keeps it. `/shell` is unchanged.
- A pane just made is now waited on (until its shell has drawn its prompt, five seconds at most) before the command is typed into it. Typed earlier, the terminal's own echo of the line was taken for the command, and the first run showed `0 lines` and `done` at once.
- The Run pane no longer scrolls as a whole: its output scrolls on its own (wheel or keys, stopping at the first and last line) while the commands and the row of buttons stay in place. End jumps back to the newest line.
- The Run pane has one row of buttons, at its end, instead of the same row above and below the output; Top and the dim help line under the first row are gone (Stop's wait is in the README). Docs now say **Run pane** for the plugin's own pane and **terminal pane** for the herdr or tmux split a command runs in.
- A finished run in a pane no longer ends with the first line of a two-line prompt (an info line above the `$`): the whole prompt is taken off, not just its last line.

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
