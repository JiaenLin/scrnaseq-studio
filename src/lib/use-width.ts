// The width a figure has been given, so it can be drawn AT that width.
//
// A figure drawn at a fixed size and then scaled into its column shrinks its
// type with it (the violins' tick labels were 7.6 px in a 1,280 px window), and
// one that refuses to shrink is cut by its column (the co-expression bars lost
// their right end and two ticks). Drawing at the measured width does neither:
// the marks take the room there is and the type stays the size it was set in.

import { useLayoutEffect, useRef, useState } from 'react'

/** A ref for the container and its content width in CSS px (0 before layout and on the server). */
export function useWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(el.clientWidth)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
