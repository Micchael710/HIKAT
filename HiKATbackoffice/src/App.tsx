import React from "react"

import { HIKAT_APP_NAME, HIKAT_VERSION } from "@hikat/shared"

export function App() {
  return (
    <div style={{ textAlign: "center", padding: "2rem" }}>
      <h1>{HIKAT_APP_NAME} Backoffice</h1>
      <p style={{ color: "#8b949e" }}>
        Version {HIKAT_VERSION} — Foundation Shell
      </p>
      <p>Administration panel will be implemented in subsequent phases.</p>
    </div>
  )
}

export default App
