/**
 * Dedicated runner worker entry for the web app.
 *
 * It contains ONLY the runner. There is deliberately no API client, no session
 * token, no CSRF token and no credentialed fetch helper in this module graph,
 * so learner code has no authenticated capability to reach even if it escaped
 * the interpreter (acceptance A07).
 */
import '@devpractice/runner/worker';
