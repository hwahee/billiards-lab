/**
 * /sign-in-failed — where a sign-in lands when it cannot finish: turned down,
 * expired (a sign-in page left open too long), or its answer used twice (the
 * back button). Nobody was signed in; trying again starts a fresh sign-in.
 */
import { LogIn } from 'lucide-react';

import { authApi } from '../api/endpoints';
import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { useTheme } from '../theme/theme-context';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';

export function SignInFailedPage() {
  const { t, locale } = useI18n();
  const { theme, design } = useTheme();
  return (
    <section
      className="sign-in-failed"
      data-testid={TESTID.signInFailed.page}
      aria-labelledby="sign-in-failed-heading"
    >
      <h2 id="sign-in-failed-heading">{t('auth.signInFailed.title')}</h2>
      <Alert tone="error" testId={TESTID.signInFailed.message}>
        {t('auth.signInFailed.message')}
      </Alert>
      <div className="sign-in-failed__actions">
        <Button
          onClick={() => window.location.assign(authApi.signInUrl('/', { theme, design, locale }))}
          testId={TESTID.signInFailed.retry}
        >
          <LogIn aria-hidden size="1em" />
          {t('auth.signInFailed.retry')}
        </Button>
        <Button to="/" variant="ghost" testId={TESTID.signInFailed.homeLink}>
          {t('notFound.goHome')}
        </Button>
      </div>
    </section>
  );
}
