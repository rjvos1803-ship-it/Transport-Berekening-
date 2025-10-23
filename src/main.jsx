// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// ✅ Tailwind CSS import
import './index.css'

// ✅ Render de app
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
