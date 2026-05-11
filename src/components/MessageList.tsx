import React, { useCallback, useMemo, useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Bot, Check, ChevronDown, Copy, Download, File, Sparkles, User, X, Eye } from "lucide-react"
import MarkdownRenderer from "./MarkdownRenderer"
import type { ChatAttachment, ChatInteraction, ChatMessage } from "../api/client"
import { authedFileUrl, localMediaUrl, mediaFileUrl } from "../api/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageListProps {
  messages: ChatMessage[]
  onAction?: (interactionId: string, value: string) => Promise<void> | void
  onArtifactSidebar?: (code: string, language: string) => void
}

interface MediaSegment {
  type: "text" | "media"
  content: string
  path?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function extractThinking(content: string, explicitThinking?: string) {
  const thinkingParts: string[] = []
  let cleaned = content

  if (explicitThinking?.trim()) {
    thinkingParts.push(explicitThinking.trim())
  }

  const reasoningPrefix = cleaned.match(
    /^\s*💭\s*\*\*Reasoning:\*\*\s*```(?:\w+)?\s*([\s\S]*?)```\s*/i,
  )
  if (reasoningPrefix) {
    thinkingParts.push(reasoningPrefix[1].trim())
    cleaned = cleaned.slice(reasoningPrefix[0].length)
  }

  for (const tag of ["think", "thinking", "reasoning", "thought", "REASONING_SCRATCHPAD"]) {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi")
    cleaned = cleaned.replace(pattern, (_match, inner) => {
      if (String(inner).trim()) thinkingParts.push(String(inner).trim())
      return ""
    })
  }

  // Strip tool-call log lines that leak into the message body (webchat only).
  // These look like: 💻 terminal: "cd ~/..." (×2)
  // Matches lines starting with an emoji, a tool name, colon, and quoted args,
  // with an optional (×N) dedup counter.
  cleaned = cleaned.replace(
    /^(?:[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B50}\u{2700}-\u{27BF}]|[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2300}-\u{23FF}])\s+\w[\w-]*:\s*"[^"]*"(?:\s+\(×\d+\))?\s*$/gimu,
    "",
  )

  // Strip injected file/attachment marker lines like 📎 File: /path
  // These are emoji + label + colon + text injected by the gateway.
  // Broader pattern than the tool-call regex above — matches any
  // emoji followed by a label: text pattern, with or without quotes.
  cleaned = cleaned.replace(
    /^(?:[^\x00-\x7F])\s+\w[\w-]*:\s*.+$/gimu,
    "",
  )

  // Strip MEDIA:/path and emoji-prefixed markers from display content.
  // Uses the same general extension pattern as parseMediaMarkers().
  const cleanExt = '[a-zA-Z][a-zA-Z0-9]{0,9}';
  cleaned = cleaned.replace(
    new RegExp(
      '(?<!`)(?:MEDIA:|🖼️\\s*Image:\\s*|🎬\\s*Video:\\s*|🎵\\s*Audio:\\s*|📄\\s*File:\\s*|📎\\s*File:\\s*)' +
      '(?:https?:\\/\\/(?:\\S+?)\\.' + cleanExt + '(?![\\/\\w.\\-%])' +
      '|(?:[a-zA-Z]:\\\\|~|\\/)(?:[^\\n`]+?)\\.' + cleanExt + '(?![\\/\\w.\\-%:]))',
      'gi'
    ),
    ""
  )

  return {
    content: cleaned.trim(),
    thinking: thinkingParts.join("\n\n").trim(),
  }
}

/** Detect standard image extensions */
function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path)
}

/** Resolve a MEDIA: path to an HTTP URL */
function resolveMediaPath(path: string): string {
  // webchat_uploads/{session}/{filename}
  const uploadMatch = path.match(/^webchat_uploads\/([^/]+)\/(.+)$/)
  if (uploadMatch) {
    return mediaFileUrl(uploadMatch[1], uploadMatch[2])
  }
  // Local absolute path
  if (path.startsWith("/")) {
    return localMediaUrl(path)
  }
  // Fallback: treat as raw URL
  return path
}

/**
 * Strip reasoning blocks from content before media marker detection.
 * Handles 💭 Reasoning: ```...``` prefix and <think>/<reasoning> tags.
 * Returns the cleaned content plus debug info about what was removed.
 */
function stripReasoning(content: string): { cleaned: string; strippedCount: number; strippedLengths: number[] } {
  let c = content
  const strippedLengths: number[] = []

  // Strip 💭 Reasoning: ```...``` prefix
  const reasoningMatch = c.match(
    /^\s*💭\s*\*\*Reasoning:\*\*\s*```(?:\w+)?\s*([\s\S]*?)```\s*/i,
  )
  if (reasoningMatch) {
    strippedLengths.push(reasoningMatch[1].trim().length)
    c = c.slice(reasoningMatch[0].length)
  }

  // Strip <think>, <thinking>, <reasoning>, <thought>, <REASONING_SCRATCHPAD> tags
  for (const tag of ["think", "thinking", "reasoning", "thought", "REASONING_SCRATCHPAD"]) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi")
    c = c.replace(regex, (_match: string, inner: string) => {
      const trimmed = String(inner).trim()
      if (trimmed) strippedLengths.push(trimmed.length)
      return ""
    })
  }

  return { cleaned: c.trim(), strippedCount: strippedLengths.length, strippedLengths }
}

/** Parse content for MEDIA: markers, splitting into text / media segments */
function parseMediaMarkers(content: string): MediaSegment[] {
  const segments: MediaSegment[] = []
  // Match both MEDIA:/path and emoji-prefixed formats like "🖼️ Image: /path"
  // and "🎬 Video: /path". The emoji patterns are:
  //   🖼️ Image: /path  (images)
  //   🎬 Video: /path  (videos)
  //   🎵 Audio: /path  (audio)
  //   📄 File: /path   (generic files)
  //   📎 File: /path   (generic files, alt emoji)
  // The MEDIA: prefix is the canonical format; emoji patterns are a legacy
  // fallback for platforms that use them.
  // Group 1 = URL rest (after https://), Group 2 = local path.
  // Uses lazy quantifiers + extension anchor to terminate paths at the correct
  // boundary — stops at spaces, emoji, punctuation, etc. after the file extension.
  // Handles file paths with spaces in the filename (e.g. "Screenshot 2026.png").
  // Match any realistic file extension (letter + up to 9 alphanumeric chars)
  // instead of maintaining a fragile allowlist. The negative lookahead after
  // the extension ensures the path is properly terminated (not mid-path).
  const RE_EXT = '[a-zA-Z][a-zA-Z0-9]{0,9}';
  const mediaRegex = new RegExp(
    '(?<!`)' +
    '(?:MEDIA:|🖼️\\s*Image:\\s*|🎬\\s*Video:\\s*|🎵\\s*Audio:\\s*|📄\\s*File:\\s*|📎\\s*File:\\s*)' +
    '(?:' +
      'https?:\\/\\/((?:\\S+?)\\.' + RE_EXT + '(?![\\/\\w.\\-%]))' +
      '|' +
      '((?:[a-zA-Z]:\\\\|~|\\/)(?:[^\\n`]+?)\\.' + RE_EXT + '(?![\\/\\w.\\-%:]))' +
    ')',
    'gui'
  );
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = mediaRegex.exec(content)) !== null) {
    // Group 1 = URL (https?), Group 2 = local path
    const urlPrefix = match[1] || ""
    const pathBase = (match[2] || "").trim()
    const path = urlPrefix + pathBase
    if (!path) continue

    // Determine which pattern matched
    const fullMatch = match[0]
    const markerType = fullMatch.startsWith("MEDIA:") ? "MEDIA:" : "emoji"

    // Text segment before this marker
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim()
      if (text) segments.push({ type: "text", content: text })
    }
    segments.push({ type: "media", content: "", path })
    console.log(
      `[MEDIA] Marker: ${JSON.stringify(fullMatch)} (type: ${markerType}) → path: ${path}`,
    )
    lastIndex = match.index + match[0].length
  }

  // Trailing text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim()
    if (text) segments.push({ type: "text", content: text })
  }

  return segments.length > 0 ? segments : [{ type: "text", content }]
}

/** Guess a display filename from a path */
function filenameFromPath(path: string): string {
  const parts = path.replace(/\\\\/g, "/").split("/")
  return parts[parts.length - 1] || "file"
}

// ---------------------------------------------------------------------------
// Thinking segmentation — interleave tool call bubbles within reasoning text
// ---------------------------------------------------------------------------

interface TextSegment {
  type: "text"
  content: string
}

interface ToolCallSegment {
  type: "tool_call"
  interaction: ChatInteraction
}

type ThinkingSegment = TextSegment | ToolCallSegment

/**
 * Parse thinking text into interleaved text + tool call segments.
 *
 * Scans the thinking text line-by-line for lines matching the pattern:
 *   tool_name {json args}
 * and replaces them with ToolCallBubble components using data from the
 * corresponding ChatInteraction (if a match is found).
 */
function parseThinkingSegments(
  thinking: string,
  toolCalls: ChatInteraction[],
): ThinkingSegment[] {
  // Handle empty thinking: if there are tool calls, return them as-is.
  // If no tool calls either, return empty text.
  const hasThinking = thinking?.trim()?.length > 0
  if (!hasThinking) {
    if (toolCalls.length === 0) return [{ type: "text", content: "" }]
    return toolCalls.map((tc) => ({ type: "tool_call" as const, interaction: tc }))
  }
  if (toolCalls.length === 0) return [{ type: "text", content: thinking }]

  // Match tool call invocation lines: word/hyphen name followed by JSON args.
  // Example: `hindsight_recall {"query": "Tom location home city"}`
  const toolCallLineRe = /^([\w-]+)\s+(\{.*\})\s*$/

  const lines = thinking.split("\n")
  const segments: ThinkingSegment[] = []
  let textBuf = ""

  const remainingCalls = [...toolCalls]

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const match = trimmed.match(toolCallLineRe)

    if (match) {
      const toolName = match[1]
      const rawArgs = match[2]

      // Try to match this line to a real interaction by tool name + content
      const interactionIdx = remainingCalls.findIndex((tc) => {
        const name = tc.title || tc.kind || ""
        if (name !== toolName) return false
        const contentFirst = (tc.content || "").split("\n")[0]?.trim() || ""
        return contentFirst && rawArgs.includes(contentFirst.slice(0, 60))
      })

      if (interactionIdx !== -1) {
        // Flush pending text
        if (textBuf.trim()) {
          segments.push({ type: "text", content: textBuf })
          textBuf = ""
        }

        segments.push({
          type: "tool_call",
          interaction: remainingCalls[interactionIdx],
        })
        remainingCalls.splice(interactionIdx, 1)
      } else {
        textBuf += lines[i] + "\n"
      }
    } else {
      textBuf += lines[i] + "\n"
    }
  }

  if (textBuf.trim()) {
    segments.push({ type: "text", content: textBuf })
  }

  // Append any tool calls that weren't matched inline at the bottom.
  // This handles cases where the thinking text doesn't contain the tool
  // call signature (e.g. different agent output format) — they still appear
  // in the reasoning box, just after the text instead of interleaved.
  for (const tc of remainingCalls) {
    segments.push({ type: "tool_call", interaction: tc })
  }

  return segments
}

// ---------------------------------------------------------------------------
// ImageViewer — lightbox dialog for images with zoom + smooth animation
// ---------------------------------------------------------------------------

function ImageViewer({
  src,
  alt,
  title,
}: {
  src: string
  alt: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset zoom when dialog opens
  useEffect(() => {
    if (open) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }, [open])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom((z) => Math.min(Math.max(z + delta, 1), 5))
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (zoom > 1) {
      setIsPanning(true)
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }, [zoom, pan])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      })
    }
  }, [isPanning])

  const handlePointerUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleDoubleClick = useCallback(() => {
    setZoom((z) => (z > 1 ? 1 : 2))
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="group relative inline-block cursor-pointer overflow-hidden rounded-xl">
          <div className="overflow-hidden rounded-xl">
            <img
              src={src}
              alt={alt}
              className="max-h-48 object-contain bg-muted/30 transition-transform duration-300 ease-out group-hover:scale-[1.05]"
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-300 group-hover:bg-black/20">
            <Eye className="size-6 text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          </div>
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[90vw]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideDefaultClose
      >
        <DialogTitle className="sr-only">{title || alt || "Image viewer"}</DialogTitle>
        <div
          ref={containerRef}
          className="relative flex h-[90vh] w-[90vw] cursor-zoom-in items-center justify-center overflow-hidden bg-black/80"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <div className="flex h-[90vh] w-[90vw] items-center justify-center">
            <img
              src={src}
              alt={alt}
              className="max-h-[85vh] max-w-[85vw] object-contain"
              style={{
                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transformOrigin: "center center",
                transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
                userSelect: "none",
              }}
            />
          </div>
          <div className="absolute right-3 top-3 flex gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(z + 0.5, 5))}
              className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
              title="Zoom in"
            >
              <span className="text-lg font-bold leading-none">+</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1)
                setPan({ x: 0, y: 0 })
              }}
              className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
              title="Reset zoom"
            >
              <span className="text-xs font-bold leading-none">1:1</span>
            </button>
            <a
              href={src}
              download={title || alt || "image"}
              className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
              title="Download image"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="size-4" />
            </a>
            <DialogClose className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70">
              <X className="size-4" />
            </DialogClose>
          </div>
          {zoom > 1 && (
            <div className="absolute bottom-3 left-3 rounded-full bg-black/50 px-2 py-1 text-xs text-white backdrop-blur-sm">
              {Math.round(zoom * 100)}%
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ToolCallBubble — compact inline pill for tool calls
// ---------------------------------------------------------------------------

function ToolCallBubble({ interaction }: { interaction: ChatInteraction }) {
  const [expanded, setExpanded] = useState(false)

  // Build a short arg preview from content (truncated JSON or text)
  const rawContent = interaction.content || ""
  const firstLine = rawContent.split("\n")[0]?.trim() || ""
  const argsPreview =
    firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine
  const hasDetails = rawContent.length > 0

  const toolName = interaction.title || interaction.kind || "tool"

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/10 px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 text-left text-xs",
          hasDetails ? "cursor-pointer hover:opacity-80" : "cursor-default",
        )}
      >
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
          {toolName}
        </span>
        {argsPreview && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {argsPreview}
          </span>
        )}
        {hasDetails && (
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>
      {expanded && hasDetails && (
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
          {rawContent}
        </pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ThinkingDisclosure — collapsible panel with auto-scroll + tool call bubbles
// ---------------------------------------------------------------------------

/**
 * Extract a short label for the collapsed thinking header.
 *
 * Rules:
 *  - No blocks + no thinking text → "Thinking..."
 *  - Last block is a tool_call → truncated "[tool_name] [args]" (75 chars)
 *  - Otherwise → first 75 chars (word boundary) of the *last paragraph*,
 *    so the label updates each time a new paragraph starts streaming.
 */

function truncateHead(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const slice = text.slice(0, maxLen)
  const lastSpace = slice.lastIndexOf(" ")
  if (lastSpace > 0) return slice.slice(0, lastSpace) + "..."
  return slice + "..."
}

function extractThinkingLabel(thinking: string, blocks: any[]): string {
  // If there's a tool call, show that
  if (blocks && blocks.length > 0) {
    const last = blocks[blocks.length - 1]
    if (last.type === "tool_call") {
      const toolName = last.interaction?.title || `Tool: ${last.interaction?.kind || "unknown"}`
      const args = last.interaction?.content || ""
      if (args) {
        const combined = `${toolName} ${args}`
        return truncateHead(combined, 75)
      }
      return truncateHead(toolName, 75)
    }
  }

  // Show the first 75 chars of the last paragraph — updates each time a
  // new paragraph starts streaming.
  const text = thinking?.trim() || ""
  if (text.length === 0) return "Thinking..."

  // Split into paragraphs and take the last non-empty one
  const paragraphs = text.split(/\n\n+/).filter(Boolean)
  const lastParagraph = paragraphs[paragraphs.length - 1] || text
  return truncateHead(lastParagraph.trim(), 75)
}

const ThinkingDisclosure = React.memo(function ThinkingDisclosure({
  thinking,
  streaming,
  interactions,
  blocks,
}: {
  thinking: string
  streaming: boolean
  interactions?: ChatInteraction[]
  blocks?: any[]
}) {
  const [open, setOpen] = useState(false)

  // Auto-scroll for the thinking container — same pattern as main chat
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  // Scroll listener: track if user is near the bottom of the thinking container
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    }
    el.addEventListener("scroll", handler, { passive: true })
    return () => el.removeEventListener("scroll", handler)
  }, [])

  // Auto-scroll when new thinking content arrives during streaming
  useEffect(() => {
    if (streaming && open && scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [thinking, streaming, open])

  // Filter for tool_call interactions
  const toolCalls = interactions?.filter((i) => i.kind === "tool_call") || []

  // Use streaming blocks if available (chronologically ordered), otherwise parse
  const segments = useMemo(() => {
    if (blocks && blocks.length > 0) {
      return blocks
    }
    return parseThinkingSegments(thinking, toolCalls)
  }, [blocks, thinking, toolCalls])

  // Summary line for the collapsed header
  const summary =
    thinking
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^[-*\d.\s]+/, "")
      .slice(0, 90) || "Thinking"

  // No content at all — hide the component
  if (!segments.some((s) => s.type === "text" && s.content.trim()) && toolCalls.length === 0) {
    return null
  }

  return (
    <div className="mb-3 rounded-xl border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <Sparkles className={cn("size-4 shrink-0", streaming && "text-primary")} />
        <span className={cn("min-w-0 flex-1 truncate", streaming && "thinking-gradient")}>
          {streaming ? extractThinkingLabel(thinking, blocks) : summary}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "-rotate-90")} />
      </button>
      <div className={cn("grid transition-all duration-200", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="min-h-0 overflow-hidden">
            <div
              ref={scrollRef}
              className="max-h-[33vh] overflow-y-auto overscroll-contain border-t border-border/70 px-3 py-3 font-mono text-xs leading-5 text-muted-foreground"
            >
          {segments.map((seg, i) => {
            if (seg.type === "text") {
              return (
                <pre key={i} className="inline m-0 p-0 bg-transparent border-0 text-inherit whitespace-pre-wrap font-mono text-xs leading-5">
                  {seg.content}
                </pre>
              )
            }
            return (
              <div key={`tc-${i}`} className="mx-0">
                <ToolCallBubble interaction={seg.interaction} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  </div>
)
})

// ---------------------------------------------------------------------------
// InlineMediaRenderer — renders MEDIA: markers inline in the text flow
// ---------------------------------------------------------------------------
// InlineMediaRenderer — renders MEDIA: markers inline in the text flow
const InlineMediaRenderer = React.memo(function InlineMediaRenderer({
  segments,
  onArtifactSidebar,
}: {
  segments: MediaSegment[]
  onArtifactSidebar?: (code: string, language: string) => void
}) {
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === "text") {
          return (
            <MarkdownRenderer key={`text-${idx}`} content={seg.content} onArtifactSidebar={onArtifactSidebar} />
          )
        }
        const path = seg.path || ""
        const resolvedUrl = resolveMediaPath(path)
        const filename = filenameFromPath(path)
        const isImage = isImagePath(path)

        if (isImage) {
          return <ImageViewer key={`media-${idx}`} src={resolvedUrl} alt={filename} title={filename} />
        }

        // Non-image file: compact pill
        return (
          <a
            key={`media-${idx}`}
            href={resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="my-1.5 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-foreground no-underline shadow-xs transition-colors hover:bg-accent"
          >
            <File className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-[200px]">{filename}</span>
            <Download className="size-3 shrink-0 text-muted-foreground" />
          </a>
        )
      })}
    </>
  )
})

// ---------------------------------------------------------------------------
// MessageActions — copy button (unchanged)
// ---------------------------------------------------------------------------

function MessageActions({
  message,
}: {
  message: ChatMessage
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy message">
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InteractionPanel — existing action-panel interactions (unchanged)
// ---------------------------------------------------------------------------

function InteractionPanel({
  interaction,
  onAction,
  onArtifactSidebar,
}: {
  interaction: ChatInteraction
  onAction?: (interactionId: string, value: string) => Promise<void> | void
  onArtifactSidebar?: (code: string, language: string) => void
}) {
  const [pendingValue, setPendingValue] = useState<string | null>(null)

  const handleClick = async (value: string) => {
    if (!onAction || interaction.disabled) return
    setPendingValue(value)
    try {
      await onAction(interaction.id, value)
    } finally {
      setPendingValue(null)
    }
  }

  // Skip tool_call interactions — they are rendered inside ThinkingDisclosure
  if (interaction.kind === "tool_call") return null

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{interaction.title}</div>
          {interaction.selected && (
            <div className="text-xs text-muted-foreground">
              Selected: {interaction.selected}
            </div>
          )}
        </div>
        <Badge variant={interaction.disabled ? "secondary" : "outline"}>
          {interaction.disabled ? "resolved" : "action needed"}
        </Badge>
      </div>
      {interaction.content && (
        <div className="mb-3 text-sm">
          <MarkdownRenderer content={interaction.content} onArtifactSidebar={onArtifactSidebar} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {interaction.controls.map((control) => (
          <Button
            key={`${interaction.id}-${control.value}-${control.label}`}
            variant={control.variant || "secondary"}
            size="sm"
            disabled={interaction.disabled || control.disabled || pendingValue !== null}
            onClick={() => handleClick(control.value)}
          >
            {pendingValue === control.value ? "Working..." : control.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AttachmentList — images as thumbnails (clickable), other files as pills
// ---------------------------------------------------------------------------

function AttachmentList({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments?.length) return null

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map((attachment, index) => {
        const isImage = attachment.type?.startsWith("image/")
        const url = attachment.url.startsWith("blob:")
          ? attachment.url
          : authedFileUrl(attachment.url)

        if (isImage) {
          return (
            <ImageViewer
              key={`${attachment.name}-${index}`}
              src={url}
              alt={attachment.name}
              title={attachment.name}
            />
          )
        }

        // Non-image: compact pill with size
        return (
          <a
            key={`${attachment.name}-${index}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-foreground no-underline shadow-xs transition-colors hover:bg-accent"
          >
            <File className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-[160px]">{attachment.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {Math.max(1, Math.round((attachment.size || 0) / 1024))} KB
            </span>
            <Download className="size-3 shrink-0 text-muted-foreground" />
          </a>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessageRow — renders a single message
// ---------------------------------------------------------------------------

function MessageRow({
  message,
  onAction,
  onArtifactSidebar,
}: {
  message: ChatMessage
  onAction?: (interactionId: string, value: string) => Promise<void> | void
  onArtifactSidebar?: (code: string, language: string) => void
}) {
  const isUser = message.role === "user"
  const isStreaming = message.id === "streaming"
  const parsed = useMemo(
    () => extractThinking(message.content, message.thinking),
    [message.content, message.thinking],
  )

  // Parse MEDIA: markers out of the message content, excluding reasoning blocks.
  // Reasoning is stripped first so that internal MEDIA references in thinking
  // text don't produce false-positive attachment pills.
  const contentForMedia = useMemo(() => {
    const raw = message.content || ""
    const { cleaned } = stripReasoning(raw)
    return cleaned
  }, [message.content])
  const mediaSegments = useMemo(
    () => parseMediaMarkers(contentForMedia),
    [contentForMedia],
  )
  // Text-only content for copy (strip MEDIA markers and emoji-prefixed markers)
  const textOnlyContent = useMemo(
    () => parsed.content.replace(/^(?:MEDIA:|🖼️\s*Image:\s*|🎬\s*Video:\s*|🎵\s*Audio:\s*|📄\s*File:\s*|📎\s*File:\s*).+$/gm, "").trim(),
    [parsed.content],
  )

  if (isUser) {
    return (
      <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="group flex justify-end px-4 py-3"
    >
      <div className="flex max-w-[85%] flex-col items-end gap-2 sm:max-w-[72%]">
        <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground shadow-sm">
          <AttachmentList attachments={message.attachments} />
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <div className="flex items-center gap-2 pr-1 text-xs text-muted-foreground">
          <span>{formatTime(message.timestamp)}</span>
          <MessageActions message={{ ...message, content: textOnlyContent }} />
        </div>
      </div>
    </motion.article>
    )
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="group px-4 py-4"
    >
      <div className="mx-auto flex max-w-3xl gap-3">
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-xs">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary" className="border border-border bg-card text-foreground">
              Hermes
            </Badge>
            <span className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</span>
            {isStreaming && <span className="text-xs text-primary">streaming</span>}
          </div>
          <ThinkingDisclosure
            thinking={parsed.thinking}
            streaming={isStreaming}
            interactions={message.interactions}
            blocks={(message as any).blocks}
          />
          <AttachmentList attachments={message.attachments} />
          {mediaSegments.length > 0 && mediaSegments.some((s) => s.type === "text" || s.type === "media") ? (
            <InlineMediaRenderer segments={mediaSegments} onArtifactSidebar={onArtifactSidebar} />
          ) : null}
          {message.interactions
            ?.filter((i) => i.kind !== "tool_call")
            .map((interaction) => (
              <InteractionPanel
                key={interaction.id}
                interaction={interaction}
                onAction={onAction}
                onArtifactSidebar={onArtifactSidebar}
              />
            ))}
          <div className="mt-2">
            <MessageActions message={{ ...message, content: textOnlyContent }} />
          </div>
        </div>
      </div>
    </motion.article>
  )
}

// ---------------------------------------------------------------------------
// MessageList — the main exported component
// ---------------------------------------------------------------------------

export default React.memo(function MessageList({ messages, onAction, onArtifactSidebar }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
          <User className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">Send a message to start</p>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <AnimatePresence mode="popLayout">
        {messages.map((msg, idx) => (
          <MessageRow
            key={msg.id || `${msg.role}-${idx}`}
            message={msg}
            onAction={onAction}
            onArtifactSidebar={onArtifactSidebar}
          />
        ))}
      </AnimatePresence>
    </div>
  )
})
