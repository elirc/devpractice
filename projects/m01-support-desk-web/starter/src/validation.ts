/**
 * Pure validation helpers.
 *
 * Kept free of React so they can be tested without rendering. The server
 * validates too — this is for fast feedback, not for trust.
 */
import type { CreateTicketInput } from './api/types.js';

export type FieldErrors = Partial<Record<keyof CreateTicketInput, string>>;

export const TITLE_MAX = 120;

export function validateTicketDraft(draft: CreateTicketInput): FieldErrors {
  const errors: FieldErrors = {};

  const title = draft.title.trim();
  if (title === '') {
    errors.title = 'Enter a short summary of the problem.';
  } else if (title.length > TITLE_MAX) {
    errors.title = `Keep the summary under ${TITLE_MAX} characters.`;
  }

  if (draft.customerName.trim() === '') {
    errors.customerName = 'Enter the customer name.';
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
