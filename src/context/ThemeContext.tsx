import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store/appStore'

interface ThemeContextValue {
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  useEffect(() => {
    // Load saved theme
    invoke<string | null>('get_setting', { key: 'theme' }).then((saved) => {
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved)
      } else {
        setTheme('dark')
      }
    })
  }, [setTheme])

  const toggleTheme = (): void => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    invoke('set_setting', { key: 'theme', value: newTheme })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
