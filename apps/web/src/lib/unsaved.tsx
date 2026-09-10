import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Registry of documents with unsaved text (spec 9.4).
 *
 * Editors register themselves while dirty; the navigation guard reads the
 * registry so leaving a screen with unsaved work asks first instead of
 * silently discarding it.
 */

interface UnsavedValue {
  hasUnsaved: boolean;
  labels: string[];
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
}

const UnsavedContext = createContext<UnsavedValue | null>(null);

export function UnsavedWorkProvider({ children }: { children: ReactNode }): JSX.Element {
  const [entries, setEntries] = useState<Record<string, string>>({});

  const register = useCallback((id: string, label: string) => {
    setEntries((current) => (current[id] === label ? current : { ...current, [id]: label }));
  }, []);

  const unregister = useCallback((id: string) => {
    setEntries((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const labels = useMemo(() => Object.values(entries), [entries]);
  const hasUnsaved = labels.length > 0;

  // Browser-level guard for reload and tab close.
  useEffect(() => {
    if (!hasUnsaved) return;
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  const value = useMemo<UnsavedValue>(
    () => ({ hasUnsaved, labels, register, unregister }),
    [hasUnsaved, labels, register, unregister],
  );

  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

export function useUnsavedWork(): UnsavedValue {
  const value = useContext(UnsavedContext);
  if (!value) {
    // The provider is always mounted in the app; tests may render a component
    // in isolation, where tracking is simply inert.
    return { hasUnsaved: false, labels: [], register: () => undefined, unregister: () => undefined };
  }
  return value;
}

/** Declare that this editor currently holds unsaved text. */
export function useMarkUnsaved(id: string, isDirty: boolean, label: string): void {
  const { register, unregister } = useUnsavedWork();
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    if (isDirty) register(idRef.current, label);
    else unregister(idRef.current);
  }, [isDirty, label, register, unregister]);

  useEffect(() => {
    const currentId = idRef.current;
    return () => unregister(currentId);
  }, [unregister]);
}
