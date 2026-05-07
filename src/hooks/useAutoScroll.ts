import { useCallback, useEffect, useRef, useState } from "react"

const LOG_PREFIX = "[SCROLL]"

/**
 * useAutoScroll — a single hook that manages the entire scroll behaviour.
 *
 * Inspired by the working demo pattern:
 *  - Scroll event listener tracks sticky (near-bottom) state via a ref
 *  - `onContent()` uses double requestAnimationFrame so React has fully
 *    flushed DOM updates and the browser has completed layout before we
 *    read scrollHeight. Single rAF was sometimes reading stale values
 *    because React 18's automatic batching delays DOM commits.
 *  - `clearBanner()` dismisses the banner when streaming ends
 *  - `jumpDown()` smoothly scrolls to bottom and re-attaches auto-scroll
 *
 * The 8px threshold handles subpixel rounding.
 */
export function useAutoScroll() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sticky = useRef(true)
  const [showBanner, setShowBanner] = useState(false)

  // Scroll listener — fires on every user/programmatic scroll event
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handler = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      if (atBottom !== sticky.current) {
        console.log(LOG_PREFIX, "sticky:", sticky.current, "->", atBottom, "| scrollHeight:", el.scrollHeight, "scrollTop:", el.scrollTop, "clientHeight:", el.clientHeight)
      }
      sticky.current = atBottom
      if (atBottom) setShowBanner(false)
    }
    el.addEventListener("scroll", handler, { passive: true })
    return () => el.removeEventListener("scroll", handler)
  }, [])

  // Called on every content change. Double rAF ensures React flushed and
  // browser laid out before we read scrollHeight. CSS scroll-behavior was
  // removed from .scroll-container because Chrome applies it even to
  // direct scrollTop assignment, causing animated scrolls.
  const onContent = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
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

  // Jump-to-bottom button: smooth scroll + re-attach auto-scroll
  const jumpDown = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    sticky.current = true
    setShowBanner(false)
  }, [])

  return { scrollRef, showBanner, onContent, clearBanner, jumpDown }
}
