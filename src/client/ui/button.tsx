import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router';

import { Spinner } from './spinner';

interface CommonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Required: every interactive element must be automatable (docs/ui-automation.md). */
  testId: string;
}

/** Without `to`: an action — a real <button>. */
interface ActionProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  to?: undefined;
  /** Shows a spinner and blocks interaction; announced via aria-busy. */
  loading?: boolean;
}

/**
 * With `to`: navigation — a real <a> (opens in a new tab, copies as a link,
 * is announced as a link). A link cannot be disabled, loading or a submit.
 */
interface NavigationProps
  extends CommonProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'type'> {
  /** In-app route to go to. */
  to: string;
  loading?: never;
  disabled?: never;
  type?: never;
}

type ButtonProps = ActionProps | NavigationProps;

/**
 * Design-system button. Doing something is a button; going somewhere passes
 * `to` and renders as a link with the same look — never a link wrapped
 * around a button (nested interactive elements are invalid HTML).
 * Icon-only usage MUST pass `aria-label`.
 */
export function Button(props: ButtonProps) {
  if (props.to !== undefined) {
    const { to, variant = 'primary', testId, children, ...rest } = props;
    return (
      <Link {...rest} to={to} className={`btn btn--${variant} btn--link`} data-testid={testId}>
        {children}
      </Link>
    );
  }

  const {
    variant = 'primary',
    loading = false,
    testId,
    disabled,
    children,
    type,
    to: _to,
    ...rest
  } = props;
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={`btn btn--${variant}`}
      data-testid={testId}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
