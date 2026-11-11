// The theme the reader's system is in, as something a painter can depend on.
//
// A canvas is painted once from the tokens it reads, so a canvas has to be told
// when the tokens change. Cells and the feature plots read the theme when they
// mounted and never again: switching the system from light to dark with Cells
// open left both canvases white, in light-theme paint, on the dark stage.

import { useSyncExternalStore } from 'react'

const query = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null)

function subscribe(onChange: () => void): () => void {
  const m = query()
  m?.addEventListener('change', onChange)
  return () => m?.removeEventListener('change', onChange)
}

/** True while the system theme is dark. A painter lists it among its inputs. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, () => !!query()?.matches, () => false)
}
