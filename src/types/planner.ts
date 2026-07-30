export interface PlannerTarget {
  id: string                          // catalog designation; unique in the list.
                                      // URL-encoded when used in /planner/:targetId
  name: string                        // display name: first common name, else designation
  designation: string                 // "NGC 7000"
  messier: number | null
  ra: number                          // J2000 degrees
  dec: number
  type: string
  mag: number | null
  sizeArcmin: [number, number] | null
  constellation: string
  addedAt: string                     // ISO timestamp
}

/** Validates settings-loaded data; malformed entries reject the whole array. */
export function isPlannerTargetArray(value: unknown): value is PlannerTarget[] {
  return Array.isArray(value) && value.every((t) =>
    typeof t === 'object' && t !== null
    && typeof (t as PlannerTarget).id === 'string'
    && typeof (t as PlannerTarget).name === 'string'
    && typeof (t as PlannerTarget).ra === 'number'
    && typeof (t as PlannerTarget).dec === 'number')
}
