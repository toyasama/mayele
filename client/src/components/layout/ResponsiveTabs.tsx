type ResponsiveTabOption<TValue extends string> = {
  label: string
  value: TValue
}

type ResponsiveTabsProps<TValue extends string> = {
  ariaLabel: string
  className?: string
  options: ResponsiveTabOption<TValue>[]
  value: TValue
  onChange: (value: TValue) => void
}

export function ResponsiveTabs<TValue extends string>({
  ariaLabel,
  className = '',
  options,
  value,
  onChange,
}: ResponsiveTabsProps<TValue>) {
  return (
    <nav className={`responsive-tabs ${className}`.trim()} aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            className={active ? 'active' : ''}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </nav>
  )
}
