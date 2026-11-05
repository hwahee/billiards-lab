/**
 * `GET /sitemap.json` — the service directory the footer renders.
 *
 * Read from disk on every request (the file is tiny) so editing
 * `public/sitemap.json` takes effect without a rebuild or restart; browsers
 * are told to cache it for a few minutes. The path is resolved relative to
 * the working directory, which is the repo root in development and `dist/`
 * in production — hence the build step that copies `public/` into `dist/`.
 *
 * A malformed file is a server-side data fault, not a bad request: it is
 * logged and answered with 500 rather than a validation error the caller
 * could do nothing about.
 */
import { sitemapValidator } from '@shared/domain/sitemap';

import { apiRoute, json, type HttpDeps } from '../http/respond';
import { NotFoundError } from '../lib/errors';

/** Relative to `process.cwd()` — see the note on working directories above. */
const SITEMAP_FILE = 'public/sitemap.json';

const CACHE_CONTROL = 'public, max-age=300';

export function sitemapRoute(deps: HttpDeps) {
  return apiRoute<'/sitemap.json'>(
    {
      GET: async () => {
        const file = Bun.file(SITEMAP_FILE);
        if (!(await file.exists())) {
          throw new NotFoundError('sitemap', 'sitemap.json');
        }

        // `.json()` throws SyntaxError on malformed input, which the error
        // mapper would read as a bad request body — swallow it here and let
        // the validation branch below report it as the server fault it is.
        const raw: unknown = await file.json().catch(() => undefined);
        const parsed = sitemapValidator.safeParse(raw);
        if (!parsed.ok) {
          deps.log.error('sitemap.json is not a valid service directory', {
            file: SITEMAP_FILE,
            issues: parsed.issues,
          });
          throw new Error('sitemap.json is not a valid service directory');
        }

        return json(parsed.value, { headers: { 'cache-control': CACHE_CONTROL } });
      },
    },
    deps,
  );
}
