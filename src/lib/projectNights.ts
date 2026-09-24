import type { Project } from '../types'

/** Distinct session dates across all filters — one night shot in several
 *  filters counts once. */
export function countNights(project: Pick<Project, 'filters'>): number {
  const dates = new Set<string>()
  for (const f of project.filters) {
    for (const s of f.sessions) dates.add(s.date)
  }
  return dates.size
}
