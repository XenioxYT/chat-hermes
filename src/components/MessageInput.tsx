import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent, type DragEvent } from "react"
import { FileUp, Loader2, SendHorizontal, Sparkles, X, BrainCircuit, Check, ChevronDown, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ModelProvider {
  slug: string
  name: string
  is_current: boolean
  models: string[]
  total_models: number
}

interface MessageInputProps {
  value: string
  onChange: (value: string) => void
  onSend: (files?: File[]) => void
  loading: boolean
  isStreaming: boolean
  onStop: () => void
  currentModel?: string
  currentProvider?: string
  providers?: ModelProvider[]
  onModelChange?: (provider: string, model: string) => void
  modelChanging?: boolean
  modelLoading?: boolean
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  loading,
  isStreaming,
  onStop,
  currentModel = "",
  currentProvider = "",
  providers = [],
  onModelChange,
  modelChanging = false,
  modelLoading = false,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // Drag-and-drop file handling
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounterRef.current = 0

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles((current) => [...current, ...Array.from(e.dataTransfer.files)])
    }
  }

  // Paste handler: capture pasted images from clipboard
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = e.clipboardData.items
    if (!clipboardItems) return

    const imageFiles: File[] = []
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i]
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) {
          // Give pasted images a meaningful name with timestamp
          const ext = file.name?.split(".").pop() || "png"
          const renamed = new File(
            [file],
            `pasted-image-${Date.now()}.${ext}`,
            { type: file.type },
          )
          imageFiles.push(renamed)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault() // prevent pasting raw image data into textarea
      setFiles((current) => [...current, ...imageFiles])
    }
  }

  useEffect(() => {
    if (!loading) {
      textareaRef.current?.focus()
    }
  }, [loading])

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 220) + "px"
    }
  }, [value])

  // Close dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        modelButtonRef.current &&
        !modelButtonRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [modelDropdownOpen])

  const handleSend = () => {
    if (!canSend) return
    onSend(files)
    setFiles([])
  }

  const canSend = (value.trim().length > 0 || files.length > 0) && (!loading || isStreaming)
  const canStop = isStreaming
  const hasTextOrFiles = value.trim().length > 0 || files.length > 0

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleModelSelect = (providerSlug: string, modelId: string) => {
    console.log("[ModelSelector] User selected:", modelId, "from provider:", providerSlug)
    setModelDropdownOpen(false)
    onModelChange?.(providerSlug, modelId)
  }

  // Truncate model name for display
  const displayModel = currentModel
    ? (currentModel.includes("/") ? currentModel.split("/").pop()! : currentModel)
    : "No model"

  // Group models by provider and organise into sections
  const providerSections = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      ...p,
      displayModels: p.models.length > 20 ? p.models.slice(0, 20) : p.models,
      extra: p.models.length > 20 ? p.models.length - 20 : 0,
    }))

  return (
    <div
      className={cn(
        "border-t border-border/70 bg-background/95 px-3 py-3 backdrop-blur relative",
        isDragging && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-sm text-primary">
            <FileUp className="size-8" />
            <span className="font-medium">Drop files here</span>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-border/80 bg-card px-3 py-2.5 shadow-lg shadow-black/5">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {files.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                >
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Write a message..."
            disabled={loading && !isStreaming}
            rows={1}
            className="max-h-48 min-h-10 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
          />

          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/40 pt-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  setFiles((current) => [
                    ...current,
                    ...Array.from(event.target.files || []),
                  ])
                  event.target.value = ""
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                title="Attach files"
                className="text-muted-foreground/60 hover:text-foreground"
              >
                <FileUp className="size-4" />
              </Button>
              <span className="hidden items-center gap-1.5 px-2 text-[11px] text-muted-foreground/40 sm:flex">
                <Sparkles className="size-3 text-primary/60" />
                Shift + Enter for new line
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Model selector badge */}
              {modelLoading ? (
                <div className="h-5 w-20 animate-pulse rounded-full bg-muted/50" />
              ) : currentModel ? (
                <div className="relative">
                  <button
                    ref={modelButtonRef}
                    type="button"
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    disabled={modelChanging}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border border-border/50 px-2.5 py-1 text-[11px] transition-colors",
                      "text-muted-foreground/60 hover:border-primary/30 hover:text-foreground",
                      modelChanging && "animate-pulse opacity-60",
                    )}
                    title={`Current model: ${currentModel}`}
                  >
                    <BrainCircuit className="size-3" />
                    <span className="max-w-24 truncate">{displayModel}</span>
                    <ChevronDown className="size-2.5 opacity-50" />
                  </button>

                  {/* Dropdown */}
                  {modelDropdownOpen && (
                    <div
                      ref={dropdownRef}
                      className={cn(
                        "absolute bottom-full right-0 z-50 mb-2 w-72",
                        "max-h-[60vh] overflow-y-auto rounded-xl border border-border/70",
                        "bg-card shadow-xl backdrop-blur-xl",
                        "animate-in fade-in zoom-in-95",
                        "duration-150 ease-out",
                      )}
                    >
                      <div className="sticky top-0 z-10 border-b border-border/50 bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
                        Select model
                      </div>

                      {providerSections.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No models available
                        </div>
                      ) : (
                        providerSections.map((provider) => (
                          <div key={provider.slug}>
                            <div className="flex items-center gap-2 border-b border-border/30 bg-muted/30 px-3 py-1.5">
                              <span className="text-xs font-medium text-muted-foreground">
                                {provider.name}
                              </span>
                              {provider.is_current && (
                                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                  active
                                </span>
                              )}
                            </div>
                            {provider.displayModels.map((modelId) => {
                              const shortName = modelId.includes("/")
                                ? modelId.split("/").pop()!
                                : modelId
                              const isActive =
                                modelId === currentModel &&
                                provider.slug === currentProvider
                              return (
                                <button
                                  key={`${provider.slug}-${modelId}`}
                                  type="button"
                                  onClick={() =>
                                    handleModelSelect(provider.slug, modelId)
                                  }
                                  className={cn(
                                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                                    "hover:bg-accent/50",
                                    isActive && "bg-accent/30 font-medium text-foreground",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "flex-1 truncate",
                                      isActive
                                        ? "text-foreground"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {shortName}
                                  </span>
                                  {isActive && (
                                    <Check className="size-3 shrink-0 text-primary" />
                                  )}
                                </button>
                              )
                            })}
                            {provider.extra > 0 && (
                              <div className="px-3 py-1 text-[10px] text-muted-foreground/60">
                                +{provider.extra} more models
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {isStreaming && hasTextOrFiles ? (
                <>
                  {/* Steer button — send message as steer command */}
                  <Button
                    onClick={handleSend}
                    disabled={!canSend}
                    size="sm"
                    className="rounded-lg px-4"
                  >
                    Send
                    <SendHorizontal className="size-3.5" />
                  </Button>
                  {/* Stop button — kill the running agent */}
                  <Button
                    onClick={onStop}
                    size="sm"
                    className="rounded-lg px-4 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    <Square className="size-3.5 fill-current" />
                    Stop
                  </Button>
                </>
              ) : isStreaming ? (
                /* Streaming, no text — show only the stop button */
                <Button
                  onClick={onStop}
                  size="sm"
                  className="rounded-lg px-4 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  <Square className="size-3.5 fill-current" />
                  Stop
                </Button>
              ) : (
                /* Not streaming — normal send button */
                <Button
                  onClick={handleSend}
                  disabled={!canSend}
                  size="sm"
                  className="rounded-lg px-4"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Sending
                    </>
                  ) : (
                    <>
                      Send
                      <SendHorizontal className="size-3.5" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
