// What a command's output says with escape sequences and with plain text, with no engine in it: the colours and
// styles of SGR sequences (`ESC [ 31 m`) as spans to draw, and the URLs and files in a line as links.
//
// The mod is a hooks module with no build step, so there is no colour library to import: this is the part of
// one that a log needs. It reads what terminals read (16, 256 and true colour, bold, dim, italic, underline,
// inverse, strikethrough) and nothing else: cursor moves, titles and the like are dropped by the log.

export type Style = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strike?: boolean
}

export type Span = { text: string } & Style

// The names a terminal's own palette answers to, so the colours follow the person's theme: 0-7, then 8-15.
const NORMAL = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const
const BRIGHT = ['gray', 'redBright', 'greenBright', 'yellowBright', 'blueBright', 'magentaBright', 'cyanBright', 'whiteBright'] as const

const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`

/** The colour of entry `n` of the 256-colour palette: a name for the 16 of the terminal's own, hex for the rest. */
function palette(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined
  if (n < 8) return NORMAL[n]
  if (n < 16) return BRIGHT[n - 8]
  if (n >= 232) return hex(8 + (n - 232) * 10, 8 + (n - 232) * 10, 8 + (n - 232) * 10)
  const at = n - 16
  const level = (step: number): number => (step === 0 ? 0 : 55 + step * 40)
  return hex(level(Math.floor(at / 36)), level(Math.floor(at / 6) % 6), level(at % 6))
}

/** The style after one SGR sequence's parameters (`1;31`) applied to `from`. */
export function applySgr(from: Style, params: string): Style {
  const style: Style = { ...from }
  const codes = params === '' ? [0] : params.split(/[;:]/).map(part => (part === '' ? 0 : Number(part)))
  for (let at = 0; at < codes.length; at++) {
    const code = codes[at] as number
    if (!Number.isInteger(code)) continue
    if (code === 0) {
      for (const key of Object.keys(style)) delete style[key as keyof Style]
    } else if (code === 1) style.bold = true
    else if (code === 2) style.dim = true
    else if (code === 3) style.italic = true
    else if (code === 4) style.underline = true
    else if (code === 7) style.inverse = true
    else if (code === 9) style.strike = true
    else if (code === 22) {
      delete style.bold
      delete style.dim
    } else if (code === 23) delete style.italic
    else if (code === 24) delete style.underline
    else if (code === 27) delete style.inverse
    else if (code === 29) delete style.strike
    else if (code >= 30 && code <= 37) style.fg = NORMAL[code - 30] as string
    else if (code >= 90 && code <= 97) style.fg = BRIGHT[code - 90] as string
    else if (code >= 40 && code <= 47) style.bg = NORMAL[code - 40] as string
    else if (code >= 100 && code <= 107) style.bg = BRIGHT[code - 100] as string
    else if (code === 39) delete style.fg
    else if (code === 49) delete style.bg
    else if (code === 38 || code === 48) {
      // 38;5;n (256 colours) or 38;2;r;g;b (true colour); a form that is cut short ends the sequence.
      const mode = codes[at + 1]
      let color: string | undefined
      if (mode === 5) {
        color = palette(codes[at + 2] as number)
        at += 2
      } else if (mode === 2) {
        const [r, g, b] = [codes[at + 2], codes[at + 3], codes[at + 4]]
        if (r !== undefined && g !== undefined && b !== undefined && [r, g, b].every(Number.isInteger)) color = hex(r, g, b)
        at += 4
      } else break
      if (color === undefined) continue
      if (code === 38) style.fg = color
      else style.bg = color
    }
  }
  return style
}

const SGR = /\u001b\[([0-9;:]*)m/g

/** Whether the text holds an SGR sequence. */
export const hasSgr = (text: string): boolean => /\u001b\[[0-9;:]*m/.test(text)

/** The style a text ends in, given the one it starts in. */
export function styleAfter(text: string, from: Style = {}): Style {
  let style = from
  for (const match of text.matchAll(SGR)) style = applySgr(style, match[1] as string)
  return style
}

/** The spans of a line that starts in `from`: its text in pieces, each with the style it is drawn in. Text
 * with no style is a span of its own, so a line with no sequence is one span. */
export function spansOf(line: string, from: Style = {}): Span[] {
  const spans: Span[] = []
  let style = from
  let at = 0
  const add = (text: string): void => {
    if (text !== '') spans.push({ text, ...style })
  }
  for (const match of line.matchAll(SGR)) {
    add(line.slice(at, match.index))
    style = applySgr(style, match[1] as string)
    at = (match.index ?? 0) + match[0].length
  }
  add(line.slice(at))
  return spans
}

/** Whether a span has any style at all. */
export const isStyled = (span: Span): boolean => Object.keys(span).some(key => key !== 'text')

export type Link = { kind: 'url' | 'file'; target: string; line?: number }

export type Piece = { text: string; link?: Link }

// A URL does not end in the punctuation of the sentence around it, nor in the frame a box-drawing banner has.
const URL = /https?:\/\/[^\s│┃║<>"'`]+/g
const URL_TAIL = /[.,;:!?)\]}]+$/
// A path with a slash in it: absolute, `~/`, `./`, `../`, or `dir/file` (a name alone is not told from a word),
// with an optional `:line` and `:column`. Only the files that exist become links, the caller says which.
const FILE = /(?<![\w.\/:~@-])(?:~\/|\.{1,2}\/|\/)?[\w@.+-]+(?:\/[\w@.+-]+)+(?::(\d+)(?::\d+)?)?/g
const FILE_TAIL = /[.,;)\]}]+$/

/** The URLs of a text, then its file-like paths, as pieces in order: `files` says which of the paths to take as
 * links (it is asked of each path as written, without its `:line`). */
export function findLinks(text: string, isFile: (path: string) => boolean): Piece[] {
  const pieces: Piece[] = []
  let at = 0
  const urls: { start: number; end: number; url: string }[] = []
  for (const match of text.matchAll(URL)) {
    const url = match[0].replace(URL_TAIL, '')
    if (url.length > 'https://'.length) urls.push({ start: match.index ?? 0, end: (match.index ?? 0) + url.length, url })
  }
  const plain = (from: number, to: number): void => {
    const part = text.slice(from, to)
    let inner = 0
    for (const match of part.matchAll(FILE)) {
      const written = match[0].replace(FILE_TAIL, '')
      const path = written.replace(/:\d+(?::\d+)?$/, '')
      if (!path.includes('/') || !isFile(path)) continue
      const start = match.index ?? 0
      if (start > inner) pieces.push({ text: part.slice(inner, start) })
      pieces.push({ text: written, link: { kind: 'file', target: path, ...(match[1] ? { line: Number(match[1]) } : {}) } })
      inner = start + written.length
    }
    if (inner < part.length) pieces.push({ text: part.slice(inner) })
  }
  for (const found of urls) {
    plain(at, found.start)
    pieces.push({ text: found.url, link: { kind: 'url', target: found.url } })
    at = found.end
  }
  plain(at, text.length)
  return pieces.filter(piece => piece.text !== '')
}

/** The file-like paths of a text, as written, for the caller to look up before it asks `findLinks`. */
export function candidatePaths(text: string): string[] {
  const found: string[] = []
  for (const match of text.replace(URL, ' ').matchAll(FILE)) {
    const path = match[0].replace(FILE_TAIL, '').replace(/:\d+(?::\d+)?$/, '')
    if (path.includes('/') && !found.includes(path)) found.push(path)
  }
  return found
}
