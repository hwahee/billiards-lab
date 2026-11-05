/**
 * Header sign-in controls: a sign-in button while signed out, the member and
 * a sign-out button while signed in. Both leave for the member server's pages
 * and come back (CLAUDE.md) — signing in returns to the page it started from.
 * Renders nothing while `me` is loading or when the server runs without
 * sign-in (`AUTH_DRIVER=none` answers 404).
 */
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { useLocation } from 'react-router';

import { authApi } from '../api/endpoints';
import { useMe } from '../api/queries';
import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { useTheme } from '../theme/theme-context';
import { Button } from '../ui/button';

export function AccountControls() {
  const { t, locale } = useI18n();
  const { theme, design } = useTheme();
  const me = useMe();
  const location = useLocation();

  if (!me.isSuccess) return null;

  if (me.data) {
    return (
      <div className="account-controls">
        <span className="account-controls__user muted" data-testid={TESTID.app.account.user}>
          <UserRound aria-hidden size="1em" />
          {t('auth.signedInAs', { name: me.data.displayName })}
        </span>
        {/* Actions that leave the page: the member server confirms the sign-out. */}
        <Button
          variant="ghost"
          onClick={() => window.location.assign(authApi.signOutUrl)}
          testId={TESTID.app.account.signOut}
        >
          <LogOut aria-hidden size="1em" />
          {t('auth.signOut')}
        </Button>
      </div>
    );
  }

  return (
    <div className="account-controls">
      <Button
        variant="secondary"
        onClick={() =>
          window.location.assign(
            authApi.signInUrl(location.pathname + location.search, { theme, design, locale }),
          )
        }
        testId={TESTID.app.account.signIn}
      >
        <LogIn aria-hidden size="1em" />
        {t('auth.signIn')}
      </Button>
    </div>
  );
}
