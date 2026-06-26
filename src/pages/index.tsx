import { Navigate } from 'react-router-dom'

/** The planner is the app's home. */
export default function Index() {
  return <Navigate to="/create" replace />
}
