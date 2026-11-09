// Render the real components in Node, for tests that have to read what a page says.
//
// Every other test imports src/lib/*.ts through Node's own type-stripping, which
// cannot read JSX. What a reader copies into a paper is the Methods COMPONENT's
// output, though, not a library function's — so the assertion has to be made on
// that. Vite (already the build) loads the .tsx through the same transform the
// app ships with, and react-dom/server (already a dependency) turns the element
// into the markup a browser would be given. No DOM, no browser, about half a
// second.
//
// One entry module, loaded once, so every component shares one module graph.

import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runnerImport } from 'vite'

const ENTRY = fileURLToPath(new URL('./render-entry.ts', import.meta.url))

/** The components, as the app imports them. */
export async function loadComponents() {
  const { module } = await runnerImport(ENTRY, { configFile: false, logLevel: 'silent' })
  return module
}

/**
 * The markup one component renders for these props.
 *
 * React's server renderer warns about every SVG <title> whose children are
 * text and values mixed — the figures' tooltips — because it is the warning it
 * gives for a DOCUMENT title. It is about a page head this never renders, it is
 * the same on the base, and forty copies of it bury the one line that matters,
 * so that warning alone is dropped while the render runs.
 */
export function render(Component, props) {
  const error = console.error
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('React expects the `children` prop of <title> tags')) return
    error(...args)
  }
  try {
    return renderToStaticMarkup(createElement(Component, props))
  } finally {
    console.error = error
  }
}

/**
 * What a reader sees: the markup with the tags taken out and entities read.
 *
 * A tag becomes a space, so two blocks never run together into one word — a
 * stat's "3" and its label "clusters" are two words on the page. Tooltips are
 * dropped: they are not what the page says until somebody hovers.
 */
export const textOf = html => html
  .replace(/<title>[\s\S]*?<\/title>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
  .replace(/\s+/g, ' ')
