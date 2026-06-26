/**
 * Floating top nav — brand + primary links grouped in one left "title" pill,
 * with the role badge / account (profile) in a separate right pill.
 *
 * Rendered as two fixed glass clusters that hug the top corners (not a
 * full-width bar), so they float over the full-bleed map and share the planner's
 * panel language. The page links live with the brand on the left (one block);
 * the right pill is reserved for identity (profile) so a page can drop its own
 * controls — e.g. the planner's search box — alongside it on the right. Nav
 * links stay one-tap on desktop (hamburger only below lg). Sign-in (AuthOverlay),
 * sign-out, avatar, role badge and the mobile menu are wired to the SDK /
 * `src/nav.ts` — add nav items there, not here.
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth, AuthOverlay, useUser, signOut } from 'deepspace'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { ROLE_CONFIG, type Role } from '../constants'
import { nav } from '../nav'
import { Brand } from './Brand'
import { cn } from './ui/utils'

/** Shared floating-glass recipe — keep in sync with the planner panels. */
const GLASS = 'rounded-2xl border border-border bg-card/80 shadow-lg backdrop-blur-md'

export default function Navigation() {
  const { isSignedIn } = useAuth()
  const { user } = useUser()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const userRole = (user?.role ?? 'anonymous') as Role | 'anonymous'
  const roleConfig =
    ROLE_CONFIG[userRole as Role] ?? { title: 'Anonymous', badgeVariant: 'secondary' }

  // Close any open menus when navigating.
  useEffect(() => {
    setMobileMenuOpen(false)
    setUserMenuOpen(false)
  }, [location.pathname])

  const visibleNav = nav.filter((item) => {
    if (!item.roles) return true
    if (userRole === 'admin') return true
    return item.roles.includes(userRole as Role)
  })

  return (
    <>
      {/* Full-width row, pointer-events-none so the map stays interactive
          between the two corner clusters. */}
      <div className="pointer-events-none fixed inset-x-3 top-3 z-50 flex items-start justify-between gap-3">
        {/* Title block (left): brand + page links together */}
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <nav
            data-testid="app-navigation"
            className={cn('flex items-center gap-1 p-1.5 pl-3', GLASS)}
          >
            <Link
              to="/create"
              aria-label="runningmap home"
              className="flex items-center pr-1"
            >
              <Brand />
            </Link>

            <div className="mx-1 hidden h-6 w-px bg-border lg:block" />

            {/* Primary nav (desktop) */}
            <div className="hidden items-center gap-0.5 lg:flex">
              {visibleNav.map((item) => {
                const active = location.pathname.startsWith(item.path)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-150',
                      active
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>

            {/* Mobile menu toggle (links collapse below lg) */}
            <button
              className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Menu className="h-4 w-4" aria-hidden />
              )}
            </button>
          </nav>

          {/* Mobile links dropdown — stacks under the title block */}
          {mobileMenuOpen && (
            <div className={cn('w-56 p-1.5 lg:hidden', GLASS)}>
              {visibleNav.map((item) => {
                const active = location.pathname.startsWith(item.path)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Profile (right): role badge + account */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className={cn('flex items-center gap-1 p-1.5', GLASS)}>
            <span
              data-testid="nav-role-badge"
              className={cn(
                'hidden items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium sm:inline-flex',
                roleConfig.badgeVariant === 'warning'
                  ? 'bg-warning/15 text-warning ring-1 ring-inset ring-warning/30'
                  : roleConfig.badgeVariant === 'default'
                    ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/30'
                    : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border',
              )}
            >
              {roleConfig.title}
            </span>

            {isSignedIn && user ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  className="group flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5 text-sm transition-colors hover:border-border hover:bg-card"
                >
                  <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-inset ring-border">
                    {user.imageUrl ? (
                      <img
                        src={user.imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      (user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()
                    )}
                  </span>
                  <span
                    data-testid="nav-user-name"
                    className="hidden max-w-[120px] truncate text-foreground sm:inline"
                  >
                    {user.name || user.email}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-muted-foreground transition-transform duration-150',
                      userMenuOpen && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>
                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                      aria-hidden
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_8px_-2px_rgba(0,0,0,0.10)]"
                    >
                      <div className="border-b border-border px-3 py-2.5">
                        <div className="truncate text-sm font-medium text-foreground">
                          {user.name || 'Signed in'}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setUserMenuOpen(false)
                          signOut()
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                data-testid="nav-sign-in-button"
                onClick={() => setShowAuthModal(true)}
                className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </>
  )
}
