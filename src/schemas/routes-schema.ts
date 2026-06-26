/**
 * Saved routes — each user's own named routes. The route itself is stored as
 * the same compact `?r=` share string the URL uses, so loading is just a
 * redirect into the planner. Owner-scoped: a signed-in member sees and manages
 * only their own routes.
 */

import type { CollectionSchema } from 'deepspace/worker'

export const routesSchema: CollectionSchema = {
  name: 'routes',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'encoded', storage: 'text', interpretation: 'plain' },
    { name: 'distanceMeters', storage: 'number', interpretation: 'plain' },
    { name: 'durationSeconds', storage: 'number', interpretation: 'plain' },
    { name: 'unit', storage: 'text', interpretation: 'plain' },
    // Encoded snapped polyline → drives the route-shape thumbnail.
    { name: 'shape', storage: 'text', interpretation: 'plain' },
    // Primary travel mode (foot/bike/car/manual).
    { name: 'mode', storage: 'text', interpretation: 'plain' },
    // Human place label for where the route starts (best-effort).
    { name: 'place', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: 'own', delete: 'own' },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
