import { useCallback, useEffect, useRef, useState } from "react"

const LOG_PREFIX = "[SCROLL]"

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
        console.log(LOG_PREFIX, "sticky changed:", sticky.current, "->", atBottom, "| scrollHeight:", el.scrollHeight, "scrollTop:", el.scrollTop, "clientHeight:", el.clientHeight)
      }
      sticky.current = atBottom
      if (atBottom) setShowBanner(false)
    }
    el.addEventListener("scroll", handler, { passive: true })
    return () => el.removeEventListener("scroll", handler)
  }, [])

  // Called on every content change. Uses rAF to ensure React has flushed
  // the DOM update before we read scrollHeight — React 18 batches state
  // updates even outside event handlers, so scrollHeight would be stale
  // without the rAF deferral. The ~16ms delay is imperceptible.
  const onContent = useCallback(() => {
    console.log(LOG_PREFIX, "onContent called — sticky:", sticky.current)
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) {
        console.log(LOG_PREFIX, "onContent rAF: no element")
        return
      }
      const sh = el.scrollHeight
      console.log(LOG_PREFIX, "onContent rAF: scrollHeight:", sh, "scrollTop:", el.scrollTop, "clientHeight:", el.clientHeight, "sticky:", sticky.current)
      if (sticky.current) {
        el.scrollTop = sh
        console.log(LOG_PREFIX, "onContent rAF: SET scrollTop ->", sh)
      } else {
        console.log(LOG_PREFIX, "onContent rAF: NOT sticky — showing banner")
        setShowBanner(true)
      }
    })
  }, [])

  // Dismiss the banner (call when streaming ends)
  const clearBanner = useCallback(() => {
    console.log(LOG_PREFIX, "clearBanner")
    setShowBanner(false)
  }, [])

  // Jump-to-bottom button: smooth scroll + re-attach auto-scroll
  const jumpDown = useCallback(() => {
    const el = scrollRef.current
    console.log(LOG_PREFIX, "jumpDown — scrollHeight:", el?.scrollHeight)
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    sticky.current = true
    setShowBanner(false)
  }, [])

  return { scrollRef, showBanner, onContent, clearBanner, jumpDown }
}
