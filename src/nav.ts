/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
}

export const nav: NavItem[] = [
  { path: '/create', label: 'Planner' },
  { path: '/routes', label: 'My Routes', roles: ['viewer', 'member', 'admin'] },
  { path: '/stats', label: 'My Runs', roles: ['viewer', 'member', 'admin'] },
  { path: '/settings', label: 'Settings', roles: ['viewer', 'member', 'admin'] },
]
