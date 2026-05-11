/**
 * MarkdownRenderer
 *
 * A comprehensive markdown rendering component that handles:
 * - GitHub Flavored Markdown (tables, task lists, strikethrough, etc.)
 * - LaTeX math (inline with $...$ and block with $$...$$)
 * - Syntax-highlighted code blocks with copy buttons
 * - Standard formatting (bold, italic, links, images)
 *
 * Built on react-markdown with extension plugins for GFM and math.
 * Code highlighting uses react-syntax-highlighter with a dark theme.
 *
 * To add new rendering capabilities (charts, interactive components, etc.),
 * create a new custom component and add it to the components map below.
 */

import React, { useState, useRef, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Copy, Check } from "lucide-react"
import ArtifactRenderer from "./ArtifactRenderer"
import MermaidRenderer from "./MermaidRenderer"
import { cn } from "@/lib/utils"

// Import KaTeX CSS for math rendering
import "katex/dist/katex.min.css"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarkdownRendererProps {
  /** The markdown content to render */
  content: string
  /** Called when an artifact sidebar button is clicked */
  onArtifactSidebar?: (code: string, language: string) => void
}

function normalizeFenceLanguage(className?: string): string {
  const match = /language-([^\s]+)/.exec(className || "")
  return match ? match[1].toLowerCase() : ""
}

function normalizeArtifactLanguage(language: string): string | null {
  const normalized = language.replace(/:/g, "-")
  if (["artifact", "artifact-react", "artifact-tsx", "artifact-jsx", "artifact-shadcn"].includes(normalized)) {
    return "artifact-react"
  }
  if (["artifact-html"].includes(normalized)) {
    return "artifact-html"
  }
  return null
}

// ---------------------------------------------------------------------------
// Custom code block component with copy button
// ---------------------------------------------------------------------------

/**
 * CodeBlock renders a fenced code block with syntax highlighting and a
 * copy-to-clipboard button. Uses Prism.js via react-syntax-highlighter
 * with the One Dark theme for consistency with the dark UI.
 */
function CodeBlock({
  className,
  children,
  ...props
}: {
  className?: string
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  // Extract the language from the className (e.g., "language-python")
  const language = normalizeFenceLanguage(className)
  const code = String(children).replace(/\n$/, "")

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      {/* Header bar showing language and copy button */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>{language || "code"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs opacity-0 transition-opacity hover:bg-muted/70 group-hover:opacity-100"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-500">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Syntax-highlighted code */}
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          style={oneDark}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            padding: "1rem",
            fontSize: "0.875rem",
            lineHeight: "1.5",
          }}
          {...props}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline code component
// ---------------------------------------------------------------------------

function InlineCode(props: { children?: React.ReactNode }) {
  const text = String(props.children ?? "")
  // Strip any number of leading/trailing backtick characters that may leak
  // from the markdown parser. react-markdown should already deliver clean
  // content, but some edge cases (nested backticks, escaped delimiters) can
  // pass backticks through.
  const cleaned = text.replace(/^`+/, "").replace(/`+$/, "")
  return (
    <code
      className="rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[0.9em] font-mono text-foreground/90"
    >
      {cleaned}
    </code>
  )
}

// ---------------------------------------------------------------------------
// Table components with copy-markdown button and improved readability
// ---------------------------------------------------------------------------

function Table({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)

  const handleCopyMarkdown = useCallback(() => {
    const el = tableRef.current?.querySelector("table")
    if (!el) return

    const rows = el.querySelectorAll("tr")
    if (rows.length === 0) return

    const lines: string[] = []
    let columnCount = 0

    rows.forEach((row, rowIdx) => {
      const cells = row.querySelectorAll("th, td")
      const cellTexts: string[] = []
      cells.forEach((cell) => {
        // Get text content, clean up whitespace
        const text = (cell.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
        cellTexts.push(text)
      })
      columnCount = Math.max(columnCount, cellTexts.length)

      if (rowIdx === 0) {
        // Header row
        lines.push("| " + cellTexts.join(" | ") + " |")
        // Separator row
        lines.push(
          "|" +
            cellTexts
              .map(() => " --- ")
              .join("|") +
            "|",
        )
      } else {
        lines.push("| " + cellTexts.join(" | ") + " |")
      }
    })

    const markdown = lines.join("\n")
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Clipboard not available
    })
  }, [])

  return (
    <div className="group relative my-4">
      <div ref={tableRef} className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-sm">
        <table className="w-full border-collapse text-sm" role="table">
          {children}
        </table>
      </div>
      <button
        onClick={handleCopyMarkdown}
        className={cn(
          "absolute right-2 top-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "border border-border/50 bg-background/80 backdrop-blur-sm",
          "hover:bg-accent",
        )}
        title="Copy table as markdown"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-green-500" />
            <span className="text-green-500">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            <span>Copy markdown</span>
          </>
        )}
      </button>
    </div>
  )
}

function TableHead(props: { children?: React.ReactNode }) {
  return (
    <thead className="bg-muted/40">{props.children}</thead>
  )
}

function TableRow(props: { children?: React.ReactNode }) {
  return (
    <tr className="border-b border-border/40 transition-colors hover:bg-muted/20" {...props} />
  )
}

function TableCell({
  isHeader,
  children,
  ...props
}: {
  isHeader?: boolean
  children?: React.ReactNode
}) {
  const Tag = isHeader ? "th" : "td"
  return (
    <Tag
      className={cn(
        "px-4 py-3 text-left",
        isHeader
          ? "text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          : "text-sm leading-relaxed text-foreground/90",
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

// ---------------------------------------------------------------------------
// Link component (opens in new tab)
// ---------------------------------------------------------------------------

function Link({
  href,
  children,
  ...props
}: {
  href?: string
  children?: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary/70"
      {...props}
    >
      {children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// Task list item (checkbox)
// ---------------------------------------------------------------------------

function TaskListItem({
  checked,
  children,
  ...props
}: {
  checked?: boolean
  children?: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2" {...props}>
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mt-1 h-4 w-4 rounded border-border bg-muted text-primary"
      />
      <span>{children}</span>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * MarkdownRenderer is the core rendering component.
 *
 * It takes markdown text and renders it using react-markdown with custom
 * components for code blocks, tables, links, and more.
 *
 * To add interactive components (Phase 2):
 * 1. Create your component (e.g., ChartRenderer, CodePlayground)
 * 2. Add it to the components map below with a custom tag or syntax
 * 3. The markdown parser will call your component when it encounters
 *    the matching syntax
 *
 * Example Phase 2 addition:
 * ```
 * components={{
 *   ...components,
 *   // Custom syntax: ```chart {data: [...]}
 *   code: ({ className, children }) => {
 *     if (className?.includes("language-chart")) {
 *       return <ChartRenderer data={parse(children)} />
 *     }
 *     return <CodeBlock className={className}>{children}</CodeBlock>
 *   }
 * }}
 * ```
 */
export default function MarkdownRenderer({ content, onArtifactSidebar }: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown
        // Plugins: GFM adds tables, strikethrough, task lists, etc.
        // Math plugins add $...$ and $$...$$ LaTeX support
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          // Code blocks with syntax highlighting
          code({ className, children, ...props }) {
            const language = normalizeFenceLanguage(className)
            const code = String(children).replace(/\n$/, "")
            if (["mermaid", "flowchart", "diagram"].includes(language)) {
              return <MermaidRenderer code={code} />
            }
            const artifactLanguage = normalizeArtifactLanguage(language)
            if (artifactLanguage) {
              return <ArtifactRenderer code={code} language={artifactLanguage} onSidebar={onArtifactSidebar} />
            }
            // Fenced code blocks have a className; inline code doesn't
            return language ? (
              <CodeBlock className={className} {...props}>
                {children}
              </CodeBlock>
            ) : (
              <InlineCode {...props}>{children}</InlineCode>
            )
          },

          // Tables with styled borders
          table: Table,
          thead: TableHead,
          tr: TableRow,
          th: (props) => <TableCell isHeader {...props} />,
          td: (props) => <TableCell {...props} />,

          // Links open in new tab
          a: Link,

          // Task list items with native checkboxes
          input: (props) => {
            if (props?.type === "checkbox") {
              return (
                <TaskListItem checked={props.checked}>
                  {/* Children rendered by the parent li */}
                </TaskListItem>
              )
            }
            return <input {...props} />
          },

          // Standard HTML elements with minimal styling overrides
          // All base styles come from Tailwind's prose plugin
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
