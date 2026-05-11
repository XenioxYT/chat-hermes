import { memo, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, Code2, Copy, Maximize2, PanelRightOpen, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type ArtifactKind = "react" | "html"

interface ArtifactRendererProps {
  code: string
  language: string
  onSidebar?: (code: string, language: string) => void
}

function safeScriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

function normalizeArtifactKind(language: string): ArtifactKind {
  const normalized = language.toLowerCase().replace(/:/g, "-")
  if (normalized.includes("html")) return "html"
  return "react"
}

function artifactStyles(): string {
  return `
    :root {
      color-scheme: light;
      --background: #fbfbfb;
      --foreground: #0a0a0a;
      --card: #ffffff;
      --card-foreground: #0a0a0a;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --primary: #22c55e;
      --primary-foreground: #052e16;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --border: #e4e4e7;
      --input: #e4e4e7;
      --destructive: #ef4444;
      --radius: 16px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: transparent; color: var(--foreground); }
    #root { min-height: 120px; padding: 16px; }
    a { color: inherit; }
    button, input, textarea, select { font: inherit; }
    .artifact-error {
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: var(--radius);
      color: var(--destructive);
      background: rgba(239, 68, 68, 0.06);
      padding: 12px;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
    }
    .artifact-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      color: var(--card-foreground);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    .artifact-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 34px;
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 0 12px;
      background: var(--primary);
      color: var(--primary-foreground);
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: filter 120ms ease, transform 80ms ease;
    }
    .artifact-button:hover { filter: brightness(0.97); }
    .artifact-button:active { transform: translateY(1px); }
    .artifact-button.secondary {
      border-color: var(--border);
      background: var(--secondary);
      color: var(--secondary-foreground);
    }
    .artifact-input {
      height: 36px;
      width: 100%;
      border: 1px solid var(--input);
      border-radius: 10px;
      background: white;
      color: var(--foreground);
      padding: 0 10px;
      outline: none;
    }
    .artifact-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16); }
  `
}

function buildSharedRuntimeScript(targetOrigin: string): string {
  return `
    const TARGET_ORIGIN = ${safeScriptLiteral(targetOrigin)};
    function postHeight() {
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        160
      );
      window.parent.postMessage({ type: "hermes-artifact-height", height }, TARGET_ORIGIN);
    }
    function showError(error) {
      const root = document.getElementById("root");
      if (!root) return;
      root.innerHTML = "";
      const box = document.createElement("pre");
      box.className = "artifact-error";
      box.textContent = error && error.stack ? error.stack : String(error);
      root.appendChild(box);
      postHeight();
    }
    window.addEventListener("error", (event) => showError(event.error || event.message));
    window.addEventListener("unhandledrejection", (event) => showError(event.reason));
    window.addEventListener("load", () => {
      postHeight();
      setTimeout(postHeight, 100);
      setTimeout(postHeight, 350);
    });
    new ResizeObserver(postHeight).observe(document.documentElement);
    new MutationObserver(postHeight).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  `
}

function buildShadcnRuntime(): string {
  return `
    function cx() {
      return Array.from(arguments).filter(Boolean).join(" ");
    }
    function makeIcon(name) {
      return function Icon(props) {
        props = props || {};
        return React.createElement("span", {
          ...props,
          title: props.title || name,
          "aria-hidden": props["aria-hidden"] ?? true,
          style: {
            display: "inline-flex",
            width: props.size || "1em",
            height: props.size || "1em",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "999px",
            background: "currentColor",
            opacity: 0.72,
            ...props.style
          }
        });
      };
    }
    const Icons = new Proxy({}, { get: (_target, name) => makeIcon(String(name)) });
    function Button(props) {
      const { className, variant, children, ...rest } = props || {};
      return React.createElement("button", {
        className: cx("artifact-button", variant === "secondary" || variant === "outline" || variant === "ghost" ? "secondary" : "", className),
        ...rest
      }, children);
    }
    function Card(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("div", { className: cx("artifact-card", className), ...rest }, children);
    }
    function CardHeader(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("div", { className: cx("p-4", className), style: { padding: 16, borderBottom: "1px solid var(--border)", ...(props && props.style) }, ...rest }, children);
    }
    function CardTitle(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("div", { className, style: { fontSize: 16, fontWeight: 700, lineHeight: 1.2, ...(props && props.style) }, ...rest }, children);
    }
    function CardDescription(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("p", { className, style: { margin: "6px 0 0", color: "var(--muted-foreground)", fontSize: 13, ...(props && props.style) }, ...rest }, children);
    }
    function CardContent(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("div", { className, style: { padding: 16, ...(props && props.style) }, ...rest }, children);
    }
    function Badge(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("span", {
        className,
        style: {
          display: "inline-flex",
          alignItems: "center",
          border: "1px solid var(--border)",
          borderRadius: 999,
          padding: "2px 8px",
          fontSize: 12,
          fontWeight: 600,
          background: "var(--muted)",
          color: "var(--secondary-foreground)",
          ...(props && props.style)
        },
        ...rest
      }, children);
    }
    function Input(props) {
      const { className, ...rest } = props || {};
      return React.createElement("input", { className: cx("artifact-input", className), ...rest });
    }
    function Textarea(props) {
      const { className, ...rest } = props || {};
      return React.createElement("textarea", { className: cx("artifact-input", className), style: { minHeight: 88, paddingTop: 8, ...(props && props.style) }, ...rest });
    }
    function Tabs(props) {
      const { children, defaultValue } = props || {};
      const [value, setValue] = React.useState(defaultValue || "");
      return React.createElement(TabsContext.Provider, { value: { value, setValue } }, children);
    }
    const TabsContext = React.createContext({ value: "", setValue: function() {} });
    function TabsList(props) {
      const { className, children, ...rest } = props || {};
      return React.createElement("div", {
        className,
        style: { display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--muted)", ...(props && props.style) },
        ...rest
      }, children);
    }
    function TabsTrigger(props) {
      const ctx = React.useContext(TabsContext);
      const { value, className, children, ...rest } = props || {};
      const active = ctx.value === value;
      return React.createElement("button", {
        className,
        onClick: () => ctx.setValue(value),
        style: {
          border: 0,
          borderRadius: 8,
          padding: "6px 10px",
          background: active ? "white" : "transparent",
          color: active ? "var(--foreground)" : "var(--muted-foreground)",
          cursor: "pointer",
          ...(props && props.style)
        },
        ...rest
      }, children);
    }
    function TabsContent(props) {
      const ctx = React.useContext(TabsContext);
      const { value, children, ...rest } = props || {};
      if (ctx.value !== value) return null;
      return React.createElement("div", rest, children);
    }
    const Shadcn = {
      Button,
      Card,
      CardHeader,
      CardTitle,
      CardDescription,
      CardContent,
      Badge,
      Input,
      Textarea,
      Tabs,
      TabsList,
      TabsTrigger,
      TabsContent
    };
  `
}

function buildReactSrcdoc(code: string, targetOrigin: string): string {
  const source = safeScriptLiteral(code)

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${artifactStyles()}</style>
</head>
<body>
  <div id="root">Loading artifact...</div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://unpkg.com/recharts/umd/Recharts.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
  <script>
    ${buildSharedRuntimeScript(targetOrigin)}
    const SOURCE = ${source};
    ${buildShadcnRuntime()}

    function normalizeReactSource(input) {
      let componentName = "Artifact";
      let src = String(input || "");

      src = src.replace(/import\\s+React\\s*,?\\s*(?:\\{[^}]*\\})?\\s*from\\s*["']react["'];?/g, "");
      src = src.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s*["']react["'];?/g, "");
      src = src.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s*["']recharts["'];?/g, "var {$1} = window.Recharts || {};");
      src = src.replace(/import\\s+\\*\\s+as\\s+d3\\s+from\\s*["']d3["'];?/g, "var d3 = window.d3;");
      src = src.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s*["'](?:@\\/components\\/ui\\/[\\w-]+|shadcn|@hermes\\/ui)["'];?/g, "var {$1} = Shadcn;");
      src = src.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s*["']lucide-react["'];?/g, "var {$1} = Icons;");
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
        if (candidates.length) componentName = candidates[candidates.length - 1];
      }

      const prelude = [
        "var { useState, useEffect, useMemo, useRef, useCallback, Fragment } = React;",
        "var Recharts = window.Recharts || {};",
        "var d3 = window.d3;"
      ].join("\\n");

      return { code: prelude + "\\n" + src, componentName };
    }

    function render() {
      try {
        if (!window.React || !window.ReactDOM || !window.Babel) {
          throw new Error("Artifact runtime failed to load.");
        }
        const normalized = normalizeReactSource(SOURCE);
        const transformed = Babel.transform(normalized.code, {
          presets: ["react", "typescript"],
          filename: "artifact.tsx"
        }).code;
        const Component = new Function(
          "React",
          "ReactDOM",
          "Recharts",
          "d3",
          "Shadcn",
          "Icons",
          transformed + "\\nreturn " + normalized.componentName + ";"
        )(window.React, window.ReactDOM, window.Recharts || {}, window.d3, Shadcn, Icons);
        const mount = document.getElementById("root");
        if (ReactDOM.createRoot) {
          ReactDOM.createRoot(mount).render(React.createElement(Component));
        } else {
          ReactDOM.render(React.createElement(Component), mount);
        }
        setTimeout(postHeight, 50);
        setTimeout(postHeight, 250);
      } catch (error) {
        showError(error);
      }
    }
    window.addEventListener("load", render);
  </script>
</body>
</html>`
}

function buildHtmlSrcdoc(code: string, targetOrigin: string): string {
  const helperScript = `<script>${buildSharedRuntimeScript(targetOrigin)}<\/script>`

  if (/<html[\s>]/i.test(code)) {
    if (/<\/head>/i.test(code)) {
      code = code.replace(/<\/head>/i, `<style>${artifactStyles()}</style></head>`)
    }
    return code.replace(/<\/body>/i, `${helperScript}</body>`)
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${artifactStyles()}</style>
</head>
<body>
${code}
${helperScript}
</body>
</html>`
}

function ArtifactRenderer({ code, language, onSidebar }: ArtifactRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(360)
  const [copied, setCopied] = useState(false)
  const [readyCode, setReadyCode] = useState("")
  const [isPreparing, setIsPreparing] = useState(true)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetOrigin = typeof window === "undefined" ? "*" : window.location.origin
  const kind = normalizeArtifactKind(language)
  const label = kind === "html" ? "HTML artifact" : "React artifact"

  useEffect(() => {
    setIsPreparing(true)
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      setReadyCode(code)
      setIsPreparing(false)
    }, 180)
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    }
  }, [code])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === "hermes-artifact-height") {
        setHeight(Math.min(Math.max(Number(event.data.height) || 360, 180), 960))
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const srcDoc = useMemo(
    () => kind === "html"
      ? buildHtmlSrcdoc(readyCode, targetOrigin)
      : buildReactSrcdoc(readyCode, targetOrigin),
    [readyCode, kind, targetOrigin],
  )

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card className="my-4 overflow-hidden border-border/70 bg-card shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/70 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Play className="size-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Interactive artifact</CardTitle>
            <p className="text-xs text-muted-foreground">
              {isPreparing ? "Preparing sandbox..." : `${label} with shadcn-style components`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={handleCopy} title="Copy artifact source">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => iframeRef.current?.requestFullscreen?.()} title="Fullscreen preview">
            <Maximize2 className="size-4" />
          </Button>
          {onSidebar && (
            <Button variant="ghost" size="icon-sm" onClick={() => onSidebar(code, language)} title="Open in sidebar">
              <PanelRightOpen className="size-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isPreparing ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        ) : (
          <Tabs defaultValue="preview" className="w-full">
            <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
              <TabsList className="h-8">
                <TabsTrigger value="preview" className="h-6 text-xs">Preview</TabsTrigger>
                <TabsTrigger value="source" className="h-6 text-xs">Source</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Code2 className="size-3" />
                {label}
              </div>
            </div>
            <TabsContent value="preview" className="m-0">
              <iframe
                ref={iframeRef}
                title="Hermes interactive artifact"
                className="artifact-frame w-full bg-background"
                sandbox="allow-scripts"
                allow="clipboard-write *; fullscreen *"
                srcDoc={srcDoc}
                style={{ height }}
              />
            </TabsContent>
            <TabsContent value="source" className="m-0">
              <pre className="max-h-[520px] overflow-auto bg-muted/20 p-4 text-xs leading-5">
                <code>{code}</code>
              </pre>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}

export default memo(ArtifactRenderer)
