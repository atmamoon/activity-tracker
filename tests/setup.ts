import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// React Testing Library only auto-cleans up with vitest globals enabled;
// do it explicitly so successive renders don't stack in the DOM.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
