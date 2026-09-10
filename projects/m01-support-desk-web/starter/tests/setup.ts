import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

// Register jest-dom matchers against the SAME expect instance the tests use.
// Importing '@testing-library/jest-dom/vitest' relies on globals being wired up
// first; extending explicitly works regardless of how vitest is invoked.
expect.extend(matchers);
