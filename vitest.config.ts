import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    poolOptions: {
      forks: {
        execArgv: ["--experimental-sqlite"],
      },
      threads: {
        execArgv: ["--experimental-sqlite"],
      },
    },
  },
})
