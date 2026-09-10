import ts from 'typescript';
import type { RunnerDiagnostic } from '@devpractice/contracts';

/**
 * Virtual single-file TypeScript environment (spec 7.2).
 *
 * SYNTACTIC *and SEMANTIC* diagnostics run before any emit. A type error
 * returns compile_error and can never reach the case runner, so transpiling
 * types away does not satisfy TypeScript grading (acceptance A08).
 */

export const TS_ENTRY_FILE = 'main.ts';

/** Supplies lib.*.d.ts contents; differs between browser bundle and Node. */
export interface LibProvider {
  /** Name of the default lib for the configured target. */
  defaultLibFileName: string;
  read(fileName: string): string | undefined;
}

export interface TsCompileResult {
  ok: boolean;
  /** Emitted JavaScript; only present when ok is true. */
  js?: string;
  diagnostics: RunnerDiagnostic[];
  /** Set when the source uses a feature V1 does not support (e.g. imports). */
  unsupported?: string;
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.None,
  strict: true,
  noEmitOnError: true,
  allowJs: false,
  skipLibCheck: true,
  // A single global script: no module system is available to the learner.
  isolatedModules: false,
  noImplicitAny: true,
  strictNullChecks: true,
  // No moduleResolution is set on purpose: a single global script resolves
  // nothing, and Bundler resolution implies resolveJsonModule, which conflicts
  // with module: None and produces a spurious option error.
  types: [],
  lib: undefined,
};

export function compileTypeScript(source: string, libs: LibProvider): TsCompileResult {
  const sourceFile = ts.createSourceFile(
    TS_ENTRY_FILE,
    source,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TS,
  );

  // V1 supports one self-contained file with no module graph.
  const importIssue = findUnsupportedModuleSyntax(sourceFile);
  if (importIssue) {
    return { ok: false, diagnostics: [], unsupported: importIssue };
  }

  let emitted: string | undefined;
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      if (fileName === TS_ENTRY_FILE) return sourceFile;
      const libText = libs.read(fileName);
      if (libText === undefined) return undefined;
      return ts.createSourceFile(fileName, libText, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    },
    getDefaultLibFileName: () => libs.defaultLibFileName,
    writeFile: (_name, text) => {
      emitted = text;
    },
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName === TS_ENTRY_FILE || libs.read(fileName) !== undefined,
    readFile: (fileName) => (fileName === TS_ENTRY_FILE ? source : libs.read(fileName)),
    directoryExists: () => true,
    getDirectories: () => [],
  };

  const program = ts.createProgram([TS_ENTRY_FILE], COMPILER_OPTIONS, host);

  const syntactic = program.getSyntacticDiagnostics(sourceFile);
  const semantic = program.getSemanticDiagnostics(sourceFile);
  const declaration = program.getGlobalDiagnostics();

  const diagnostics = [...syntactic, ...semantic, ...declaration].map(toRunnerDiagnostic);
  const hasError = diagnostics.some((d) => d.severity === 'error');
  if (hasError) return { ok: false, diagnostics };

  const emitResult = program.emit();
  const emitDiagnostics = emitResult.diagnostics.map(toRunnerDiagnostic);
  if (emitDiagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics: [...diagnostics, ...emitDiagnostics] };
  }
  if (emitted === undefined) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        { severity: 'error', message: 'The TypeScript compiler produced no output.' },
      ],
    };
  }
  return { ok: true, js: emitted, diagnostics };
}

function findUnsupportedModuleSyntax(sourceFile: ts.SourceFile): string | undefined {
  let issue: string | undefined;
  const visit = (node: ts.Node): void => {
    if (issue) return;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      issue = 'Imports are not available in browser exercises. Write a single self-contained file.';
      return;
    }
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      issue = 'Exports are not available in browser exercises. Declare the function directly.';
      return;
    }
    if (node.kind === ts.SyntaxKind.ImportKeyword && ts.isCallExpression(node.parent)) {
      issue = 'Dynamic import() is not available in browser exercises.';
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return issue;
}

function toRunnerDiagnostic(diagnostic: ts.Diagnostic): RunnerDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  const severity: RunnerDiagnostic['severity'] =
    diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning';
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return { severity, message, line: line + 1, column: character + 1 };
  }
  return { severity, message };
}

/**
 * Lib chain for ES2020 without DOM. Browser and Node providers both resolve
 * these names; the interpreter has no DOM, so DOM libs are deliberately absent.
 */
export const ES2020_LIB_FILES = [
  'lib.es5.d.ts',
  'lib.es2015.d.ts',
  'lib.es2015.core.d.ts',
  'lib.es2015.collection.d.ts',
  'lib.es2015.generator.d.ts',
  'lib.es2015.iterable.d.ts',
  'lib.es2015.promise.d.ts',
  'lib.es2015.proxy.d.ts',
  'lib.es2015.reflect.d.ts',
  'lib.es2015.symbol.d.ts',
  'lib.es2015.symbol.wellknown.d.ts',
  'lib.es2016.d.ts',
  'lib.es2016.array.include.d.ts',
  'lib.es2017.d.ts',
  'lib.es2017.date.d.ts',
  'lib.es2017.object.d.ts',
  'lib.es2017.sharedmemory.d.ts',
  'lib.es2017.string.d.ts',
  'lib.es2017.intl.d.ts',
  'lib.es2017.typedarrays.d.ts',
  'lib.es2018.d.ts',
  'lib.es2018.asyncgenerator.d.ts',
  'lib.es2018.asynciterable.d.ts',
  'lib.es2018.intl.d.ts',
  'lib.es2018.promise.d.ts',
  'lib.es2018.regexp.d.ts',
  'lib.es2019.d.ts',
  'lib.es2019.array.d.ts',
  'lib.es2019.object.d.ts',
  'lib.es2019.string.d.ts',
  'lib.es2019.symbol.d.ts',
  'lib.es2019.intl.d.ts',
  'lib.es2020.d.ts',
  'lib.es2020.bigint.d.ts',
  'lib.es2020.date.d.ts',
  'lib.es2020.number.d.ts',
  'lib.es2020.promise.d.ts',
  'lib.es2020.sharedmemory.d.ts',
  'lib.es2020.string.d.ts',
  'lib.es2020.symbol.wellknown.d.ts',
  'lib.es2020.intl.d.ts',
  'lib.decorators.d.ts',
  'lib.decorators.legacy.d.ts',
] as const;

export const DEFAULT_LIB_FILE_NAME = 'lib.es2020.d.ts';

/** Build a provider from an already-loaded name → text map. */
export function libProviderFromMap(map: Record<string, string>): LibProvider {
  return {
    defaultLibFileName: DEFAULT_LIB_FILE_NAME,
    read: (fileName) => map[fileName] ?? map[fileName.replace(/^.*\//, '')],
  };
}
