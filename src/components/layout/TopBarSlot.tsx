import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The TopBar's right-hand actions container. AppShell owns the element and
// hands it down; pages portal their header controls into it.
const TopBarSlotContext = createContext<HTMLElement | null>(null)

export function TopBarSlotProvider({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  return <TopBarSlotContext.Provider value={slot}>{children}</TopBarSlotContext.Provider>
}

/** Renders a page's header controls in the app TopBar, next to the breadcrumb. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarSlotContext)
  return slot ? createPortal(children, slot) : null
}
