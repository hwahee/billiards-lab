/**
 * Sitemap domain — the shared contract for the service directory that feeds
 * the footer's "Other Services" column.
 *
 * The data itself lives in `public/sitemap.json` and is served verbatim by
 * `GET /sitemap.json`: adding or renaming a service is a data edit, never a
 * code change. This validator is what keeps that file honest — the server
 * refuses to serve a malformed directory rather than shipping broken links.
 *
 * Unrelated to `sitemap.xml` (the crawler protocol), which is a separate
 * concern with its own format.
 */
import { s, toValidator, type Infer } from '../validation';

/**
 * Link targets are restricted to absolute http(s) or root-relative paths.
 * The footer renders these straight into `href`, so `javascript:` and other
 * exotic schemes must never survive validation.
 */
const linkUrlSchema = s.string().check(
  s.maxLength(2048),
  s.refine((value) => /^(https?:\/\/|\/)/.test(value), {
    message: 'URL must be absolute http(s) or root-relative',
  }),
);

/**
 * Deliberately non-strict: unknown keys are dropped rather than rejected, so
 * the data file can carry annotations (or fields a newer client understands)
 * without breaking an older deployment.
 */
export const sitemapValidator = toValidator(
  s.object({
    /** Free-form stamp for humans editing the file; not used for rendering. */
    updatedAt: s.optional(s.string().check(s.maxLength(40))),
    services: s.array(
      s.object({
        name: s.string().check(s.minLength(1), s.maxLength(80)),
        url: linkUrlSchema,
        /** Shown as the link's `title` — optional, kept short on purpose. */
        description: s.optional(s.string().check(s.maxLength(200))),
      }),
    ),
  }),
);

export type Sitemap = Infer<typeof sitemapValidator>;
