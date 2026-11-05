/**
 * Per-request context: negotiated locale + a bound translator, and who is
 * calling.
 *
 * Locale resolution order: explicit `?lang=` override → `Accept-Language`
 * header → default locale. API error messages are localized with this.
 */
import {
  isLocale,
  negotiateLocale,
  translate,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '@shared/i18n';

import { readCaller, type Caller } from '../auth/session';
import type { ServerConfig } from '../config';

export interface RequestContext {
  locale: Locale;
  t(key: MessageKey, params?: MessageParams): string;
  /** Who is calling — see `Caller` (src/server/auth/session.ts). */
  caller: Caller;
}

export function createRequestContext(req: Request, config: ServerConfig): RequestContext {
  const langParam = new URL(req.url).searchParams.get('lang');
  const locale: Locale = isLocale(langParam)
    ? langParam
    : negotiateLocale(req.headers.get('accept-language'));
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
    caller: readCaller(req, config),
  };
}
