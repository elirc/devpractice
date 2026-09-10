import { useCallback, useEffect, useState } from 'react';
import {
  TicketValidationError,
  type CreateTicketInput,
  type Ticket,
  type TicketApi,
  type TicketStatus,
} from './api/types.js';
import { hasErrors, validateTicketDraft, type FieldErrors } from './validation.js';
import { TicketDetail } from './TicketDetail.js';

/**
 * REFERENCE SOLUTION for M01.
 *
 * Deliberate choices worth noticing:
 *  - The filter is INTERFACE state; the tickets are SERVER state. They live in
 *    different places, which is why refetching does not clobber the filter.
 *  - Validation runs as a pure function first, then the server validates again.
 *    The client check is for fast feedback, never for trust.
 *  - After a create, the list is refetched from the adapter rather than having
 *    the new ticket spliced into local state, so the interface always shows
 *    what the server actually stored.
 *  - A request counter discards responses from superseded requests, so a slow
 *    first response cannot overwrite a newer one.
 */

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; tickets: Ticket[] }
  | { phase: 'error'; message: string };

const STATUS_OPTIONS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
];

const EMPTY_DRAFT: CreateTicketInput = { title: '', body: '', customerName: '' };

export interface AppProps {
  api: TicketApi;
}

export function App({ api }: AppProps): JSX.Element {
  const [filter, setFilter] = useState<TicketStatus | 'all'>('all');
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ phase: 'loading' });
    const query = filter === 'all' ? undefined : { status: filter };

    api
      .listTickets(query)
      .then((tickets) => {
        // Ignore a response whose request has already been superseded.
        if (current) setState({ phase: 'ready', tickets });
      })
      .catch(() => {
        if (current) {
          setState({ phase: 'error', message: 'Could not load tickets. Try again.' });
        }
      });

    return () => {
      current = false;
    };
  }, [api, filter, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  if (selectedId !== null) {
    return (
      <main>
        <h1>Support desk</h1>
        <TicketDetail api={api} ticketId={selectedId} onBack={() => setSelectedId(null)} />
      </main>
    );
  }

  return (
    <main>
      <h1>Support desk</h1>

      <section aria-labelledby="new-ticket-heading">
        <h2 id="new-ticket-heading">New ticket</h2>
        <CreateTicketForm api={api} onCreated={refresh} />
      </section>

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading">Queue</h2>

        <label htmlFor="status-filter">Filter by status</label>
        <select
          id="status-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as TicketStatus | 'all')}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {state.phase === 'loading' && <p role="status">Loading tickets…</p>}

        {state.phase === 'error' && (
          <p role="alert">
            {state.message}{' '}
            <button type="button" onClick={refresh}>
              Retry
            </button>
          </p>
        )}

        {state.phase === 'ready' && state.tickets.length === 0 && (
          <p data-testid="ticket-list-empty">No tickets match this filter.</p>
        )}

        {state.phase === 'ready' && state.tickets.length > 0 && (
          <ul data-testid="ticket-list">
            {state.tickets.map((ticket) => (
              <li key={ticket.id}>
                <a
                  href={`/tickets/${ticket.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedId(ticket.id);
                  }}
                >
                  {ticket.title}
                </a>
                <span> — {ticket.customerName}</span>
                <span> ({ticket.status})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

interface CreateTicketFormProps {
  api: TicketApi;
  onCreated: () => void;
}

function CreateTicketForm({ api, onCreated }: CreateTicketFormProps): JSX.Element {
  const [draft, setDraft] = useState<CreateTicketInput>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const update = (field: keyof CreateTicketInput) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const value = event.target.value;
    setDraft((previous) => ({ ...previous, [field]: value }));
  };

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitError(null);
    setConfirmation(null);

    const found = validateTicketDraft(draft);
    setErrors(found);
    if (hasErrors(found)) return;

    setSubmitting(true);
    try {
      const created = await api.createTicket(draft);
      setDraft(EMPTY_DRAFT);
      setErrors({});
      setConfirmation(`Created ${created.id}.`);
      onCreated();
    } catch (error) {
      if (error instanceof TicketValidationError) {
        setErrors(error.fieldErrors as FieldErrors);
      } else {
        setSubmitError('Could not create the ticket. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label htmlFor="ticket-title">Summary</label>
        <input
          id="ticket-title"
          value={draft.title}
          onChange={update('title')}
          aria-invalid={errors.title ? 'true' : undefined}
          aria-describedby={errors.title ? 'ticket-title-error' : undefined}
        />
        {errors.title && (
          <p id="ticket-title-error" role="alert">
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ticket-customer">Customer</label>
        <input
          id="ticket-customer"
          value={draft.customerName}
          onChange={update('customerName')}
          aria-invalid={errors.customerName ? 'true' : undefined}
          aria-describedby={errors.customerName ? 'ticket-customer-error' : undefined}
        />
        {errors.customerName && (
          <p id="ticket-customer-error" role="alert">
            {errors.customerName}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ticket-body">Details</label>
        <textarea id="ticket-body" value={draft.body} onChange={update('body')} />
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create ticket'}
      </button>

      {submitError && <p role="alert">{submitError}</p>}
      {confirmation && <p role="status">{confirmation}</p>}
    </form>
  );
}

export default App;
