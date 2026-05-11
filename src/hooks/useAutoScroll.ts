import { useCallback, useEffect, useRef, useState } from "react"

/**
 * useAutoScroll — manages chat scroll behaviour.
 *
 * Scroll tracking: passive scroll listener with an 8px threshold near-bottom
 * check, using a synchronous ref (no React state dependency).
 *
 * onContent(): debounced double-rAF pattern — each new call cancels any
 * pending animation frame from a previous call. This prevents race
 * conditions during rapid streaming where multiple content chunks arrive
 * between frames. Only the latest state is read.
 *
 * jumpDown(): smooth-scrolls to bottom, then ignores scroll events for
 * 400ms to prevent the smooth scroll animation from re-setting sticky
 * to false mid-transition.
 */
export function useAutoScroll() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sticky = useRef(true)
  const [showBanner, setShowBanner] = useState(false)
  const ignoreScrollUntil = useRef(0)
  const pendingOnContent = useRef<number | null>(null)

  // Scroll listener — fires on every user/programmatic scroll event,
  // but is gated by ignoreScrollUntil for smooth-scroll transitions.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handler = () => {
      if (Date.now() < ignoreScrollUntil.current) return
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      sticky.current = atBottom
      if (atBottom) setShowBanner(false)
    }
    el.addEventListener("scroll", handler, { passive: true })
    return () => el.removeEventListener("scroll", handler)
  }, [])

  // Debounced double-rAF: cancels pending frame if onContent is called
  // again before the chain completes. Avoids reading stale DOM during
  // rapid streaming where multiple chunks arrive between animation frames.
  const onContent = useCallback(() => {
    if (pendingOnContent.current !== null) {
      cancelAnimationFrame(pendingOnContent.current)
    }
    pendingOnContent.current = requestAnimationFrame(() => {
      pendingOnContent.current = requestAnimationFrame(() => {
        pendingOnContent.current = null
        const el = scrollRef.current
        if (!el) return
        const sh = el.scrollHeight
        if (sticky.current) {
          el.scrollTop = sh
        } else {
          setShowBanner(true)
        }
      })
    })
  }, [])

  // Dismiss the banner (call when streaming ends)
  const clearBanner = useCallback(() => {
    setShowBanner(false)
  }, [])

  // Jump-to-bottom: smooth scroll + prevent scroll events from
  // overriding sticky during the smooth animation (400ms timeout).
  const jumpDown = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    sticky.current = true
    ignoreScrollUntil.current = Date.now() + 400
    setShowBanner(false)
  }, [])

  return { scrollRef, showBanner, onContent, clearBanner, jumpDown }
}
