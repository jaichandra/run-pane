# run-pane

A Run pane for Claude Code. Start a dev server, a test watcher or any other command from a pane beside the chat, watch its output while you keep talking to Claude, stop it cleanly when you are done, and let Claude read what it printed.

- **`/rp`**: `/rp npm run dev` runs a command in the pane, a lone `/rp` opens it, `/rp close` closes it (runs keep going). It is a slash command, so it never reaches Claude and the prompt box clears by itself.
- **`/shell`** opens a terminal window with a shell in the session's folder (macOS).
- **`run_output`** is a tool Claude can call to read the latest output of a run, so "why did the server crash?" can be answered from what is on your screen.

## Install

At the prompt of a terminal session:

```
/plugin install run-pane --marketplace jaichandra/run-pane
```

From a shell:

```
claude plugin install run-pane --marketplace jaichandra/run-pane
```

Answer `y` to add the marketplace, then pick a scope (the user scope is the first). The mod is active in that session at once, and under the user scope in each session you start after it.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `jaichandra/run-pane`, then Add plugin.

The mod has been used in the terminal (CLI) session, so that is where it is known to work. There the pane docks beside the transcript in the fullscreen layout, or needs a terminal about 110 columns wide; `/rp` says so when it cannot place the pane.

`/rp` runs commands through `sh`, `ps` and `kill`, so it works on macOS and Linux and not on Windows. `/shell` is macOS only.

## Using it

### The pane

`/rp` opens the pane and gives it the keyboard. From top to bottom it shows:

- the folder's name, then a row of buttons (the same row is repeated under the output, so the buttons are in reach at either end);
- a command field, `$ `: type a command and press Enter;
- **Suggestions**, one button each (press to run): `npm run <script>` for every script in the folder's `package.json` (`dev`, `start`, `serve`, `watch`, `test`, `build` and `lint` first), `cargo run` and `cargo test` where there is a `Cargo.toml`, and `make <target>` for each plain target of a `Makefile`; ten at most;
- the runs, newest last: `●` running, `✓` exited with 0, `✗` exited with an error or could not start, `■` stopped; press one to see its output;
- the output of the selected run, the last 2,000 lines of it, coloured with your theme: URLs underlined, `# notes` dimmed, `▶` banners green, command lines (`npm`, `docker`, `make`, `git`, ...) and warnings in the warning colour, errors in the error colour, headings that end in a colon bold. A line a progress bar keeps redrawing shows its last state.

The buttons:

| Button | What it does |
| --- | --- |
| Stop (Ctrl+C) | Ends the selected run the way a terminal would: Ctrl+C (SIGINT) to its shell and everything below it, then SIGTERM after 30 s, then SIGKILL after another 10 s, if it has not ended. While it is stopping the button reads **Force kill**, which skips the waiting. |
| Restart | Runs a finished run's command again. |
| Clear | Empties the selected run's output. |
| Remove | Takes a finished run off the list. |
| Top, End | Scroll the pane to its first or last row. |
| Shell window | The same as `/shell`. |
| Close pane | Closes the pane. Esc does the same. Runs keep going. |

Commands run through `sh -lc` (a login shell, so `/etc/profile` and `~/.profile` apply) in the folder the session is in. The pane scrolls as a whole (mouse wheel, or the keys while it has the focus), follows new output while it is scrolled to the bottom, and stays where you left it once you scroll up; End brings the following back. With the pane focused, Tab and the arrow keys walk its buttons, and Esc closes it.

The list holds 12 runs at most; the oldest finished ones drop off first. Runs still going when the session ends are stopped the same way Stop does it.

### `/shell`

Opens a new window with a shell already in the session's folder, titled with the folder's name. On macOS it uses iTerm if `/Applications/iTerm.app` exists and Terminal.app otherwise. The first time, macOS may ask whether Claude Code may control that app; if you say no, or anything else goes wrong, `/shell` says why in one line.

It is macOS only. Elsewhere `/shell` says so and does nothing. The folder is handed to AppleScript as an argument and quoted by AppleScript itself, never pasted into the script, so a name with quotes, spaces, backslashes, `$(...)` or a leading dash is just a name. A folder name that holds a control character (a newline, an escape) is refused, because typed into a terminal it would act as a key.

### `run_output`

A tool for Claude, not for you: `mcp__run-pane__run_output`. It returns the last lines of a run (60 by default, 500 at most) with its status. Give `run` as the run's number or a part of its command; with none, the newest run. Claude sees a run's output only when it calls this tool.

## Optional: `hooks/run-pane.json`

The mod needs no configuration. If you bundle it into your own tooling you can drop a `hooks/run-pane.json` next to `hooks/register.tsx` (a copy installed from this repository has none):

```json
{
  "suggestions": ["make dev", "docker compose up"],
  "openFor": ["acme"]
}
```

- `suggestions`: commands to suggest before the ones found in the folder.
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
| `types/index.d.ts` | The pane's state, declared for the engine. |
| `tests/` | Tests: `run.test.ts` and `shell-script.test.ts` for the logic, `pane.test.tsx` and `shell.test.tsx` for the mod running against a stand-in engine. |

```
claude plugin validate .      # the manifest, the marketplace file and what the hooks module calls
claude plugin test .          # the tests, against the engine
claude --plugin-dir .         # try it in a session, reloading when a file is saved
```

The tests never open a terminal or run osascript: `process.run` is answered by a stub.

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
