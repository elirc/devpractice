import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { APP_NAME } from '../config';
import { useSession } from '../features/auth/SessionProvider';
import { SessionExpiredDialog } from '../features/auth/SessionExpiredDialog';
import { useDueReviews } from '../lib/queries';
import styles from './AppLayout.module.css';

/** Primary destinations, shown in the sidebar and the mobile bottom bar. */
const PRIMARY = [
  { to: '/today', label: 'Today', icon: '◉' },
  { to: '/learn', label: 'Learn', icon: '▤' },
  { to: '/review', label: 'Review', icon: '↻' },
  { to: '/projects', label: 'Projects', icon: '⚑' },
] as const;

/** Secondary destinations: sidebar section on desktop, "More" sheet on mobile. */
const SECONDARY = [
  { to: '/progress', label: 'Progress', icon: '▦' },
  { to: '/notes', label: 'Notes', icon: '✎' },
  { to: '/content', label: 'Content', icon: '⤓' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
] as const;

function ReviewBadge(): JSX.Element | null {
  const { data } = useDueReviews();
  const due = data?.totalDue ?? 0;
  if (due === 0) return null;
  return (
    <span className={styles.count}>
      {due}
      <span className="srOnly"> reviews due</span>
    </span>
  );
}

export function AppLayout(): JSX.Element {
  const { owner } = useSession();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreIsActive = SECONDARY.some((item) => location.pathname.startsWith(item.to));

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <div className={styles.shell}>
      <a className="skipLink" href="#main">
        Skip to main content
      </a>

      <aside className={styles.sidebar}>
        <div className={styles.brand}>{APP_NAME}</div>
        <nav aria-label="Primary">
          <ul className={styles.navList}>
            {PRIMARY.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.navLinkActive : ''].join(' ')
                  }
                >
                  <span className={styles.icon} aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                  {item.to === '/review' ? <ReviewBadge /> : null}
                </NavLink>
              </li>
            ))}
          </ul>
          <hr className={styles.navRule} />
          <ul className={styles.navList}>
            {SECONDARY.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.navLinkActive : ''].join(' ')
                  }
                >
                  <span className={styles.icon} aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {owner ? <div className={styles.account}>{owner.email}</div> : null}
      </aside>

      <header className={styles.mobileHeader}>
        <span className={styles.brandMobile}>{APP_NAME}</span>
      </header>

      <main className={styles.main} id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className={styles.bottomNav} aria-label="Primary">
        <ul className={styles.bottomList}>
          {PRIMARY.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [styles.bottomLink, isActive ? styles.bottomLinkActive : ''].join(' ')
                }
              >
                <span className={styles.bottomIcon} aria-hidden="true">
                  {item.icon}
                </span>
                <span className={styles.bottomLabel}>{item.label}</span>
                {item.to === '/review' ? <ReviewBadge /> : null}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              ref={moreButtonRef}
              className={[styles.bottomLink, moreIsActive ? styles.bottomLinkActive : ''].join(' ')}
              aria-expanded={moreOpen}
              aria-controls="more-sheet"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span className={styles.bottomIcon} aria-hidden="true">
                ⋯
              </span>
              <span className={styles.bottomLabel}>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <div className={styles.moreSheet} id="more-sheet">
          <ul className={styles.moreList}>
            {SECONDARY.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={styles.moreLink}>
                  <span className={styles.icon} aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SessionExpiredDialog />
    </div>
  );
}
