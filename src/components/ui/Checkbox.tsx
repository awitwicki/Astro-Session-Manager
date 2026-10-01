// A checkbox that can show the "some selected" dash. Styling is the global
// input[type='checkbox'] rule; `indeterminate` exists only as a DOM property.
export function Checkbox({ checked, indeterminate = false, onChange, title, ariaLabel }: Readonly<{
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  title?: string
  ariaLabel?: string
}>) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      title={title}
      aria-label={ariaLabel}
    />
  )
}
