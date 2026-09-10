import type { TicketApi } from './api/types.js';

/**
 * STARTER — this is the assignment.
 *
 * The scaffold, the routing dependency and the API adapter are set up for you.
 * `check:baseline` passes right now; `check:mission` does not, because the
 * features below do not exist yet.
 *
 * Build, in this order:
 *   1. a ticket list       (data-testid="ticket-list")
 *   2. a status filter     (role="combobox", accessible name "Filter by status")
 *   3. a create form       (accessible names "Summary", "Customer", "Details")
 *   4. a ticket detail view reachable at /tickets/:id
 *
 * The mission tests describe the exact behaviour expected. Read them.
 */
export interface AppProps {
  api: TicketApi;
}

export function App(_props: AppProps): JSX.Element {
  return (
    <main>
      <h1>Support desk</h1>
      <p>No tickets are shown yet. Implementing this screen is mission M01.</p>
    </main>
  );
}

export default App;
