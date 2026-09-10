/**
 * Application configuration.
 *
 * The product name lives in exactly ONE place (spec 4.1) — change it here and
 * it changes in the sidebar, the document title, the login screen and the
 * mobile header.
 */
export const APP_NAME = 'DevPractice';

/** Server-state polling while the tab is visible (spec 9.4). */
export const POLL_INTERVAL_MS = 30_000;

/** Autosave debounce for notes and code drafts (spec 9.4). */
export const AUTOSAVE_DEBOUNCE_MS = 1_000;

/** Default visible batch for the review queue (spec 3.6). */
export const REVIEW_BATCH_SIZE = 20;
