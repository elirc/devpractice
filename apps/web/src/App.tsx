import { Suspense, lazy } from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { NavigationGuard } from './components/NavigationGuard';
import { LoadingState } from './components/StateViews';
import { LoginPage } from './features/auth/LoginPage';
import { SessionProvider, useSession } from './features/auth/SessionProvider';
import { ThemeSync } from './lib/theme';
import { UnsavedWorkProvider } from './lib/unsaved';

/**
 * Route-level code splitting (spec 14.3): the editor, the TypeScript compiler
 * and the WASM interpreter are reachable only from practice-bearing routes, so
 * they stay out of the initial dashboard bundle.
 */
const TodayPage = lazy(() => import('./features/today/TodayPage'));
const LearnPage = lazy(() => import('./features/learn/LearnPage'));
const ChapterPage = lazy(() => import('./features/learn/ChapterPage'));
const LessonPage = lazy(() => import('./features/learn/LessonPage'));
const PracticePage = lazy(() => import('./features/learn/PracticePage'));
const PlacementPage = lazy(() => import('./features/learn/PlacementPage'));
const ReviewPage = lazy(() => import('./features/review/ReviewPage'));
const ProjectsPage = lazy(() => import('./features/projects/ProjectsPage'));
const MissionPage = lazy(() => import('./features/projects/MissionPage'));
const ProgressPage = lazy(() => import('./features/progress/ProgressPage'));
const NotesPage = lazy(() => import('./features/notes/NotesPage'));
const ContentPage = lazy(() => import('./features/content/ContentPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

/**
 * Root element: providers that need to sit inside the router (so the
 * navigation guard can block a transition) but outside every screen.
 */
function Root(): JSX.Element {
  return (
    <SessionProvider>
      <UnsavedWorkProvider>
        <ThemeSync />
        <NavigationGuard />
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </UnsavedWorkProvider>
    </SessionProvider>
  );
}

function RequireOwner(): JSX.Element {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') return <LoadingState label="Checking your session" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <AppLayout />;
}

function NotFound(): JSX.Element {
  return (
    <div>
      <h1>Page not found</h1>
      <p>That address does not match a screen in this application.</p>
    </div>
  );
}

// Explicitly annotated: pnpm's non-hoisted layout makes the inferred router
// type unnameable from this package.
export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireOwner />,
        children: [
          { index: true, element: <Navigate to="/today" replace /> },
          { path: '/today', element: <TodayPage /> },
          { path: '/learn', element: <LearnPage /> },
          { path: '/learn/chapters/:chapterId', element: <ChapterPage /> },
          { path: '/learn/lessons/:lessonId', element: <LessonPage /> },
          { path: '/practice/:exerciseId', element: <PracticePage /> },
          { path: '/placement/:chapterId', element: <PlacementPage /> },
          { path: '/review', element: <ReviewPage /> },
          { path: '/projects', element: <ProjectsPage /> },
          { path: '/projects/:missionId', element: <MissionPage /> },
          { path: '/progress', element: <ProgressPage /> },
          { path: '/notes', element: <NotesPage /> },
          { path: '/content', element: <ContentPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
