import { useState, useEffect, useRef, useCallback } from "react"
import {
  MessageSquare,
  Plus,
  Trash2,
  Search,
  Pin,
  Archive,
  MoreHorizontal,
  Edit2,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import type { Session } from "../api/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

function formatTimestamp(unix: number): string {
  const date = new Date(unix * 1000)
  const now = new Date()
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

interface SessionSidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onNew: () => void
  onDelete: (sessionId: string) => void
  onRename?: (sessionId: string, title: string) => void
  onTogglePin?: (sessionId: string) => void
  onToggleArchive?: (sessionId: string) => void
  open: boolean
}

const itemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.2, delay: i * 0.03, ease: "easeOut" },
  }),
}

const sectionVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
  open,
}: SessionSidebarProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [contextMenuSessionId, setContextMenuSessionId] = useState<
    string | null
  >(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuSessionId) return
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenuSessionId(null)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [contextMenuSessionId])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const handleDelete = useCallback(
    (sessionId: string) => {
      if (confirmDeleteId === sessionId) {
        onDelete(sessionId)
        setConfirmDeleteId(null)
        setContextMenuSessionId(null)
      } else {
        setConfirmDeleteId(sessionId)
        setTimeout(() => setConfirmDeleteId(null), 3000)
      }
    },
    [confirmDeleteId, onDelete],
  )

  const handleStartRename = useCallback(
    (session: Session) => {
      setRenamingId(session.session_id)
      setRenameValue(session.title || "New conversation")
      setContextMenuSessionId(null)
    },
    [],
  )

  const handleSubmitRename = useCallback(
    (sessionId: string) => {
      const trimmed = renameValue.trim()
      if (trimmed && onRename) {
        onRename(sessionId, trimmed)
      }
      setRenamingId(null)
      setRenameValue("")
    },
    [renameValue, onRename],
  )

  const handleContextAction = useCallback(
    (action: string, session: Session) => {
      setContextMenuSessionId(null)
      switch (action) {
        case "rename":
          handleStartRename(session)
          break
        case "pin":
          onTogglePin?.(session.session_id)
          break
        case "archive":
          onToggleArchive?.(session.session_id)
          break
        case "delete":
          handleDelete(session.session_id)
          break
      }
    },
    [handleStartRename, handleDelete, onTogglePin, onToggleArchive],
  )

  // Filter sessions
  const pinned = sessions.filter(
    (s) => s.pinned && (showArchived || !s.archived),
  )
  const unpinned = sessions.filter(
    (s) => !s.pinned && (showArchived || !s.archived),
  )
  const archived = sessions.filter(
    (s) => s.archived,
  )

  // Apply search filter to visible sessions
  const query = debouncedSearch.toLowerCase().trim()
  const filterBySearch = (list: Session[]) =>
    query
      ? list.filter((s) => s.title?.toLowerCase().includes(query))
      : list

  const displayPinned = filterBySearch(pinned)
  const displayUnpinned = filterBySearch(unpinned)
  const displayArchived = filterBySearch(archived)

  const hasAnySessions =
    displayPinned.length + displayUnpinned.length + displayArchived.length > 0

  const renderSessionItem = (session: Session, index: number, section: string) => {
    const isActive = session.session_id === activeSessionId
    const isConfirming = confirmDeleteId === session.session_id
    const isArchived = session.archived === 1
    const isRenaming = renamingId === session.session_id

    return (
      <motion.li
        key={session.session_id}
        variants={itemVariants}
        custom={index}
        initial="hidden"
        animate="visible"
        layout
      >
        <div
          className={cn(
            "group relative rounded-xl border transition-all duration-150",
            isActive
              ? "border-sidebar-border bg-sidebar-accent shadow-sm"
              : "border-transparent hover:border-sidebar-border/50 hover:bg-sidebar-accent/50",
            isArchived && "opacity-60",
          )}
        >
          <button
            onClick={() => onSelect(session.session_id)}
            onDoubleClick={() => {
              if (onRename && !isArchived) handleStartRename(session)
            }}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
          >
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors",
                isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                isArchived && "italic",
              )}
            >
              <MessageSquare className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleSubmitRename(session.session_id)
                    }
                    if (e.key === "Escape") {
                      setRenamingId(null)
                    }
                  }}
                  onBlur={() => handleSubmitRename(session.session_id)}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-2 py-1 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                />
              ) : (
                <span
                  className={cn(
                    "block truncate text-sm font-medium leading-5",
                    isArchived && "italic text-muted-foreground",
                  )}
                >
                  {session.title || "New conversation"}
                </span>
              )}
              <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
                {formatTimestamp(session.updated_at)}
                {session.message_count > 0 && (
                  <>
                    {" "}· {session.message_count} msg
                    {session.message_count !== 1 ? "s" : ""}
                  </>
                )}
              </span>
            </span>

            {/* Pin indicator */}
            {!!session.pinned && !isRenaming && (
              <span className="mt-0.5 shrink-0">
                <Pin className="size-2.5 fill-primary text-primary" />
              </span>
            )}
          </button>

          {/* Delete button (always visible when confirming) */}
          {isConfirming && (
            <Button
              variant="destructive"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(session.session_id)
              }}
              className="absolute right-2 top-2 z-10 size-6"
              title="Click again to confirm"
            >
              <Trash2 className="size-2.5" />
            </Button>
          )}

          {/* Three-dot context menu button */}
          {!isRenaming && !isConfirming && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation()
                setContextMenuSessionId(
                  contextMenuSessionId === session.session_id
                    ? null
                    : session.session_id,
                )
              }}
              className={cn(
                "absolute right-2 top-2 size-6 opacity-0 transition-opacity group-hover:opacity-100",
                contextMenuSessionId === session.session_id && "opacity-100",
              )}
              title="More actions"
            >
              <MoreHorizontal className="size-2.5" />
            </Button>
          )}

          {/* Context menu dropdown */}
          {contextMenuSessionId === session.session_id && (
            <div
              ref={contextMenuRef}
              className={cn(
                "absolute right-0 top-0 z-50 w-44",
                "rounded-lg border border-border/70",
                "bg-card shadow-xl backdrop-blur-xl",
                "animate-in fade-in zoom-in-95",
                "duration-150 ease-out",
                "overflow-hidden",
              )}
            >
              <div className="py-1">
                {onRename && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleContextAction("rename", session)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                  >
                    <Edit2 className="size-3.5" />
                    Rename
                  </button>
                )}
                {onTogglePin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleContextAction("pin", session)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                  >
                    <Pin
                      className={cn(
                        "size-3.5",
                        session.pinned && "fill-primary text-primary",
                      )}
                    />
                    {session.pinned ? "Unpin" : "Pin"}
                  </button>
                )}
                {onToggleArchive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleContextAction("archive", session)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                  >
                    <Archive className="size-3.5" />
                    {session.archived === 1 ? "Unarchive" : "Archive"}
                  </button>
                )}
                <Separator className="my-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleContextAction("delete", session)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                  {isConfirming ? "Confirm delete" : "Delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.li>
    )
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out",
        open ? "w-72" : "w-0 overflow-hidden",
      )}
    >
      <div className="shrink-0 border-b border-sidebar-border px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight">Hermes</p>
            <p className="text-[11px] text-muted-foreground/70">Web conversations</p>
          </div>
          <Badge
            variant="outline"
            className="border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground text-[10px] px-2 py-0"
          >
            {sessions.length}
          </Badge>
        </div>
        <Button onClick={onNew} className="w-full justify-start rounded-lg" size="sm">
          <Plus className="size-3.5" />
          New conversation
        </Button>
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 rounded-lg border-sidebar-border bg-sidebar-accent/60 pl-7 text-xs placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {!hasAnySessions ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-2 rounded-xl border border-dashed border-sidebar-border/60 p-4 text-center"
          >
            <MessageSquare className="mx-auto mb-2 size-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground/60">
              {query
                ? "No conversations match"
                : "No conversations yet"}
            </p>
          </motion.div>
        ) : (
          <motion.ul
            className="space-y-0.5"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Pinned section */}
            {displayPinned.length > 0 && (
              <motion.li variants={itemVariants} custom={0}>
                <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                  <Pin className="size-2.5 fill-primary/50 text-primary/50" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                    Pinned
                  </span>
                </div>
              </motion.li>
            )}
            {displayPinned.map((s, i) => renderSessionItem(s, i, "pinned"))}
            {displayPinned.length > 0 && displayUnpinned.length > 0 && (
              <motion.li
                variants={itemVariants}
                custom={displayPinned.length}
                className="px-3 py-1"
              >
                <Separator className="bg-sidebar-border/40" />
              </motion.li>
            )}

            {/* Unpinned section */}
            {displayUnpinned.length > 0 && displayPinned.length === 0 && (
              <motion.li variants={itemVariants} custom={0}>
                <div className="px-3 pb-1 pt-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                    Recent
                  </span>
                </div>
              </motion.li>
            )}
            {displayUnpinned.map((s, i) =>
              renderSessionItem(s, i + displayPinned.length + (displayPinned.length > 0 ? 1 : 0), "unpinned")
            )}

            {/* Archived section (when showArchived is true) */}
            {displayArchived.length > 0 && (
              <>
                {displayPinned.length + displayUnpinned.length > 0 && (
                  <motion.li
                    variants={itemVariants}
                    custom={displayPinned.length + displayUnpinned.length + 1}
                    className="px-3 py-1"
                  >
                    <Separator className="bg-sidebar-border/40" />
                  </motion.li>
                )}
                <motion.li
                  variants={itemVariants}
                  custom={displayPinned.length + displayUnpinned.length + 2}
                >
                  <div className="px-3 pb-1 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                      Archived
                    </span>
                  </div>
                </motion.li>
                {displayArchived.map((s, i) =>
                  renderSessionItem(s, i + displayPinned.length + displayUnpinned.length + 3, "archived")
                )}
              </>
            )}
          </motion.ul>
        )}
      </div>

      {/* Show archived toggle */}
      {sessions.filter((s) => s.archived).length > 0 && (
        <div className="shrink-0 border-t border-sidebar-border p-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-muted-foreground"
          >
            <Archive className="size-3" />
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>
      )}
    </aside>
  )
}
