import { useEffect } from 'react';
import { useSession } from '../features/auth/SessionProvider';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Applies the owner's theme preference (spec 4.1). "system" stamps no
 * attribute, letting prefers-color-scheme decide; an explicit choice stamps
 * data-theme so it wins in both directions.
 */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function ThemeSync(): null {
  const { owner } = useSession();
  const theme = owner?.theme ?? 'system';
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return null;
}
