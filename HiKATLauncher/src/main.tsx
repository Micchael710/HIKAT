import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { LanguageProvider } from "./context/LanguageContext"
import "./index.css"

// Clean console logging for any uncaught errors
window.addEventListener("error", (event) => {
  console.error("[HiKAT Frontend Error]:", event.error || event.message)
})

window.addEventListener("unhandledrejection", (event) => {
  console.error("[HiKAT Unhandled Promise Rejection]:", event.reason)
})

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
)
