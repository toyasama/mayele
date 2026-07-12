import type { HTMLAttributes, ReactNode } from 'react'

type PageFrameProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode
  surface?: 'default' | 'narrow' | 'wide'
}

export function PageFrame({ children, className = '', surface = 'default', ...props }: PageFrameProps) {
  return (
    <section className={`page page-frame page-frame-${surface} ${className}`.trim()} {...props}>
      {children}
    </section>
  )
}
