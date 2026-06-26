/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/worker'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { routesSchema } from './schemas/routes-schema'
import { runsSchema } from './schemas/runs-schema'
import { prefsSchema } from './schemas/prefs-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  routesSchema,
  runsSchema,
  prefsSchema,
]
