import { useCallback, useEffect, useRef, useState } from "react"

/**
 * useAutoScroll — a single hook that manages the entire scroll behaviour.
 *
 * Inspired by the working demo pattern:
 *  - Scroll event listener tracks sticky (near-bottom) state via a ref
 *  - `onContent()` schedules via requestAnimationFrame so React flushes the
 *    DOM before we read scrollHeight (critical in React 18 where state
 *    updates inside event handlers are batched)
 *  - `clearBanner()` dismisses the banner when streaming ends
 *  - `jumpDown()` smoothly scrolls to bottom and re-attaches auto-scroll
 *
 * The 8px threshold on the scroll listener handles subpixel rounding.
 */
export function useAutoScroll() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sticky = useRef(true)
  const [showBanner, setShowBanner] = useState(false)

  // Scroll listener — updates sticky ref synchronously on every scroll event
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handler = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      sticky.current = atBottom
      if (atBottom) setShowBanner(false)
    }
    el.addEventListener("scroll", handler, { passive: true })
    return () => el.removeEventListener("scroll", handler)
  }, [])

  // Called on every content change. Uses rAF to ensure React has flushed
  // the DOM update before we read scrollHeight — React 18 batches state
  // updates even outside event handlers, so scrollHeight would be stale
  // without the rAF deferral. The 16ms delay is imperceptible.
  const onContent = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      if (sticky.current) {
        // Instant scroll — no smooth, no React round-trip
        el.scrollTop = el.scrollHeight
      } else {
        setShowBanner(true)
      }
    })
  }, [])

  // Dismiss the banner (call when streaming ends)
  const clearBanner = useCallback(() => setShowBanner(false), [])

  // Jump-to-bottom button: smooth scroll + re-attach auto-scroll
  const jumpDown = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    sticky.current = true
    setShowBanner(false)
  }, [])

  return { scrollRef, showBanner, onContent, clearBanner, jumpDown }
}
