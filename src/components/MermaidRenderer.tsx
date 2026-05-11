import { memo, useEffect, useId, useState } from "react"
import { AlertTriangle, Check, Copy, GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MermaidRendererProps {
  code: string
}

function MermaidRenderer({ code }: MermaidRendererProps) {
  const reactId = useId()
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`
  const [svg, setSvg] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          flowchart: {
            htmlLabels: false,
            curve: "basis",
          },
        })
        return mermaid.render(renderId, code)
      })
      .then(({ svg }) => {
        if (cancelled) return
        setSvg(svg)
        setError("")
      })
      .catch((err) => {
        if (cancelled) return
        setSvg("")
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [code, renderId])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="my-4 overflow-hidden border-border/70 bg-card shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <GitBranch className="size-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Flowchart</CardTitle>
            <p className="text-xs text-muted-foreground">Rendered natively from Mermaid</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleCopy} title="Copy diagram source">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <div className="flex gap-3 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <pre className="m-0 whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        ) : (
          <div
            className="overflow-x-auto bg-background p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </CardContent>
    </Card>
  )
}

export default memo(MermaidRenderer)
