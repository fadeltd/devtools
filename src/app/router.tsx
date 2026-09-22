import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import { TOOLS } from '@/lib/registry'
import HomePage from './HomePage'
import NotFound from './NotFound'
import RootLayout from './RootLayout'

const SettingsPage = lazy(() => import('./SettingsPage'))
const LAZY = new Map(TOOLS.map((t) => [t.slug, lazy(t.load)]))

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootLayout />}>
        <Route index element={<HomePage />} />
        {TOOLS.map((tool) => {
          const Component = LAZY.get(tool.slug)!
          return <Route key={tool.slug} path={`${tool.slug}/*`} element={<Component />} />
        })}
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
