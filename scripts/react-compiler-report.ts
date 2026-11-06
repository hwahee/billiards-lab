/**
 * Which client components and hooks does the React Compiler compile?
 *
 *   bun run compiler:report          # list what is not compiled
 *   bun run compiler:report --all    # list everything
 *
 * Builds the client the way `bun run build` does (React Compiler on), but
 * unminified, and checks every component (PascalCase) and hook (`use…`) in
 * src/client for the compiler's memo cache. One without it is either a
 * function with nothing worth caching (a hook that only reads a context) or
 * one the compiler skipped — silently — for syntax it does not support or a
 * Rules-of-React violation (CLAUDE.md). `.ts` files are never compiled; their
 * hooks keep hand-written memoization.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const showAll = process.argv.includes('--all');

const outdir = await mkdtemp(join(tmpdir(), 'react-compiler-report-'));
let bundle = '';
try {
  const result = await Bun.build({
    entrypoints: ['src/client/index.html'],
    outdir,
    target: 'browser',
    minify: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    reactCompiler: true,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  for (const file of new Bun.Glob(`${outdir}/*.js`).scanSync())
    bundle += await Bun.file(file).text();
} finally {
  await rm(outdir, { recursive: true, force: true });
}

/** Components are PascalCase with a lowercase letter (not CONSTANTS); hooks are use…. */
const isComponentOrHook = (name: string) => /^(?:[A-Z](?=\w*[a-z])\w*|use[A-Z]\w*)$/.test(name);

// Unminified output marks each module with a `// path` line; only ours count.
const modules = [...bundle.matchAll(/^\/\/ (\S+\.[cm]?[jt]sx?)$/gm)];
const rows: { file: string; name: string; compiled: boolean }[] = [];
modules.forEach((module, index) => {
  const file = module[1] ?? '';
  if (!file.startsWith('src/client/') || file.includes('.test.')) return;
  const code = bundle.slice(module.index, modules[index + 1]?.index ?? bundle.length);
  // Top-level declarations start at column 0 in unminified output.
  const declarations = [
    ...code.matchAll(/^(?:(?:async )?function (\w+)\(|(?:var|let|const) (\w+) = (.{0,60}))/gm),
  ];
  declarations.forEach((declaration, at) => {
    // The bundler may suffix a clashing name (our `Palette` next to lucide's becomes `Palette2`).
    const name = (declaration[1] ?? declaration[2] ?? '').replace(/\d+$/, '');
    const initializer = declaration[3];
    const functionLike =
      initializer === undefined ||
      /^(?:\(|async|function|\w+\s*=>|(?:\w+\.)?(?:memo|forwardRef)\()/.test(initializer);
    if (!isComponentOrHook(name) || !functionLike) return;
    const body = code.slice(declaration.index, declarations[at + 1]?.index ?? code.length);
    rows.push({ file, name, compiled: /react_compiler_runtime\d*\.c\(/.test(body) });
  });
});

rows.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
for (const row of rows) {
  if (showAll || !row.compiled) {
    console.log(`${row.compiled ? 'compiled    ' : 'not compiled'}  ${row.file}  ${row.name}`);
  }
}
const notCompiled = rows.filter((row) => !row.compiled);
const inTsx = notCompiled.filter((row) => row.file.endsWith('.tsx')).length;
console.log(
  `\n${rows.length - notCompiled.length} compiled, ${notCompiled.length} not` +
    (inTsx > 0 ? ` — ${inTsx} in .tsx: check each (nothing to cache, or skipped?)` : ''),
);
