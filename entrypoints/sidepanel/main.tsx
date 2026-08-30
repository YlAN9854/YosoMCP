import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'

if (import.meta.env.DEV) {
  void import('react-grab')
  void import('react-scan')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
