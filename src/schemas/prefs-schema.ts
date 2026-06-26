/**
 * Per-user preferences — a single owner-scoped record per signed-in user. Right
 * now it just holds the weekly distance goal that drives the "My Runs" activity
 * ring, but it's the home for any future personal setting that should sync across
 * a user's devices (rather than living in localStorage).
 *
 * Owner-scoped exactly like `runs`/`routes`: owner = the record's `createdBy`, so
 * a member reads and writes only their own prefs (no `ownerField`, no client-side
 * filter — the server scopes by `createdBy`).
 */

import type { CollectionSchema } from 'deepspace/worker'

export const prefsSchema: CollectionSchema = {
  name: 'prefs',
  columns: [
    // Weekly distance goal in SI base units (metres), matching how runs store
    // distance. The UI converts to/from the user's chosen unit for display.
    { name: 'weeklyGoalMeters', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: 'own', delete: 'own' },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
