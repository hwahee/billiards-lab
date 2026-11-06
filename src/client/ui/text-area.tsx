import { useId, type TextareaHTMLAttributes } from 'react';

interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'className'
> {
  /** Always rendered as a real <label> — required for accessibility. */
  label: string;
  /** Validation message; wires aria-invalid + aria-describedby automatically. */
  error?: string;
  /** Quiet line under the field, e.g. a character count; described-by too. */
  hint?: string;
  /** Required: every interactive element must be automatable (docs/ui-automation.md). */
  testId: string;
}

/** Multi-line sibling of TextField: same label, error and automation contract. */
export function TextArea({ label, error, hint, testId, rows = 4, ...rest }: TextAreaProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        {...rest}
        id={id}
        rows={rows}
        className="field__input field__input--multiline"
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <p className="field__hint muted" id={hintId} data-testid={`${testId}.hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId} data-testid={`${testId}.error`}>
          {error}
        </p>
      )}
    </div>
  );
}
