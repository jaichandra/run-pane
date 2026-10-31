import { expect, test } from 'claude-code/testing'

import { applySgr, candidatePaths, findLinks, hasSgr, spansOf, styleAfter } from '../hooks/ansi'

const ESC = '\u001b'

test('the 16 colours are the terminal palette names, bold and the other styles are flags, and a reset clears all', () => {
  expect(applySgr({}, '31')).toEqual({ fg: 'red' })
  expect(applySgr({}, '1;32')).toEqual({ bold: true, fg: 'green' })
  expect(applySgr({}, '90')).toEqual({ fg: 'gray' })
  expect(applySgr({}, '93;44')).toEqual({ fg: 'yellowBright', bg: 'blue' })
  expect(applySgr({}, '2;3;4;7;9')).toEqual({ dim: true, italic: true, underline: true, inverse: true, strike: true })
  expect(applySgr({ fg: 'red', bold: true, underline: true }, '0')).toEqual({})
  expect(applySgr({ fg: 'red', bold: true, underline: true }, '')).toEqual({})
  // Each off code turns off its own.
  expect(applySgr({ fg: 'red', bg: 'blue', bold: true, dim: true }, '22;39;49')).toEqual({})
  expect(applySgr({ italic: true, underline: true, inverse: true, strike: true }, '23;24;27;29')).toEqual({})
})

test('256 colours and true colour: the first 16 are palette names, the rest hex', () => {
  expect(applySgr({}, '38;5;1')).toEqual({ fg: 'red' })
  expect(applySgr({}, '38;5;12')).toEqual({ fg: 'blueBright' })
  expect(applySgr({}, '38;5;196')).toEqual({ fg: '#ff0000' })
  expect(applySgr({}, '48;5;21')).toEqual({ bg: '#0000ff' })
  expect(applySgr({}, '38;5;244')).toEqual({ fg: '#808080' })
  expect(applySgr({}, '38;2;18;52;86')).toEqual({ fg: '#123456' })
  expect(applySgr({}, '48;2;255;0;128;1')).toEqual({ bg: '#ff0080', bold: true })
  // A form that is cut short, or out of range, sets nothing and breaks nothing.
  expect(applySgr({ bold: true }, '38;5')).toEqual({ bold: true })
  expect(applySgr({}, '38;5;999')).toEqual({})
  expect(applySgr({}, '38;2;1;2')).toEqual({})
  expect(applySgr({}, 'x;31')).toEqual({ fg: 'red' })
})

test('a line becomes spans, each with the style it is drawn in', () => {
  const line = `plain ${ESC}[31mred${ESC}[1m bold red${ESC}[0m after`
  expect(spansOf(line)).toEqual([
    { text: 'plain ' },
    { text: 'red', fg: 'red' },
    { text: ' bold red', fg: 'red', bold: true },
    { text: ' after' },
  ])
  expect(spansOf('nothing here')).toEqual([{ text: 'nothing here' }])
  expect(spansOf('')).toEqual([])
  expect(hasSgr(line)).toBe(true)
  expect(hasSgr('a [31m b')).toBe(false)
})

test('a style carries over a line end: the next line starts in it', () => {
  const first = `${ESC}[33mwarn`
  expect(styleAfter(first)).toEqual({ fg: 'yellow' })
  expect(spansOf('still yellow', styleAfter(first))).toEqual([{ text: 'still yellow', fg: 'yellow' }])
  expect(styleAfter(`${ESC}[0m`, { fg: 'red' })).toEqual({})
})

test('URLs are links without the punctuation of the sentence around them, and a bare scheme is not one', () => {
  const links = (text: string) => findLinks(text, () => false).filter(piece => piece.link).map(piece => piece.link?.target)
  expect(links('see https://example.com/a?b=1 for more')).toEqual(['https://example.com/a?b=1'])
  expect(links('(https://example.com/x).')).toEqual(['https://example.com/x'])
  expect(links('open http://localhost:3000, then')).toEqual(['http://localhost:3000'])
  expect(links('│ https://example.com/framed │')).toEqual(['https://example.com/framed'])
  expect(links('https:// alone')).toEqual([])
  expect(links('two http://a.dev/x and https://b.dev/y')).toEqual(['http://a.dev/x', 'https://b.dev/y'])
  // The text around them is kept, in order.
  expect(findLinks('a https://x.dev/y b', () => false).map(piece => piece.text)).toEqual(['a ', 'https://x.dev/y', ' b'])
})

test('files are links only where they exist, with their line number, and never inside a URL', () => {
  const exists = (path: string) => ['src/app.ts', '/etc/hosts', './run.sh', '~/notes/a.md', '../up/b.txt'].includes(path)
  const found = (text: string) => findLinks(text, exists).filter(piece => piece.link).map(piece => piece.link)
  expect(found('error in src/app.ts:12:5: bad')).toEqual([{ kind: 'file', target: 'src/app.ts', line: 12 }])
  expect(found('see /etc/hosts.')).toEqual([{ kind: 'file', target: '/etc/hosts' }])
  expect(found('run ./run.sh now')).toEqual([{ kind: 'file', target: './run.sh' }])
  expect(found('in ~/notes/a.md and ../up/b.txt')).toEqual([{ kind: 'file', target: '~/notes/a.md' }, { kind: 'file', target: '../up/b.txt' }])
  // Not files that exist, not words with a slash, not the path of a URL.
  expect(found('src/missing.ts and and/or')).toEqual([])
  expect(found('https://example.com/src/app.ts')).toEqual([{ kind: 'url', target: 'https://example.com/src/app.ts' }])
  expect(findLinks('error in src/app.ts:12 x', exists).map(piece => piece.text)).toEqual(['error in ', 'src/app.ts:12', ' x'])
})

test('the paths to look up are the ones with a slash, as written, once each, with no URL among them', () => {
  expect(candidatePaths('a src/app.ts:3:1 b src/app.ts and /etc/hosts. https://x.dev/not/this')).toEqual(['src/app.ts', '/etc/hosts'])
  expect(candidatePaths('no paths, just words and 3/4')).toEqual(['3/4'])
  expect(candidatePaths('')).toEqual([])
})
