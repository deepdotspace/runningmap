/**
 * Gated routes. Any file under src/pages/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. Add public pages outside this folder.
 *
 * Children may call data hooks like `useUser()` safely because _app.tsx
 * mounts <RecordProvider> above this layout.
 */

import { Outlet } from 'react-router-dom'
import { AuthGate } from 'deepspace'

export default function ProtectedLayout() {
  return (
    <AuthGate>
      <Outlet />
    </AuthGate>
  )
}
