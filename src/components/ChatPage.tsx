import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDownCircle, Bot, LogOut, Menu, Moon, PanelLeftClose, PanelRightClose, Plus, Sun, X } from "lucide-react"
import { cn } from "@/lib/utils"
import SessionSidebar from "./SessionSidebar"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"
import type { ChatInteraction, ChatMessage, Session, StreamEvent } from "../api/client"
import {
  sendMessage,
  sendCommand,
  fetchSessions,
  fetchMessages,
  deleteSession as apiDeleteSession,
  performAction,
  logout,
  getStoredUser,
  fetchModelInfo,
  setModel,
  renameSession,
  togglePinSession,
  toggleArchiveSession,
  fetchSessionBySlug,
} from "../api/client"
import type { ModelInfo, ModelProvider } from "../api/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import ArtifactRenderer from "./ArtifactRenderer"

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function upsertInteraction(
  interactions: ChatInteraction[],
  next: ChatInteraction,
): ChatInteraction[] {
  const index = interactions.findIndex((interaction) => interaction.id === next.id)
  if (index === -1) return [...interactions, next]
  return interactions.map((interaction, i) => (i === index ? next : interaction))
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("webchat_theme") === "dark")

  // Model state
  const [currentModel, setCurrentModel] = useState("")
  const [currentProvider, setCurrentProvider] = useState("")
  const [currentProviderLabel, setCurrentProviderLabel] = useState("")
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [modelChanging, setModelChanging] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)

  const [messagesBySession] = useState<Map<string, ChatMessage[]>>(
    () => new Map(),
  )
  const [, setRenderKey] = useState(0)

  const activeMessages = activeSessionId
    ? messagesBySession.get(activeSessionId) || []
    : []

  const streamingContentRef = useRef("")
  const streamingThinkingRef = useRef("")
  const streamingInteractionsRef = useRef<ChatInteraction[]>([])
  const streamingMessageIdRef = useRef("")
  const [streamingDisplay, setStreamingDisplay] = useState("")
  const [streamingThinking, setStreamingThinking] = useState("")
  const [streamingInteractions, setStreamingInteractions] = useState<ChatInteraction[]>([])
  const streamingToolCallsRef = useRef<ChatInteraction[]>([])
  const [streamingToolCalls, setStreamingToolCalls] = useState<ChatInteraction[]>([])
  // Streaming blocks: chronologically ordered segments of reasoning text + tool calls
  const streamingBlocksRef = useRef<any[]>([])
  const [streamingBlocks, setStreamingBlocks] = useState<any[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const isStreamingRef = useRef(false)
  // Keep the ref in sync with the React state for re-render-triggering checks
  const updateStreamingState = useCallback((val: boolean) => {
    console.log("[STREAMSTATE] updateStreamingState:", val, "| loading:", loading, "| textarea value length:", input.length)
    isStreamingRef.current = val
    setIsStreaming(val)
  }, [loading, input.length])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const isNearBottomRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const contentVersionRef = useRef(0)
  const [sidebarArtifact, setSidebarArtifact] = useState<{ code: string; language: string } | null>(null)

  const user = getStoredUser()

  // Scroll to bottom when messages load or session switches.
  // Uses direct scrollTop assignment to bypass CSS `scroll-behavior: smooth`
  // so the initial scroll is instant, not animated from the top of the page.
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (activeSessionId && activeMessages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      // Use useLayoutEffect equiv: schedule before paint. Double rAF to
      // ensure layout is settled. Set scrollTop directly — this bypasses
      // CSS scroll-behavior: smooth entirely.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = scrollContainerRef.current
          if (container) {
            container.scrollTop = container.scrollHeight - container.clientHeight
          }
        })
      })
    }
  }, [activeSessionId, activeMessages.length])

  // Reset scroll flag when switching to a different session
  useEffect(() => {
    initialScrollDoneRef.current = false
  }, [activeSessionId])

  const forceUpdate = useCallback(() => {
    setRenderKey((k) => k + 1)
  }, [])

  useEffect(() => {
    // Load sessions immediately — don't block on model info
    loadSessions()
  }, [])

  // On mount, check URL hash for a conversation slug and navigate to it
  useEffect(() => {
    const hash = window.location.hash.slice(1) // remove '#'
    if (!hash) return
    // Try slug lookup first
    const slugMatch = hash.match(/^slug=(.+)$/)
    if (slugMatch) {
      const slug = slugMatch[1]
      fetchSessionBySlug(slug).then((session) => {
        if (session) {
          handleSelectSession(session.session_id)
        }
      })
      return
    }
    // Fallback: session fragment from URL
    const sessionMatch = hash.match(/^session=(.+)$/)
    if (sessionMatch) {
      const frag = sessionMatch[1]
      // Try to find a matching session by the fragment prefix
      fetchSessions().then((sessions) => {
        const found = sessions.find((s) => s.session_id.startsWith(frag))
        if (found) {
          setSessions(sessions)
          handleSelectSession(found.session_id)
        }
      })
    }
  }, [])

  useEffect(() => {
    // Load model info in a separate effect so it doesn't delay chat rendering
    loadModelInfo()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("webchat_theme", darkMode ? "dark" : "light")
  }, [darkMode])

  // Scroll event listener: tracks whether the user is near the bottom
  // of the chat. Updates `isNearBottomRef` synchronously on every scroll
  // event — more responsive than IntersectionObserver for rapid content
  // expansion (e.g. reasoning box opening). Tolerates up to 8px of
  // bottom-scroll distance as "at bottom".
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handler = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      isNearBottomRef.current = atBottom
      setIsNearBottom(atBottom)
      if (atBottom) setShowScrollButton(false)
    }
    el.addEventListener("scroll", handler, { passive: true })
    return () => el.removeEventListener("scroll", handler)
  }, [activeSessionId])

  // Auto-scroll to bottom when new content arrives.
  // Reads isNearBottomRef.current (synchronous ref, no stale closure)
  // and either scrolls the spacer into view or reveals the scroll button.
  useEffect(() => {
    contentVersionRef.current += 1

    const isNear = isNearBottomRef.current
    if (isNear) {
      const spacer = messagesEndRef.current
      if (spacer) {
        spacer.scrollIntoView({ behavior: "auto", block: "end" })
      }
      setShowScrollButton(false)
    } else {
      setShowScrollButton(true)
    }
  }, [streamingDisplay, streamingThinking, activeMessages.length, streamingBlocks])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    isNearBottomRef.current = true
    setIsNearBottom(true)
    setShowScrollButton(false)
  }

  const loadSessions = async () => {
    try {
      const s = await fetchSessions()
      setSessions(s)
    } catch (err) {
      console.error("Failed to load sessions:", err)
    }
  }

  const loadMessages = async (sessionId: string) => {
    try {
      const messages = await fetchMessages(sessionId)
      messagesBySession.set(sessionId, messages)
      forceUpdate()
    } catch (err) {
      console.error("Failed to load messages:", err)
      setError("Failed to load conversation messages")
    }
  }

  const loadModelInfo = async (sessionId?: string) => {
    try {
      setModelLoading(true)
      console.log("[ModelSelector] Loading model info" + (sessionId ? ` for session ${sessionId.slice(0, 16)}...` : ""))
      const info = await fetchModelInfo(sessionId)
      console.log("[ModelSelector] Received:", info.current_model, "on", info.current_provider_label)
      setCurrentModel(info.current_model)
      setCurrentProvider(info.current_provider)
      setCurrentProviderLabel(info.current_provider_label)
      setProviders(info.providers)
    } catch (err) {
      console.error("[ModelSelector] Failed to load model info:", err)
    } finally {
      setModelLoading(false)
    }
  }

  const handleSelectSession = (sessionId: string) => {
    if (isStreamingRef.current) return
    setActiveSessionId(sessionId)
    setError(null)
    if (!messagesBySession.has(sessionId)) {
      loadMessages(sessionId)
    }
    // Update URL hash with session slug
    const session = sessions.find((s) => s.session_id === sessionId)
    if (session?.slug) {
      window.history.replaceState(null, "", `#slug=${session.slug}`)
    } else {
      // Fallback: use a fragment from the session ID so the URL still reflects the active conversation
      window.history.replaceState(null, "", `#session=${sessionId.slice(0, 12)}`)
    }
  }

  const handleNewSession = () => {
    if (isStreamingRef.current) return
    setActiveSessionId(null)
    setInput("")
    setError(null)
    // Clear URL hash
    window.history.replaceState(null, "", window.location.pathname)
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await apiDeleteSession(sessionId)
      messagesBySession.delete(sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
      }
      await loadSessions()
      forceUpdate()
    } catch (err) {
      console.error("Failed to delete session:", err)
    }
  }

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      await renameSession(sessionId, title)
      await loadSessions()
    } catch (err) {
      console.error("Failed to rename session:", err)
    }
  }, [])

  const handleTogglePin = useCallback(async (sessionId: string) => {
    try {
      await togglePinSession(sessionId)
      await loadSessions()
    } catch (err) {
      console.error("Failed to toggle pin:", err)
    }
  }, [])

  const handleToggleArchive = useCallback(async (sessionId: string) => {
    try {
      await toggleArchiveSession(sessionId)
      await loadSessions()
    } catch (err) {
      console.error("Failed to toggle archive:", err)
    }
  }, [])

  const handleStreamEvent = (event: StreamEvent) => {
    const content = event.content || ""
    if (event.type === "done") {
      console.log("[STREAM] Done event — stream finished")
    }
    if (event.message_id) {
      streamingMessageIdRef.current = event.message_id
    }

    switch (event.type) {
      case "response":
        streamingContentRef.current += content
        setStreamingDisplay(streamingContentRef.current)
        break
      case "replace":
        streamingContentRef.current = content
        setStreamingDisplay(streamingContentRef.current)
        break
      case "thinking":
      case "reasoning":
        streamingThinkingRef.current += content
        setStreamingThinking(streamingThinkingRef.current)
        // Append reasoning text to the last text block, or create one
        {
          const blocks = streamingBlocksRef.current
          if (blocks.length > 0 && blocks[blocks.length - 1].type === "text") {
            blocks[blocks.length - 1].content += content
          } else {
            blocks.push({ type: "text", content })
          }
          setStreamingBlocks([...blocks])
        }
        break
      case "interaction":
        if (event.interaction) {
          const updated = upsertInteraction(streamingInteractionsRef.current, event.interaction)
          streamingInteractionsRef.current = updated
          setStreamingInteractions([...updated])
          if (event.interaction.kind === "tool_call") {
            streamingToolCallsRef.current = upsertInteraction(streamingToolCallsRef.current, event.interaction)
            setStreamingToolCalls([...streamingToolCallsRef.current])
          }
          // Insert tool call as a block in chronological order
          if (event.interaction.kind === "tool_call") {
            streamingBlocksRef.current.push({ type: "tool_call", interaction: event.interaction })
            setStreamingBlocks([...streamingBlocksRef.current])
          }
        }
        break
      case "status":
        if (event.status === "processing" && !streamingThinkingRef.current) {
          setStreamingThinking(content || "Hermes is processing...")
        }
        break
      case "typing":
        if (!streamingThinkingRef.current) {
          setStreamingThinking("Waiting for Hermes to start responding...")
        }
        break
      case "media":
        // Structured media event from adapter — append as MEDIA: marker
        // so the frontend's parseMediaMarkers() picks it up naturally.
        // The file path is served via /api/media.
        {
          const path = (event as any).path || ""
          if (path) {
            streamingContentRef.current += `\nMEDIA:${path}`
            setStreamingDisplay(streamingContentRef.current)
          }
        }
        break
      case "error":
        if (content) setError(content)
        break
      case "done":
        break
    }
  }

  const handleSend = useCallback(async (files: File[] = []) => {
    const text = input.trim()
    if ((!text && files.length === 0) || (loading && !isStreamingRef.current)) return

    // If the agent is currently streaming, send as a /steer command
    if (isStreamingRef.current) {
      if (!text) return

      const currentSessionId = activeSessionId
      if (!currentSessionId) return

      console.log("[STEER] Sending steer command:", text.slice(0, 60))
      const steerText = `/steer ${text}`
      setInput("")

      // Add the user message to the UI immediately
      const steerMessage: ChatMessage = {
        role: "user",
        content: text,
        id: generateMessageId(),
        timestamp: new Date().toISOString(),
      }
      const existingMessages = messagesBySession.get(currentSessionId) || []
      messagesBySession.set(currentSessionId, [...existingMessages, steerMessage])
      forceUpdate()

      // Fire-and-forget — no new SSE stream, the existing stream continues
      console.log("[STEER] Calling sendCommand with:", steerText.slice(0, 60))
      await sendCommand(steerText, currentSessionId).catch((err) => {
        console.log("[STEER] sendCommand error:", err)
        setError(err instanceof Error ? err.message : "Steer failed")
      })
      console.log("[STEER] sendCommand completed")
      return
    }

    setLoading(true)
    setError(null)
    updateStreamingState(true)

    streamingContentRef.current = ""
    streamingThinkingRef.current = ""
    streamingInteractionsRef.current = []
    streamingToolCallsRef.current = []
    streamingBlocksRef.current = []
    streamingMessageIdRef.current = ""
    setStreamingDisplay("")
    setStreamingThinking("")
    setStreamingInteractions([])
    setStreamingToolCalls([])
    setStreamingBlocks([])

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      attachments: files.map((file) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        url: URL.createObjectURL(file),
      })),
      id: generateMessageId(),
      timestamp: new Date().toISOString(),
    }

    let currentSessionId = activeSessionId

    if (!currentSessionId) {
      currentSessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setActiveSessionId(currentSessionId)
      messagesBySession.set(currentSessionId, [])
    }

    const existingMessages = messagesBySession.get(currentSessionId) || []
    messagesBySession.set(currentSessionId, [...existingMessages, userMessage])
    forceUpdate()
    setInput("")

    // Scroll to show the user's message immediately after sending
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: "end" })
      })
    })

    try {
      const returnedSessionId = await sendMessage(
        text,
        currentSessionId,
        handleStreamEvent,
        files,
      )

      const finalContent = streamingContentRef.current
      const finalThinking = streamingThinkingRef.current
      const finalSessionId = returnedSessionId || currentSessionId || ""

      if (finalContent || finalThinking || streamingInteractionsRef.current.length > 0) {
        const sessionMessages = messagesBySession.get(finalSessionId) || []
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: finalContent,
          thinking: finalThinking,
          interactions: streamingInteractionsRef.current,
          blocks: streamingBlocksRef.current,
          id: streamingMessageIdRef.current || generateMessageId(),
          timestamp: new Date().toISOString(),
        }
        messagesBySession.set(finalSessionId, [
          ...sessionMessages,
          assistantMessage,
        ])

        // CRITICAL: Clear streaming state BEFORE forceUpdate. If we don't,
        // the streaming placeholder (id: "streaming") is still appended to
        // allDisplayMessages because isStreamingRef is still true, creating
        // a duplicate assistant message.
        updateStreamingState(false)
        setLoading(false)
        setStreamingDisplay("")
        setStreamingThinking("")
        streamingContentRef.current = ""
        streamingThinkingRef.current = ""
        streamingInteractionsRef.current = []
        streamingMessageIdRef.current = ""
        setStreamingInteractions([])

        forceUpdate()
      } else {
        updateStreamingState(false)
        setLoading(false)
        setStreamingDisplay("")
        setStreamingThinking("")
        streamingContentRef.current = ""
        streamingThinkingRef.current = ""
        streamingInteractionsRef.current = []
        streamingMessageIdRef.current = ""
        setStreamingInteractions([])
      }

      if (finalSessionId && finalSessionId !== currentSessionId) {
        setActiveSessionId(finalSessionId)
      }

      await loadSessions()

      // Update URL hash with the slug from the refreshed session list
      const updatedSessions = await fetchSessions()
      setSessions(updatedSessions)
      const activeSessionFromList = updatedSessions.find(
        (s) => s.session_id === (finalSessionId || currentSessionId)
      )
      if (activeSessionFromList?.slug) {
        window.history.replaceState(null, "", `#slug=${activeSessionFromList.slug}`)
      } else if (finalSessionId || currentSessionId) {
        window.history.replaceState(null, "", `#session=${(finalSessionId || currentSessionId || "").slice(0, 12)}`)
      }
    } catch (err: any) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to send message"
      setError(errorMsg)
    } finally {
      setLoading(false)
      updateStreamingState(false)
    }
  }, [input, loading, activeSessionId, forceUpdate])

  const handleStop = useCallback(async () => {
    const sessionId = activeSessionId
    if (!sessionId || !isStreamingRef.current) {
      console.log("[STOP] Guard blocked — sessionId:", !!sessionId, "isStreaming:", isStreamingRef.current)
      return
    }
    console.log("[STOP] Sending /stop")
    await sendCommand("/stop", sessionId).catch((err) => {
      console.log("[STOP] sendCommand error:", err)
      setError(err instanceof Error ? err.message : "Stop failed")
    })
    console.log("[STOP] sendCommand completed")
  }, [activeSessionId])

  const updateInteractionEverywhere = useCallback((interaction: ChatInteraction) => {
    if (!activeSessionId) return
    streamingInteractionsRef.current = upsertInteraction(
      streamingInteractionsRef.current,
      interaction,
    )
    setStreamingInteractions([...streamingInteractionsRef.current])
    messagesBySession.set(
      activeSessionId,
      messages.map((message) => ({
        ...message,
        interactions: message.interactions?.some((item) => item.id === interaction.id)
          ? upsertInteraction(message.interactions, interaction)
          : message.interactions,
      })),
    )
    forceUpdate()
  }, [activeSessionId, forceUpdate])

  const handleAction = useCallback(async (interactionId: string, value: string) => {
    try {
      const result = await performAction(interactionId, value)
      if (result.interaction) {
        updateInteractionEverywhere(result.interaction)
      }
      if (result.message && activeSessionId) {
        const message: ChatMessage = typeof result.message === "string"
          ? {
              id: generateMessageId(),
              role: "assistant",
              content: result.message,
              timestamp: new Date().toISOString(),
            }
          : result.message
        const messages = messagesBySession.get(activeSessionId) || []
        messagesBySession.set(activeSessionId, [...messages, message])
        forceUpdate()
        await loadSessions()
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to perform action"
      setError(errorMsg)
    }
  }, [activeSessionId, forceUpdate, updateInteractionEverywhere])

  const handleArtifactSidebar = useCallback((code: string, language: string) => {
    setSidebarArtifact((prev) =>
      prev?.code === code && prev?.language === language ? null : { code, language }
    )
  }, [])

  const handleLogout = () => {
    logout()
    window.location.reload()
  }

  const handleModelChange = useCallback(async (provider: string, model: string) => {
    console.log("[ModelSelector] Switching to:", model, "on", provider, "session:", activeSessionId?.slice(0, 16))
    setModelChanging(true)
    try {
      const result = await setModel(provider, model, activeSessionId || undefined)
      console.log("[ModelSelector] Switch result:", result)

      // Update model state from POST response
      setCurrentModel(result.model)
      setCurrentProvider(result.provider)
      setCurrentProviderLabel(result.provider_label)

      // Refresh provider list — GET /api/model now respects session overrides
      if (activeSessionId) {
        await loadModelInfo(activeSessionId)
      }
    } catch (err: any) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to switch model"
      console.error("[ModelSelector] Switch failed:", errorMsg)
      setError(errorMsg)
    } finally {
      setModelChanging(false)
    }
  }, [activeSessionId])

  const allDisplayMessages = [...activeMessages]
  if (isStreamingRef.current || loading) {
    allDisplayMessages.push({
      role: "assistant" as const,
      content: streamingDisplay,
      thinking: streamingThinking,
      interactions: streamingInteractions,
      blocks: streamingBlocks,
      id: "streaming",
      timestamp: new Date().toISOString(),
    })
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        open={sidebarOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border/60 bg-background/80 px-3 py-2.5 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="size-4" /> : <Menu className="size-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={handleNewSession}>
              <Plus className="size-3.5" />
              New chat
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {modelLoading ? (
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted/50" />
            ) : (
              <Badge variant="outline" className="hidden border-border/70 bg-card text-xs text-muted-foreground sm:inline-flex">
                {activeSessionId ? "Web Chat" : "No conversation"}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDarkMode((value) => !value)}
              title="Toggle theme"
            >
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            {user && (
              <Button variant="ghost" size="sm" onClick={handleLogout} title="Sign out">
                <LogOut className="size-3.5" />
                {user.username}
              </Button>
            )}
          </div>
        </header>

        <main ref={scrollContainerRef} className="scroll-container flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl">
            {!activeSessionId && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col items-center justify-center px-6 py-32 text-center"
              >
                <div className="mb-5 flex size-16 items-center justify-center rounded-3xl border border-border/60 bg-card shadow-sm">
                  <Bot className="size-7 text-primary" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">Hermes Web Chat</h1>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground/80">
                  Ask your agent anything. Markdown, math, code blocks, streaming replies,
                  and sandboxed interactive artifacts are rendered inline.
                </p>
              </motion.div>
            )}

            {activeSessionId && (
              <>
                <MessageList
                  messages={allDisplayMessages}
                  onAction={handleAction}
                  onArtifactSidebar={handleArtifactSidebar}
                />
                <div ref={messagesEndRef} className="h-4" />
                <div ref={bottomSentinelRef} className="h-px" />
              </>
            )}
          </div>

          {showScrollButton && activeSessionId && (
            <AnimatePresence>
              {showScrollButton && (
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.9 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="sticky bottom-6 flex justify-center"
                >
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border border-border/60 bg-card/90 px-4 py-2 text-xs",
                      "text-muted-foreground shadow-lg backdrop-blur-md transition-all",
                      "hover:bg-accent hover:text-foreground hover:shadow-xl",
                      "active:scale-95",
                    )}
                  >
                    <ArrowDownCircle className="size-4" />
                    New messages
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </main>

        {error && (
          <div className="border-t border-border/70 px-4 py-3">
            <div className="mx-auto max-w-3xl">
              <Alert variant="destructive" className="py-3">
                <AlertDescription className="flex items-center justify-between gap-3 text-sm">
                  <span>{error}</span>
                  <Button variant="ghost" size="xs" onClick={() => setError(null)}>
                    Dismiss
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          </div>
        )}

        <MessageInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          loading={loading}
          isStreaming={isStreaming}
          onStop={handleStop}
          currentModel={currentModel}
          currentProvider={currentProvider}
          providers={providers}
          onModelChange={handleModelChange}
          modelChanging={modelChanging}
          modelLoading={modelLoading}
        />
      </div>

      {sidebarArtifact && (
        <div className="flex w-[480px] flex-col border-l border-border/70 bg-background">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <PanelRightClose className="size-4 text-muted-foreground" />
              Artifact sidebar
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarArtifact(null)}
              title="Close sidebar"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ArtifactRenderer
              code={sidebarArtifact.code}
              language={sidebarArtifact.language}
            />
          </div>
        </div>

      )}
    </div>
  )
}
