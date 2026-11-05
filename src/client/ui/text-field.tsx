import { useId, type InputHTMLAttributes } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  /** Always rendered as a real <label> — required for accessibility. */
  label: string;
  /** Validation message; wires aria-invalid + aria-describedby automatically. */
  error?: string;
  /** Required: every interactive element must be automatable (docs/ui-automation.md). */
  testId: string;
  /** Visually hides the label (it stays available to assistive tech). */
  hideLabel?: boolean;
}

export function TextField({ label, error, testId, hideLabel, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className={hideLabel ? 'visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        className="field__input"
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p className="field__error" id={errorId} data-testid={`${testId}.error`}>
          {error}
        </p>
      )}
    </div>
  );
}
