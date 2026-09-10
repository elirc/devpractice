import { useEffect, useState } from 'react';
import {
  TicketNotFoundError,
  type Ticket,
  type TicketApi,
  type TicketComment,
} from './api/types.js';

interface TicketDetailProps {
  api: TicketApi;
  ticketId: string;
  onBack: () => void;
}

type DetailState =
  | { phase: 'loading' }
  | { phase: 'ready'; ticket: Ticket; comments: TicketComment[] }
  | { phase: 'missing' }
  | { phase: 'error' };

export function TicketDetail({ api, ticketId, onBack }: TicketDetailProps): JSX.Element {
  const [state, setState] = useState<DetailState>({ phase: 'loading' });

  useEffect(() => {
    let current = true;
    setState({ phase: 'loading' });

    Promise.all([api.getTicket(ticketId), api.listComments(ticketId)])
      .then(([ticket, comments]) => {
        if (current) setState({ phase: 'ready', ticket, comments });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({ phase: error instanceof TicketNotFoundError ? 'missing' : 'error' });
      });

    return () => {
      current = false;
    };
  }, [api, ticketId]);

  return (
    <section aria-labelledby="detail-heading" data-testid="ticket-detail">
      <button type="button" onClick={onBack}>
        Back to queue
      </button>

      {state.phase === 'loading' && <p role="status">Loading ticket…</p>}
      {state.phase === 'missing' && <p role="alert">That ticket no longer exists.</p>}
      {state.phase === 'error' && <p role="alert">Could not load this ticket.</p>}

      {state.phase === 'ready' && (
        <>
          <h2 id="detail-heading">{state.ticket.title}</h2>
          <dl>
            <dt>Customer</dt>
            <dd>{state.ticket.customerName}</dd>
            <dt>Status</dt>
            <dd>{state.ticket.status}</dd>
          </dl>
          <p>{state.ticket.body}</p>

          <h3>Comments</h3>
          {state.comments.length === 0 ? (
            <p>No comments yet.</p>
          ) : (
            <ul>
              {state.comments.map((comment) => (
                <li key={comment.id}>
                  <strong>{comment.author}</strong>: {comment.body}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
