import React, { useState, useEffect, useRef } from "react"
import type { ThemeMode, ConsoleLogEntry, ServerStatus } from "../../types"
import { consoleService } from "../../services/consoleService"
import { getThemeTokens } from "../../theme/tokens"
import {
  IconSend,
  IconArrowDown,
  IconTrash,
  IconSpinner,
  IconTerminal,
} from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface ServerConsoleViewProps {
  serverStatus: ServerStatus
  theme: ThemeMode
}

export default function ServerConsoleView({
  serverStatus,
  theme,
}: ServerConsoleViewProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [logs, setLogs] = useState<ConsoleLogEntry[]>(() =>
    consoleService.getRecentLogs(200),
  )
  const [command, setCommand] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<"success" | "error">("success")

  const terminalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isDisconnected = serverStatus === "DISCONNECTED"
  const isServerOffline = serverStatus === "OFFLINE" || isDisconnected

  // Reference-counted connection to console WebSocket service
  useEffect(() => {
    if (isDisconnected) return

    const release = consoleService.retain()

    const unsubscribeLogs = consoleService.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-499), entry]) // Retain max 500 lines
    })

    return () => {
      unsubscribeLogs()
      release()
    }
  }, [isDisconnected])

  // Auto-scroll logic
  useEffect(() => {
    if (!isScrolledUp && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [logs, isScrolledUp])

  const handleScroll = () => {
    if (!terminalRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current
    const atBottom = scrollHeight - (scrollTop + clientHeight) < 40
    setIsScrolledUp(!atBottom)
  }

  const scrollToBottom = () => {
    if (terminalRef.current) {
      if (typeof terminalRef.current.scrollTo === "function") {
        terminalRef.current.scrollTo({
          top: terminalRef.current.scrollHeight,
          behavior: "smooth",
        })
      } else {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight
      }
      setIsScrolledUp(false)
    }
  }

  const handleSendCommand = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = command.trim()
    if (!trimmed || isSending || isServerOffline) return

    setIsSending(true)
    try {
      await consoleService.sendCommand(trimmed)
      // Add local echo log entry for immediate responsiveness
      const echoEntry: ConsoleLogEntry = {
        id: `${Date.now()}-echo`,
        line: `> ${trimmed}`,
        timestamp: new Date().toISOString(),
        type: "info",
      }
      setLogs((prev) => [...prev, echoEntry])
      setHistory((prev) => [...prev, trimmed])
      setHistoryIndex(-1)
      setCommand("")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al enviar el comando."
      setToastMessage(msg)
      setToastType("error")
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault()
      if (history.length === 0) return
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      setCommand(history[nextIndex])
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      if (historyIndex === -1) return
      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(-1)
        setCommand("")
      } else {
        setHistoryIndex(nextIndex)
        setCommand(history[nextIndex])
      }
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 270px)",
        minHeight: "520px",
        gap: 12,
        position: "relative",
      }}
    >
      {/* Toast Notification */}
      <LiveToast
        message={toastMessage}
        type={toastType}
        theme={theme}
        onClose={() => setToastMessage(null)}
      />

      {/* Terminal Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 4px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: tokens.textPrimary,
            fontSize: "0.95rem",
            fontWeight: 700,
          }}
        >
          <IconTerminal size={18} />
          <span>Consola de Minecraft</span>
        </div>

        <button
          type="button"
          onClick={() => setLogs([])}
          title="Limpiar registro de consola"
          className="launcher-btn-secondary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "12px",
            padding: "6px 12px",
          }}
        >
          <IconTrash size={14} />
          <span>Limpiar vista</span>
        </button>
      </div>

      {/* Terminal Output Area */}
      <div
        style={{
          flex: 1,
          borderRadius: 16,
          background: isDark ? "#0b1116" : "#0f172a",
          border: `1px solid ${isDark ? "rgba(62, 196, 192, 0.2)" : "rgba(0, 0, 0, 0.2)"}`,
          boxShadow: tokens.cardShadow,
          padding: "16px 20px",
          overflowY: "auto",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
          fontSize: "0.875rem",
          lineHeight: 1.6,
          color: "#e2e8f0",
          position: "relative",
          userSelect: "text",
        }}
        className="custom-scroll"
        ref={terminalRef}
        onScroll={handleScroll}
      >
        {logs.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255, 255, 255, 0.35)",
              gap: 8,
              textAlign: "center",
              userSelect: "none",
            }}
          >
            <IconTerminal size={32} />
            <div>
              {isDisconnected
                ? "Consola no disponible mientras el servidor esté desconectado."
                : isServerOffline
                ? "El servidor se encuentra apagado."
                : "Esperando output del servidor..."}
            </div>
          </div>
        ) : (
          logs.map((log) => {
            const isEcho = log.line.startsWith(">")
            return (
              <div
                key={log.id}
                style={{
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                  color: isEcho
                    ? "#3ec4c0"
                    : log.type === "error"
                    ? "#f87171"
                    : "#cbd5e1",
                  fontWeight: isEcho ? 600 : 400,
                  marginBottom: 2,
                }}
              >
                {log.line}
              </div>
            )
          })
        )}

        {/* Scroll to bottom button */}
        {isScrolledUp && (
          <button
            type="button"
            onClick={scrollToBottom}
            style={{
              position: "sticky",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 999,
              background: "rgba(62, 196, 192, 0.9)",
              color: "#0a0e14",
              fontWeight: 700,
              fontSize: "0.775rem",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(62, 196, 192, 0.4)",
              zIndex: 10,
            }}
          >
            <IconArrowDown size={14} />
            <span>Bajar al final</span>
          </button>
        )}
      </div>

      {/* Command Input Bar */}
      <form
        onSubmit={handleSendCommand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 16,
              color: "#3ec4c0",
              fontWeight: 700,
              fontFamily: "monospace",
              fontSize: "1.1rem",
              pointerEvents: "none",
            }}
          >
            &gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending || isServerOffline}
            placeholder={
              isDisconnected
                ? "Consola no disponible mientras el servidor esté desconectado."
                : isServerOffline
                ? "El servidor está apagado. Inicia el servidor para enviar comandos."
                : "Escribe un comando... (ej. say Hola HiKAT)"
            }
            className="launcher-input"
            style={{
              width: "100%",
              padding: "12px 16px 12px 34px",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              boxSizing: "border-box",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={!command.trim() || isSending || isServerOffline}
          className="launcher-btn-primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "12px 22px",
            fontSize: "14px",
          }}
        >
          {isSending ? <IconSpinner size={18} /> : <IconSend size={18} />}
          <span>Enviar</span>
        </button>
      </form>
    </div>
  )
}
