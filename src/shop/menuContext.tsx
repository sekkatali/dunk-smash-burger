import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useMenu } from '../lib/menu'

type Ctx = ReturnType<typeof useMenu>
const MenuContext = createContext<Ctx | null>(null)

export function ShopMenuProvider({ children }: { children: ReactNode }) {
  const value = useMenu()
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>
}

export function useShopMenu(): Ctx {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('useShopMenu hors ShopMenuProvider')
  return ctx
}
