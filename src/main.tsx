import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ViewBoundary from './components/Boundary.tsx'

/**
 * The backstop, and only the backstop.
 *
 * The boundary that saves a session is the one App puts around the tab body:
 * it drops one view and keeps the open object, and with the object it keeps
 * every answer already computed and every pass still running, because both are
 * held in module-level WeakMaps keyed by it (compute.ts).
 *
 * This one catches what that one is below — a throw in App's own render, or in
 * the Landing screen before any object exists. It cannot promise anything
 * survived, because at this height nothing does: the tree that held the Source
 * has gone, and with it the only reference keying those maps. So it says that,
 * and offers the reload rather than pretending a Try again will find anything.
 * A nicer white page is all a root boundary can ever be, and it is worth exactly
 * the eleven lines it costs.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ViewBoundary
      what="studio"
      escape={{ label: 'Reload the studio', go: () => window.location.reload() }}
      note={<>
        This one got past the per-tab boundary, which means the failure is in the frame
        around the views rather than in one of them. Reloading is the way back, and it
        does mean opening the object again.
      </>}
    >
      <App />
    </ViewBoundary>
  </StrictMode>,
)
