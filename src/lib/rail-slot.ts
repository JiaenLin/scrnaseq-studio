import { createContext } from 'react'

/**
 * Where a view's own controls go: the element in the rail that App keeps for
 * them (docs/DESIGN.md, "The rail"). null until the rail is on the page, and
 * always null on the server, where a view's controls render in place.
 */
export const RailSlot = createContext<HTMLElement | null>(null)
