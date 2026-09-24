import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// Diffs and files are highlighted in workers: on the main thread, each file diff that loaded froze scrolling.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsWorker() }}
      highlighterOptions={{ preferredHighlighter: 'shiki-js' }}
    >
      <App />
    </WorkerPoolContextProvider>
  </StrictMode>,
)
