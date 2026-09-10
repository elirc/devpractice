import { useEffect, useId, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import styles from './practice.module.css';

/**
 * Code editor with a plain textarea fallback (spec 4.5).
 *
 * CodeMirror is imported lazily so it stays out of the initial bundle. It must
 * never trap keyboard focus: Escape moves focus out, and Tab is left to the
 * browser (basicSetup does not bind indentWithTab).
 *
 * The CodeMirror host and the textarea have SEPARATE refs, and the host div is
 * mounted from the first render. A single shared ref used to make the effect
 * parent the EditorView into the <textarea> (which cannot hold element
 * children); flipping `enhanced` then swapped in a fresh empty div, so the
 * learner intermittently got no editor AND no fallback.
 */

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: 'javascript' | 'typescript';
  label: string;
  readOnly?: boolean;
  /** Forces the textarea; used by tests and as a user preference. */
  plainTextOnly?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  language,
  label,
  readOnly = false,
  plainTextOnly = false,
}: CodeEditorProps) {
  const cmHostRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [failed, setFailed] = useState(false);
  const textareaId = useId();

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Seeds the initial document without making the editor re-mount per keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;

  const useEnhanced = enhanced && !plainTextOnly && !failed;

  useEffect(() => {
    if (plainTextOnly || failed) return undefined;
    let disposed = false;

    void (async () => {
      try {
        const [{ EditorView: View }, { EditorState }, { javascript }, { basicSetup }] =
          await Promise.all([
            import('@codemirror/view'),
            import('@codemirror/state'),
            import('@codemirror/lang-javascript'),
            import('codemirror'),
          ]);
        // The host div is always mounted, so this parent is real from the start.
        if (disposed || !cmHostRef.current) return;

        const state = EditorState.create({
          doc: valueRef.current,
          extensions: [
            basicSetup,
            javascript({ typescript: language === 'typescript' }),
            View.editable.of(!readOnly),
            View.lineWrapping,
            View.updateListener.of((update) => {
              if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            }),
          ],
        });
        const view = new View({ state, parent: cmHostRef.current });
        viewRef.current = view;
        setEnhanced(true);
      } catch {
        // Any load failure leaves the accessible textarea in place.
        setFailed(true);
        setEnhanced(false);
      }
    })();

    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      setEnhanced(false);
    };
  }, [language, readOnly, plainTextOnly, failed]);

  /**
   * Adopt externally-driven changes (Reset starter, conflict resolution).
   * Without this the editor keeps its own document and those actions silently
   * do nothing once CodeMirror is active.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!useEnhanced || !view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value, useEnhanced]);

  return (
    <div className={styles.editorShell}>
      {/* Mounted from first render so the lazy effect has a stable parent. */}
      <div
        ref={cmHostRef}
        className={useEnhanced ? styles.editorHost : styles.editorHostIdle}
        role={useEnhanced ? 'group' : undefined}
        aria-label={useEnhanced ? label : undefined}
        onKeyDown={(event) => {
          // Escape always releases focus so the editor is never a trap.
          if (event.key === 'Escape') {
            const panel = event.currentTarget.closest<HTMLElement>('[data-practice-panel]');
            panel?.focus();
          }
        }}
      />
      {!useEnhanced ? (
        <>
          <label className={styles.visuallyHidden} htmlFor={textareaId}>
            {label}
          </label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            className={styles.editorTextarea}
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
          />
        </>
      ) : null}
    </div>
  );
}
