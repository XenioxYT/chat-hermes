import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Check, Code2, Copy, Maximize2, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

interface ArtifactRendererProps {
  code: string
  language: string
  /** Called when user clicks "open in sidebar".  Passes code + language. */
  onSidebar?: (code: string, language: string) => void
}

function safeScriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

function buildReactSrcdoc(code: string): string {
  const source = safeScriptLiteral(code)

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light;
      font-family: Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif;
      --background: oklch(0.9940 0 0);
      --foreground: oklch(0 0 0);
      --card: oklch(0.9940 0 0);
      --muted: oklch(0.9702 0 0);
      --muted-foreground: oklch(0.4386 0 0);
      --primary: oklch(0.8833 0.2282 147.0345);
      --border: oklch(0.9401 0 0);
      --radius: 1.4rem;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: transparent; color: var(--foreground); }
    #root { min-height: 80px; padding: 16px; }
    button, input, select, textarea {
      font: inherit;
      border-radius: calc(var(--radius) - 4px);
    }
    button {
      border: 1px solid var(--border);
      background: var(--primary);
      color: black;
      padding: 0.5rem 0.8rem;
      cursor: pointer;
    }
    .artifact-error {
      border: 1px solid oklch(0.7106 0.2415 342.3498 / 0.4);
      border-radius: var(--radius);
      color: oklch(0.7106 0.2415 342.3498);
      padding: 12px;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div id="root">Loading artifact...</div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://unpkg.com/recharts/umd/Recharts.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
  <script>
    const SOURCE = ${source};

    function postHeight() {
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        120
      );
      window.parent.postMessage({ type: "hermes-artifact-height", height }, "*");
    }

    function normaliseReactSource(input) {
      let componentName = "Artifact";
      let src = String(input || "");

      src = src.replace(/import\\s+React\\s*,?\\s*(?:\\{[^}]*\\})?\\s*from\\s*["']react["'];?/g, "");
      src = src.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s*["']react["'];?/g, "");
      src = src.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s*["']recharts["'];?/g, "var {$1} = window.Recharts || {};");
      src = src.replace(/import\\s+\\*\\s+as\\s+d3\\s+from\\s*["']d3["'];?/g, "var d3 = window.d3;");
      src = src.replace(/import\\s+[^;]+;?/g, "");

      const namedDefault = src.match(/export\\s+default\\s+function\\s+([A-Za-z_$][\\w$]*)/);
      if (namedDefault) {
        componentName = namedDefault[1];
        src = src.replace(/export\\s+default\\s+function\\s+([A-Za-z_$][\\w$]*)/, "function $1");
      } else if (/export\\s+default\\s+function\\s*\\(/.test(src)) {
        src = src.replace(/export\\s+default\\s+function\\s*\\(/, "function Artifact(");
      } else {
        const identifierDefault = src.match(/export\\s+default\\s+([A-Za-z_$][\\w$]*)\\s*;?/);
        if (identifierDefault) {
          componentName = identifierDefault[1];
          src = src.replace(/export\\s+default\\s+[A-Za-z_$][\\w$]*\\s*;?/, "");
        } else if (/export\\s+default\\s*\\(/.test(src)) {
          src = src.replace(/export\\s+default\\s*\\(/, "const Artifact = (");
        } else if (/export\\s+default\\s*/.test(src)) {
          src = src.replace(/export\\s+default\\s*/, "const Artifact = ");
        }
      }

      if (componentName === "Artifact" && !/(function|const|let|var)\\s+Artifact\\b/.test(src)) {
        const functionCandidates = Array.from(src.matchAll(/function\\s+([A-Z][A-Za-z0-9_$]*)\\s*\\(/g)).map(match => match[1]);
        const constCandidates = Array.from(src.matchAll(/(?:const|let|var)\\s+([A-Z][A-Za-z0-9_$]*)\\s*=/g)).map(match => match[1]);
        const candidates = functionCandidates.concat(constCandidates);
        if (candidates.length) {
          componentName = candidates[candidates.length - 1];
        }
      }

      // Use var instead of const/let for the injected prelude so that
      // duplicate declarations from the artifact code (e.g. "const Recharts"
      // in a recharts import) don't throw "already declared" errors.
      const prelude = [
        "var { useState, useEffect, useMemo, useRef, useCallback, Fragment } = React;",
        "var Recharts = window.Recharts || {};",
        "var d3 = window.d3;",
      ].join("\\n");

      return { code: prelude + "\\n" + src, componentName };
    }

    function showError(error) {
      const root = document.getElementById("root");
      root.innerHTML = "";
      const box = document.createElement("pre");
      box.className = "artifact-error";
      box.textContent = error && error.stack ? error.stack : String(error);
      root.appendChild(box);
      postHeight();
    }

    function render() {
      try {
        if (!window.React || !window.ReactDOM || !window.Babel) {
          throw new Error("Artifact runtime failed to load.");
        }

        const normalized = normaliseReactSource(SOURCE);
        const transformed = Babel.transform(normalized.code, {
          presets: ["react", "typescript"],
          filename: "artifact.tsx",
        }).code;

        const Component = new Function(
          "ReactDOM",
          "Recharts",
          "d3",
          transformed + "\\nreturn " + normalized.componentName + ";"
        )(window.ReactDOM, window.Recharts || {}, window.d3);

        const root = ReactDOM.createRoot(document.getElementById("root"));
        root.render(React.createElement(Component));
        setTimeout(postHeight, 50);
        setTimeout(postHeight, 250);
      } catch (error) {
        showError(error);
      }
    }

    window.addEventListener("error", (event) => showError(event.error || event.message));
    window.addEventListener("unhandledrejection", (event) => showError(event.reason));
    window.addEventListener("load", render);
    new ResizeObserver(postHeight).observe(document.documentElement);
    new MutationObserver(postHeight).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  </script>
</body>
</html>`
}

function buildHtmlSrcdoc(code: string): string {
  const postHeightScript = `<script>
function postHeight(){window.parent.postMessage({type:"hermes-artifact-height",height:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight,120)},"*")}
window.addEventListener("load",postHeight);
new ResizeObserver(postHeight).observe(document.documentElement);
new MutationObserver(postHeight).observe(document.documentElement,{childList:true,subtree:true,attributes:true});
setTimeout(postHeight,100);
<\/script>`

  if (/<html[\s>]/i.test(code)) {
    return code.replace(/<\/body>/i, `${postHeightScript}</body>`)
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>body{margin:0;background:transparent;font-family:Plus Jakarta Sans,Inter,system-ui,sans-serif}</style>
</head>
<body>
${code}
${postHeightScript}
</body>
</html>`
}

function ArtifactRenderer({ code, language, onSidebar }: ArtifactRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(360)
  const [copied, setCopied] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [settledCode, setSettledCode] = useState("")
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCodeRef = useRef("")
  const normalizedLanguage = language.toLowerCase()
  const isHtml = normalizedLanguage === "html"

  // Stable code comparison: only restart the debounce when the code string
  // has actually changed (deep string equality), not just on reference
  // changes.  react-markdown creates a new string on every parent render,
  // so reference-only checks (memo) are insufficient.
  useEffect(() => {
    if (code === lastCodeRef.current) return  // stable string, skip
    lastCodeRef.current = code

    setShowSkeleton(true)
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      setSettledCode(code)
      setShowSkeleton(false)
    }, 400)
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    }
  }, [code])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    }
  }, [])

  const srcDoc = useMemo(
    () => (isHtml ? buildHtmlSrcdoc(settledCode) : buildReactSrcdoc(settledCode)),
    [settledCode, isHtml],
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === "hermes-artifact-height") {
        setHeight(Math.min(Math.max(Number(event.data.height) || 360, 160), 900))
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="my-4 overflow-hidden border-border/70 bg-card shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/20 text-primary">
            <Code2 className="size-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Interactive artifact</CardTitle>
            <p className="text-xs text-muted-foreground">
              {showSkeleton ? "Generating..." : `Sandboxed ${isHtml ? "HTML" : "React"} render`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={handleCopy} title="Copy artifact code">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onSidebar?.(code, language)}
            title="Open in sidebar"
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {showSkeleton ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            title="Hermes interactive artifact"
            className="artifact-frame w-full bg-background"
            sandbox="allow-scripts allow-downloads allow-popups"
            allow="clipboard-write *; fullscreen *"
            srcDoc={srcDoc}
            style={{ height }}
          />
        )}
      </CardContent>
    </Card>
  )
}

export default memo(ArtifactRenderer)
