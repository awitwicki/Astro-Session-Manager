// State of a group's select-all checkbox from its members' flags.
export type GroupCheckState = 'all' | 'some' | 'none'

export function groupCheckState(flags: readonly boolean[]): GroupCheckState {
  const on = flags.filter(Boolean).length
  if (on === 0) return 'none'
  return on === flags.length ? 'all' : 'some'
}
