/**
 * Production build (`bun run build`).
 *
 * Produces ONE deployable unit in ./dist:
 *   - dist/index.js       — the server, with the built client (hashed assets)
 *                           bundled in via the HTML import (Bun fullstack build)
 *   - dist/migrate.js     — standalone migration runner for the container
 *   - dist/public/        — files the server reads from disk at runtime
 *   - dist/BUILD_INFO.json
 *
 * The build version (git SHA) is compiled into BOTH server and client through
 * the APP_BUILD_VERSION define — the basis of the rolling-deploy version
 * handshake (@shared/api/version).
 */
import { cp, rm } from 'node:fs/promises';

import { $ } from 'bun';

const version =
  process.env.APP_BUILD_VERSION ??
  (await $`git rev-parse --short HEAD`.text().catch(() => `local-${Date.now()}`)).trim();

await rm('dist', { recursive: true, force: true });

const define = {
  APP_BUILD_VERSION: JSON.stringify(version),
  // The client is bundled through the server's HTML import, which does not
  // set this on its own: without it React ships its development build
  // (several times slower, with dev-only checks and warnings).
  'process.env.NODE_ENV': JSON.stringify('production'),
};

// Separate builds keep the output flat: dist/index.js + dist/migrate.js.
for (const entrypoint of ['src/server/index.ts', 'scripts/migrate.ts']) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: 'dist',
    target: 'bun',
    minify: true,
    sourcemap: 'linked',
    define,
    // React Compiler (Bun's built-in, experimental): memoizes components in
    // .tsx files at build time, so they do not hand-write memo / useMemo /
    // useCallback for speed (CLAUDE.md). Only this build runs it — the dev
    // server serves the same code uncompiled, which must therefore stay
    // correct without it.
    reactCompiler: true,
    metafile: true,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  // Guard: compiled components import React's compiler runtime. Without it in
  // the bundle, the compiler no longer reaches the client (bundled through
  // the server's HTML import) and every component ships unmemoized.
  const inputs = Object.keys(result.metafile?.inputs ?? {});
  if (entrypoint === 'src/server/index.ts' && !inputs.some((i) => i.includes('compiler-runtime'))) {
    console.error('The React Compiler did not run over the client bundle.');
    process.exit(1);
  }
}

// Guard: a development React build in the output means the define above no
// longer reaches the client bundle.
for await (const file of new Bun.Glob('dist/*.js').scan()) {
  if ((await Bun.file(file).text()).includes('jsxDEV')) {
    console.error(`${file} contains React's development build (jsxDEV).`);
    process.exit(1);
  }
}

// Runtime-read static files (currently public/sitemap.json). They are NOT
// bundled: the point is that they can be edited without a rebuild. `bun run
// start` runs from dist/, so they have to sit next to the server bundle.
await cp('public', 'dist/public', { recursive: true });

await Bun.write(
  'dist/BUILD_INFO.json',
  JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2),
);

console.log(`Built dist/ (version ${version}).`);
