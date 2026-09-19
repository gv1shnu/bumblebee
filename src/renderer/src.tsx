import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/barlow-condensed/600.css'
import './style.css'
import './device-overrides.css'
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
