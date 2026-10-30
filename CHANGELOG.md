# Changelog

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
