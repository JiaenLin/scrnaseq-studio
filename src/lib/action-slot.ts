import { createContext } from 'react'

/**
 * Where the actions on a figure or a table go: the right end of the head line
 * over it (docs/DESIGN.md, "Save"). One place on every view, so nobody looks
 * for Save, and no view positions one by hand.
 *
 * `undefined` means there is no head line above (the action stays where it is
 * written, which is also what the server renders, so every label is still in
 * the markup the tests read); `null` is a head that is not on the page yet.
 */
export const ActionSlot = createContext<HTMLElement | null | undefined>(undefined)
