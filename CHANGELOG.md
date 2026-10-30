# Changelog

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
