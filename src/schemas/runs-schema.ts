/**
 * Logged runs — each user's own record of a run they actually did (distinct
 * from a *planned* `routes` record). A run is an immutable historical snapshot:
 * distance/place/mode are copied in at log time, so editing or deleting a linked
 * route never rewrites history. `routeId` is a best-effort *soft* pointer — the
 * route it references may be gone, and all run-reading UI tolerates that.
 *
 * Owner-scoped exactly like `routes`: owner = the record's `createdBy`, so a
 * signed-in member sees and manages only their own runs (no `ownerField`, no
 * client-side filter — the server scopes by `createdBy`).
 */

import type { CollectionSchema } from 'deepspace/worker'

export const runsSchema: CollectionSchema = {
  name: 'runs',
  columns: [
    // Distance/time are stored in SI base units; all stats aggregate in these
    // and format once for display, so mixed-unit entries still sum correctly.
    { name: 'distanceMeters', storage: 'number', interpretation: 'plain' },
    { name: 'durationSeconds', storage: 'number', interpretation: 'plain' },
    // Local calendar date of the run, 'YYYY-MM-DD' — NOT a UTC instant, so
    // week/month bucketing stays in the user's local time.
    { name: 'date', storage: 'text', interpretation: 'plain' },
    // Unit the user entered in (mi/km) — only echoes the original entry.
    { name: 'unit', storage: 'text', interpretation: 'plain' },
    // Travel mode snapshot (foot/bike/…); pace is foot-meaningful, speed otherwise.
    { name: 'mode', storage: 'text', interpretation: 'plain' },
    // Soft, denormalized pointer to a saved route (may be deleted). Optional.
    { name: 'routeId', storage: 'text', interpretation: 'plain' },
    // Human start label, snapshotted for display. Optional.
    { name: 'place', storage: 'text', interpretation: 'plain' },
    // Free-text note. Optional.
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: 'own', delete: 'own' },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
