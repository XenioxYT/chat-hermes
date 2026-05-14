/**
 * Hermes Web Chat API Client
 *
 * A thin, typed client for communicating with the Hermes Web Chat platform
 * adapter. Handles authentication, message sending with SSE streaming, and
 * session management.
 *
 * Architecture:
 * - JWT token is stored in localStorage and attached to all requests
 * - Messages are sent via POST /api/send with stream: true
 * - Responses come back as Server-Sent Events over the same HTTP connection
 * - Sessions are managed via the REST API and persisted in SQLite on the backend
 *
 * All methods return typed responses. Errors are thrown as ChatError instances
 * so the UI can display them consistently.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A chat message displayed in the UI */
export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
  thinking?: string
  /** True while this message is still receiving SSE events. UI-only. */
  streaming?: boolean
  attachments?: ChatAttachment[]
  interactions?: ChatInteraction[]
  reactions?: Record<string, string[]>
  /** Chronologically-ordered blocks for streaming — text + tool_call segments */
  blocks?: any[]
  /** Unique ID for this message, used for rendering keys and references */
  id: string
  /** ISO timestamp of when this message was received/created */
  timestamp: string
}

export interface ChatInteractionControl {
  label: string
  value: string
  variant?: "default" | "secondary" | "ghost" | "destructive"
  disabled?: boolean
}

export interface ChatInteraction {
  id: string
  kind: string
  title: string
  content: string
  controls: ChatInteractionControl[]
  disabled?: boolean
  selected?: string
  created_at?: number
}

export interface ChatAttachment {
  name: string
  type: string
  size: number
  url: string
}

/** A conversation session */
export interface Session {
  session_id: string
  title: string
  created_at: number
  updated_at: number
  message_count: number
  pinned: number
  archived: number
  slug?: string
}

/** User colour settings */
export interface UserSettings {
  accent_color: string
  bg_color: string
  theme: string
}

/** User information returned from login */
export interface User {
  username: string
  user_id: string
}

/** Login response from the API */
export interface LoginResponse {
  token: string
  user: User
}

/** A web search source result */
export interface Source {
  url: string
  title: string
  snippet: string
  domain: string
}

/** SSE event received from the streaming response */
export interface StreamEvent {
  type: "typing" | "response" | "replace" | "thinking" | "reasoning" | "interaction" | "status" | "done" | "error" | "media" | "sources_update"
  content?: string
  session_id?: string
  message_id?: string
  final?: boolean
  interaction?: ChatInteraction
  status?: string
  /** Path to a media file (for type: "media" events) */
  path?: string
  /** Search sources (for type: "sources_update" events) */
  sources?: Source[]
}

export interface ActionResponse {
  status: string
  resolved?: number
  interaction?: ChatInteraction
  message?: ChatMessage | string | null
}

/** A provider entry from the model info endpoint */
export interface ModelProvider {
  slug: string
  name: string
  is_current: boolean
  is_user_defined: boolean
  models: string[]
  total_models: number
  source: string
}

/** Response from GET /api/model */
export interface ModelInfo {
  current_model: string
  current_provider: string
  current_provider_label: string
  providers: ModelProvider[]
}

/** Response from POST /api/model */
export interface SetModelResponse {
  status: string
  message: string
  model: string
  provider: string
  provider_label: string
}

export function authedFileUrl(url: string): string {
  const token = getToken()
  const separator = url.includes("?") ? "&" : "?"
  return `${API_BASE}${url}${token ? `${separator}token=${encodeURIComponent(token)}` : ""}`
}

/** Custom error class for API errors */
export class ChatError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = "ChatError"
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Base URL of the webchat adapter.
 * In development, this is the local adapter server.
 * In production, this is chat.xeniox.uk.
 *
 * Override with VITE_API_BASE_URL env var at build time.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || ""

/** localStorage keys */
const TOKEN_KEY = "webchat_token"
const USER_KEY = "webchat_user"

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getStoredUser(): User | null {
  try {
    const data = localStorage.getItem(USER_KEY)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Make an authenticated API request.
 * Automatically attaches the JWT token if available.
 */
async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }

  // Attach JWT token for authenticated endpoints
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    // Handle 401 by clearing stored credentials (session expired)
    if (response.status === 401) {
      clearToken()
      throw new ChatError("Session expired. Please log in again.", 401)
    }

    // Try to parse error message from response body
    try {
      const errorData = await response.json()
      throw new ChatError(
        errorData.error || `Request failed with status ${response.status}`,
        response.status,
      )
    } catch (e) {
      if (e instanceof ChatError) throw e
      throw new ChatError(
        `Request failed with status ${response.status}`,
        response.status,
      )
    }
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Authenticate with username and password.
 *
 * On success, stores the JWT token and user info in localStorage
 * for subsequent requests.
 */
export async function login(username: string, password: string): Promise<User> {
  const data: LoginResponse = await apiRequest("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })

  setToken(data.token)
  setStoredUser(data.user)
  return data.user
}

/** Log out: clear stored credentials. */
export function logout(): void {
  clearToken()
}

/** Check if the user is currently logged in (has a stored token). */
export function isLoggedIn(): boolean {
  return !!getToken()
}

/**
 * Send a message to the agent and stream the response back.
 *
 * Instead of waiting for the full response, this returns an async generator
 * that yields SSE events as they arrive. The UI can update incrementally:
 * first a typing indicator, then the response text, then completion.
 *
 * @param message - The user's message text
 * @param sessionId - Existing session ID to continue, or omit for a new conversation
 * @param onChunk - Callback for each streaming chunk
 * @returns The session_id for this conversation
 */
export async function sendMessage(
  message: string,
  sessionId?: string,
  onEvent?: (event: StreamEvent) => void,
  files: File[] = [],
): Promise<string> {
  const token = getToken()
  if (!token) {
    throw new ChatError("Not authenticated", 401)
  }

  let response: Response
  if (files.length > 0) {
    const form = new FormData()
    form.append("message", message)
    if (sessionId) form.append("session_id", sessionId)
    files.forEach((file) => form.append("files", file, file.name))
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""
    response = await fetch(`${API_BASE}/api/send${query}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    })
  } else {
    response = await fetch(`${API_BASE}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message,
        session_id: sessionId,
      }),
    })
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearToken()
      throw new ChatError("Session expired. Please log in again.", 401)
    }
    throw new ChatError(
      `Send failed with status ${response.status}`,
      response.status,
    )
  }

  // The response is an SSE stream. We read it as text/event-stream
  // using the ReadableStream API. Each "data: {...}" line is parsed
  // as a JSON event and passed to the callback.
  const reader = response.body?.getReader()
  if (!reader) {
    throw new ChatError("Response body is not readable")
  }

  // SSE parsing state
  let buffer = ""
  let resolvedSessionId = sessionId || ""
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Decode the chunk and append to our line buffer
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines.
      // Each event has "data: {json}\n\n" format.
      const parts = buffer.split("\n\n")
      // Keep the last (potentially incomplete) part in the buffer
      buffer = parts.pop() || ""

      for (const part of parts) {
        // Extract the data line (skip empty parts)
        const dataLine = part.trim()
        if (!dataLine) continue
        if (dataLine.startsWith(":")) continue

        // Parse "data: {...}" lines
        const jsonStr = dataLine.startsWith("data: ")
          ? dataLine.slice(6)
          : dataLine

        try {
          const event: StreamEvent = JSON.parse(jsonStr)

          // Debug: log key events for interactive features
          if (event.type === "interaction" && event.interaction) {
            console.log(`📡 SSE interaction: kind=${event.interaction.kind} id=${event.interaction.id} title="${event.interaction.title}" controls=${event.interaction.controls.map(c => c.label).join(",")}`)
          } else if (event.type === "sources_update") {
            console.log(`📡 SSE sources_update: ${event.sources?.length || 0} sources`)
          } else if (event.type === "done") {
            console.log(`📡 SSE done: session=${event.session_id} msgId=${event.message_id}`)
          }

          // Capture the session_id from the response if provided
          if (event.session_id) {
            resolvedSessionId = event.session_id
          }

          onEvent?.(event)
        } catch {
          // Ignore malformed JSON events
          console.warn("Failed to parse SSE event:", jsonStr)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return resolvedSessionId
}

/**
 * Attach to an already-running response for a session.
 *
 * Returns false when there is no live server-side stream to resume.
 */
export async function streamSession(
  sessionId: string,
  onEvent?: (event: StreamEvent) => void,
): Promise<boolean> {
  const token = getToken()
  if (!token) {
    throw new ChatError("Not authenticated", 401)
  }

  const response = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/stream`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  if (response.status === 204) {
    return false
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearToken()
      throw new ChatError("Session expired. Please log in again.", 401)
    }
    throw new ChatError(
      `Stream attach failed with status ${response.status}`,
      response.status,
    )
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new ChatError("Response body is not readable")
  }

  let buffer = ""
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() || ""

      for (const part of parts) {
        const dataLine = part.trim()
        if (!dataLine || dataLine.startsWith(":")) continue

        const jsonStr = dataLine.startsWith("data: ")
          ? dataLine.slice(6)
          : dataLine

        try {
          onEvent?.(JSON.parse(jsonStr) as StreamEvent)
        } catch {
          console.warn("Failed to parse SSE event:", jsonStr)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return true
}

/**
 * Send a command message without opening an SSE stream.
 *
 * Designed for steer/stop commands sent while the agent is already
 * streaming a response.  The message is POSTed to /api/send but the
 * SSE response body is discarded — the command is processed by the
 * gateway immediately and the existing SSE stream handles the rest.
 */
export async function sendCommand(
  message: string,
  sessionId?: string,
): Promise<void> {
  const token = getToken()
  if (!token) throw new ChatError("Not authenticated", 401)

  console.log("[SENDCMD] POST /api/command:", JSON.stringify({ message: message.slice(0, 80), session_id: sessionId }))
  const res = await fetch(`${API_BASE}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    console.log("[SENDCMD] Response:", res.status, body.slice(0, 200))
    throw new ChatError(`sendCommand failed: ${res.status} ${body.slice(0, 100)}`, res.status)
  }
  console.log("[SENDCMD] OK —", res.status)
}

/**
 * Fetch the list of all conversation sessions.
 */
export async function fetchSessions(): Promise<Session[]> {
  const data = await apiRequest<{ sessions: Session[] }>("/api/sessions")
  return data.sessions
}

export async function fetchMessages(sessionId: string): Promise<ChatMessage[]> {
  const data = await apiRequest<{ messages: ChatMessage[] }>(
    `/api/sessions/${sessionId}/messages`,
  )
  return data.messages
}

export async function performAction(
  actionId: string,
  value: string,
): Promise<ActionResponse> {
  return apiRequest<ActionResponse>(`/api/actions/${actionId}`, {
    method: "POST",
    body: JSON.stringify({ value }),
  })
}

/**
 * Delete a conversation session.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await apiRequest<void>(`/api/sessions/${sessionId}`, {
    method: "DELETE",
  })
}

/**
 * Fetch current model info and available providers.
 * Pass sessionId to get session-accurate model info (after switches).
 */
export async function fetchModelInfo(sessionId?: string): Promise<ModelInfo> {
  const path = sessionId
    ? `/api/model?session_id=${encodeURIComponent(sessionId)}`
    : "/api/model"
  return apiRequest<ModelInfo>(path)
}

/**
 * Switch the model for a webchat session.
 */
export async function setModel(
  provider: string,
  model: string,
  sessionId?: string,
): Promise<SetModelResponse> {
  return apiRequest<SetModelResponse>("/api/model", {
    method: "POST",
    body: JSON.stringify({ provider, model, session_id: sessionId }),
  })
}

/**
 * Rename a conversation session.
 */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  await apiRequest<void>(`/api/sessions/${sessionId}/rename`, {
    method: "POST",
    body: JSON.stringify({ title }),
  })
}

/**
 * Toggle pin status on a session.
 */
export async function togglePinSession(sessionId: string): Promise<void> {
  await apiRequest<void>(`/api/sessions/${sessionId}/pin`, {
    method: "POST",
  })
}

/**
 * Toggle archive status on a session.
 */
export async function toggleArchiveSession(sessionId: string): Promise<void> {
  await apiRequest<void>(`/api/sessions/${sessionId}/archive`, {
    method: "POST",
  })
}

export async function fetchSessionBySlug(slug: string): Promise<Session | null> {
  try {
    const data = await apiRequest<{ session: Session }>(
      `/api/sessions/slug/${encodeURIComponent(slug)}`,
    )
    return data.session
  } catch {
    return null
  }
}

/**
 * Fetch user colour/theme settings.
 */
export async function fetchUserSettings(): Promise<UserSettings> {
  return apiRequest<UserSettings>("/api/settings")
}

/**
 * Save user colour/theme settings.
 */
export async function saveUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  return apiRequest<UserSettings>("/api/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  })
}

/**
 * Get the HTTP-accessible URL for an uploaded file.
 */
export function mediaFileUrl(sessionId: string, filename: string): string {
  const token = getToken()
  return `${API_BASE}/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token || "")}`
}

/**
 * Get the HTTP-accessible URL for a generic local media path.
 */
export function localMediaUrl(absolutePath: string): string {
  const token = getToken()
  return `${API_BASE}/api/media?path=${encodeURIComponent(absolutePath)}&token=${encodeURIComponent(token || "")}`
}
