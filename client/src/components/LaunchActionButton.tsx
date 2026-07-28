import { useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react'

type LaunchActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> & {
  label: string
  onLaunch: () => void | Promise<void>
}

const LAUNCH_ANIMATION_MS = 520

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function createLaunchBurst(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect()
  const burst = document.createElement('span')
  const fallbackRemoval = window.setTimeout(() => burst.remove(), 900)

  burst.className = 'launch-action-burst'
  burst.setAttribute('aria-hidden', 'true')
  burst.style.left = `${rect.left + rect.width / 2}px`
  burst.style.top = `${rect.top + rect.height / 2}px`
  burst.addEventListener('animationend', () => {
    window.clearTimeout(fallbackRemoval)
    burst.remove()
  }, { once: true })
  document.body.appendChild(burst)
}

export function LaunchActionButton({
  className = '',
  disabled = false,
  label,
  onLaunch,
  type = 'button',
  ...buttonProps
}: LaunchActionButtonProps) {
  const [launching, setLaunching] = useState(false)
  const launchingRef = useRef(false)
  const mountedRef = useRef(true)
  const animationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current)
    }
  }, [])

  async function handleLaunch(event: MouseEvent<HTMLButtonElement>) {
    if (disabled || launchingRef.current) return

    const reduceMotion = prefersReducedMotion()
    launchingRef.current = true
    setLaunching(true)

    if (!reduceMotion) createLaunchBurst(event.currentTarget)

    const minimumAnimation = reduceMotion
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          animationTimerRef.current = window.setTimeout(resolve, LAUNCH_ANIMATION_MS)
        })
    let actionPromise: Promise<void>

    try {
      actionPromise = Promise.resolve(onLaunch())
    } catch (error) {
      actionPromise = Promise.reject(error)
    }

    const [actionResult] = await Promise.allSettled([actionPromise, minimumAnimation])

    if (mountedRef.current) {
      launchingRef.current = false
      animationTimerRef.current = null
      setLaunching(false)
    }

    if (actionResult.status === 'rejected') throw actionResult.reason
  }

  return (
    <button
      {...buttonProps}
      className={`launch-action-button ${launching ? 'is-launching' : ''} ${className}`.trim()}
      type={type}
      disabled={disabled || launching}
      aria-busy={launching || undefined}
      onClick={(event) => void handleLaunch(event)}
    >
      <span className="launch-action-label">{label}</span>
      <span className="launch-action-icon" aria-hidden="true">→</span>
    </button>
  )
}
