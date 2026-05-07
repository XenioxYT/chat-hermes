import { useState, type FormEvent } from "react"
import { Bot, Loader2, LockKeyhole } from "lucide-react"
import { login, ChatError } from "../api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface LoginPageProps {
  onLoginSuccess?: () => void
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!username.trim()) {
      setError("Username required")
      return
    }
    if (!password.trim()) {
      setError("Password required")
      return
    }

    setLoading(true)
    try {
      await login(username.trim(), password)
      onLoginSuccess?.()
    } catch (err) {
      if (err instanceof ChatError) {
        setError(err.message)
      } else {
        setError("Connection failed. Is the webchat adapter running?")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border/80 shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-3xl border border-border bg-primary/20 text-primary">
            <Bot className="size-6" />
          </div>
          <CardTitle className="text-2xl">Hermes Web Chat</CardTitle>
          <CardDescription>Sign in to message your local agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <LockKeyhole className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              autoFocus
              disabled={loading}
              className="rounded-2xl"
            />

            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              disabled={loading}
              className="rounded-2xl"
            />

            <Button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full rounded-2xl"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
