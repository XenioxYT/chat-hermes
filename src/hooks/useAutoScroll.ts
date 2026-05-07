import { useCallback, useEffect, useRef, useState } from "react"

/**
 * useAutoScroll — a single hook that manages the entire scroll behaviour.
 *
 * Inspired by the working demo pattern:
 *  - Scroll event listener tracks sticky (near-bottom) state via a ref
 *  - `onContent()` is called directly on every content change — if sticky,
 *    sets scrollTop immediately (instant, no race with tokens); if not,
 *    shows a "New messages" banner
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

  // Called on every content change (streaming chunk, user message, loaded messages)
  const onContent = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (sticky.current) {
      // Instant scroll — no smooth, no React round-trip
      el.scrollTop = el.scrollHeight
    } else {
      setShowBanner(true)
    }
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
