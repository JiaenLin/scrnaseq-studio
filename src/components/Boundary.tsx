// One bad render must cost the view, not the session.
//
// React's response to an uncaught error during render is to unmount the whole
// tree. In an app that draws a figure and forgets it, that is a flicker. Here it
// is the most expensive thing the studio can do to someone: FindAllMarkers on
// the 292 495-cell atlas is four minutes of worker time, a whole-transcriptome
// contrast is two, and neither is recoverable from anything on screen. The
// failure that prompted this file read one element past the end of a mean[] and
// called .toFixed on undefined; what the user saw was a blank document with no
// tab bar, and the only way out was a reload — and the reload is where the four
// minutes actually died, not the arithmetic.
//
// WHERE THIS BELONGS, AND WHY IT IS NOT (ONLY) THE ROOT.
//
// compute.ts keeps answers in a module-level WeakMap keyed by the Source, and
// the passes still running in another one beside it. Neither is React state.
// That single fact decides the placement:
//
//   below App — unmounting the broken view costs exactly the view. `src` is
//     still held by App, so it is still a live key: the pass in flight keeps
//     running with no listener, the answers already computed stay in the cache,
//     and walking back into the tab finds them in the first frame.
//
//   above App — `src` goes down with App. The last strong reference to the
//     WeakMap key is gone, every answer under it becomes garbage, and the pass
//     in flight is reporting to an object nobody can name any more. A boundary
//     there converts a white page into a nicer white page and still charges the
//     user four minutes.
//
// So the boundary that matters wraps the tab body, inside App, and the root gets
// a second one only as a backstop for the case this one cannot reach: a throw in
// App's own render, above the boundary it installs. The two say different things
// because different things survive, which is why the honest sentence is a prop
// here rather than a string baked into the component — a boundary that promised
// "nothing was lost" from the root would be lying.
//
// WHAT IT CANNOT CATCH, said out loud so nobody reads more into it than is
// there: errors thrown while the PARENT builds the child's props (App's own
// render), errors in event handlers, and errors inside a promise. The first is
// what the root backstop is for; the last is already handled — compute.ts
// rethrows a failed pass through a state updater precisely so that it lands in
// render, where this can see it.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Empty } from './Ui.tsx'

interface Props {
  /** What failed, in the words the user is already reading on the tab. */
  what: string
  /**
   * What survived. The boundary cannot work this out — it depends on where it
   * was installed — so whoever installs it says, and says only what is true.
   */
  note: ReactNode
  /** The one action that puts the user somewhere that works. */
  escape: { label: string; go: () => void }
  /**
   * Rebuild this view and try it again, if the owner can offer that.
   *
   * Clearing `error` on its own is weaker than it looks. React unmounted the
   * subtree when it caught, so the children DO remount with fresh state — but
   * from the element the parent last handed over, and a parent that has not
   * re-rendered hands over the same one. Whoever installs the boundary knows how
   * to make the view be derived again (in App: bump a counter that is part of
   * this boundary's key); when they say how, the button is offered. When they
   * cannot — the root, where retrying means remounting the whole studio and
   * silently dropping the open object — it is not offered at all, because a
   * button that quietly loses your work is worse than no button.
   */
  onRetry?: () => void
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ViewBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The card shows the message; the console keeps the stack and the component
    // path, because the person who has to fix this needs the frame, and a
    // message alone ("Cannot read properties of undefined") names no file.
    console.error(`[${this.props.what}] render failed`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const { what, note, escape, onRetry } = this.props
    return (
      <Empty title={`The ${what} view could not be drawn`}>
        {note}
        {/* Verbatim, not paraphrased. The people using this read stack traces,
            and a studio that hides the message is a studio they have to
            reproduce the bug in a devtools console to report. */}
        <pre className="mono mt-3 whitespace-pre-wrap text-left text-[11.5px]"
          style={{ color: 'var(--warn)', overflowWrap: 'anywhere' }}>{error.message}</pre>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {/* Worth offering rather than a dead end: the failure that prompted all
              of this was a single inconsistent frame — a dot grid sized for one
              gene list drawn against another — and a view rebuilt over settled
              state comes back. When the state is genuinely bad this returns the
              same message immediately, which is also an answer, and one the user
              can act on: the escape button is right next to it. */}
          {onRetry && (
            <button className="btn" onClick={() => { this.setState({ error: null }); onRetry() }}>
              Try again
            </button>
          )}
          <button className="btn btn-primary" onClick={escape.go}>{escape.label}</button>
        </div>
      </Empty>
    )
  }
}
