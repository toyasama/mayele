import type { HTMLAttributes, ReactNode } from 'react'

type ActionBarProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  sticky?: boolean
}

export function ActionBar({ children, className = '', sticky = false, ...props }: ActionBarProps) {
  return (
    <div className={`action-bar ${sticky ? 'action-bar-sticky' : ''} ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
