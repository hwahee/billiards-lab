/**
 * Design System — every token and component visible in one place, in every
 * state. The header controls switch theme (light/dark), design variant
 * (A = aesthetic / B = high-visibility) and language live on this page,
 * because everything below renders exclusively from semantic CSS tokens.
 */
import { hexColor, type HexColor } from '@shared/color';
import { Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { Accordion } from '../ui/accordion';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { useOverlay } from '../ui/overlay';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- always-visible layout: an inline sidebar is a region of the page, not something the registry pushes on top of it
import { Sidebar } from '../ui/overlay/declarative';
import { Checkbox } from '../ui/checkbox';
import { Palette, type PaletteSwatch } from '../ui/palette';
import { Select } from '../ui/select';
import { Spinner } from '../ui/spinner';
import { TextField } from '../ui/text-field';

/** The semantic color tokens (see src/client/styles/tokens.css). */
const COLOR_TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-text',
  '--color-text-muted',
  '--color-border',
  '--color-primary',
  '--color-primary-contrast',
  '--color-success',
  '--color-warning',
  '--color-danger',
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="ds-section"
      aria-labelledby={`ds-${id}`}
      data-testid={TESTID.designSystem.section(id)}
    >
      <h3 id={`ds-${id}`}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Overlays are opened through `useOverlay()`, never by rendering a component —
 * see docs/overlay-design.md §5.1. The nesting button is the part worth
 * watching: opening a confirm on top of the modal does NOT darken the page a
 * second time, because the scrim belongs to the stack rather than to either
 * overlay, and ESC closes only the top one.
 */
function OverlayDemo() {
  const overlay = useOverlay();
  const [result, setResult] = useState('—');
  const [dockOpen, setDockOpen] = useState(false);

  const confirmDiscard = () =>
    overlay.modal<boolean>({
      title: 'Discard your changes?',
      testId: TESTID.designSystem.overlay.confirm,
      size: 'sm',
      tone: 'danger',
      render: () => (
        <p>
          Two overlays are open and the page behind is dimmed exactly once. Press <kbd>Esc</kbd>:
          this one closes, the modal underneath stays.
        </p>
      ),
      renderFooter: ({ resolve }) => (
        <>
          <Button
            variant="ghost"
            testId={TESTID.designSystem.overlay.confirmNo}
            onClick={() => resolve(false)}
          >
            Keep editing
          </Button>
          <Button
            variant="danger"
            testId={TESTID.designSystem.overlay.confirmYes}
            onClick={() => resolve(true)}
          >
            Discard
          </Button>
        </>
      ),
    });

  const openModal = async () => {
    const answer = await overlay.modal<string>({
      title: 'Edit item',
      testId: TESTID.designSystem.overlay.modal,
      render: ({ close }) => (
        <>
          <p>
            The call awaits this overlay: whatever a button passes to <code>resolve</code> becomes
            the value below. Dismissing resolves <code>undefined</code> instead of throwing —
            cancelling is an outcome, not an error.
          </p>
          <Button
            variant="secondary"
            testId={TESTID.designSystem.overlay.nest}
            onClick={() => void confirmDiscard().then((discard) => discard && close())}
          >
            Open a confirm on top of this
          </Button>
        </>
      ),
      renderFooter: ({ close, resolve }) => (
        <>
          <Button
            variant="ghost"
            testId={TESTID.designSystem.overlay.save + '.cancel'}
            onClick={close}
          >
            Cancel
          </Button>
          <Button testId={TESTID.designSystem.overlay.save} onClick={() => resolve('saved')}>
            Save
          </Button>
        </>
      ),
    });
    setResult(answer ?? 'dismissed');
  };

  const openSheet = async () => {
    const answer = await overlay.sheet<string>({
      title: 'Filters',
      testId: TESTID.designSystem.overlay.sheet,
      snapPoint: 'content',
      render: ({ resolve }) => (
        <>
          <p>
            Same shell, bottom-anchored. Height is measured in <code>dvh</code>, so mobile browser
            chrome collapsing does not cut it off.
          </p>
          <Button
            testId={TESTID.designSystem.overlay.sheet + '.apply'}
            onClick={() => resolve('filters applied')}
          >
            Apply
          </Button>
        </>
      ),
    });
    setResult(answer ?? 'dismissed');
  };

  const openSidebar = async () => {
    const answer = await overlay.sidebar<string>({
      title: 'Navigation',
      testId: TESTID.designSystem.overlay.sidebar,
      side: 'start',
      render: ({ resolve }) => (
        <>
          <p>
            Edge-anchored. Opened this way it is always modal; the docked desktop presentation (
            <code>modality=&quot;inline&quot;</code>) is layout, so it uses the declarative door.
          </p>
          <Button
            testId={TESTID.designSystem.overlay.sidebar + '.pick'}
            onClick={() => resolve('navigated')}
          >
            Pick something
          </Button>
        </>
      ),
    });
    setResult(answer ?? 'dismissed');
  };

  return (
    <>
      <div className="ds-row">
        <Button testId={TESTID.designSystem.overlay.openModal} onClick={() => void openModal()}>
          Open modal
        </Button>
        <Button
          variant="secondary"
          testId={TESTID.designSystem.overlay.openSheet}
          onClick={() => void openSheet()}
        >
          Open bottom sheet
        </Button>
        <Button
          variant="secondary"
          testId={TESTID.designSystem.overlay.openSidebar}
          onClick={() => void openSidebar()}
        >
          Open sidebar
        </Button>
      </div>
      <p className="muted">
        Resolved value: <code data-testid={TESTID.designSystem.overlay.result}>{result}</code>
      </p>

      <div className="ds-row">
        <Button
          variant="ghost"
          testId={TESTID.designSystem.overlay.inlineToggle}
          onClick={() => setDockOpen((open) => !open)}
        >
          {dockOpen ? 'Hide' : 'Show'} the docked sidebar
        </Button>
      </div>
      <Sidebar
        open={dockOpen}
        onClose={() => setDockOpen(false)}
        modality="auto"
        title="Docked sidebar"
        testId={TESTID.designSystem.overlay.inline}
      >
        <p>
          The only overlay whose modality follows the viewport. Wide: docked layout that claims
          nothing — no scrim, no focus trap, no scroll lock — and never joins the stack. Narrow: the
          same call becomes a modal drawer. Resize the window and watch it swap.
        </p>
      </Sidebar>
    </>
  );
}

/** The palette's contrast check needs a concrete background; the sample below sits on white. */
const SAMPLE_BACKGROUND = hexColor('#ffffff');

export function DesignSystemPage() {
  const { t } = useI18n();
  const [checked, setChecked] = useState(true);
  const [selectValue, setSelectValue] = useState<'one' | 'two'>('one');
  const [brandColor, setBrandColor] = useState<HexColor>(() => hexColor('#6366f1'));
  // Recent colors live here, not in the component — see docs/palette-design.md §5.3.
  const [recentColors, setRecentColors] = useState<readonly PaletteSwatch[]>([]);

  const pickColor = (next: HexColor) => {
    setBrandColor(next);
    setRecentColors((previous) =>
      [{ value: next, name: next }, ...previous.filter((swatch) => swatch.value !== next)].slice(
        0,
        8,
      ),
    );
  };

  return (
    <section data-testid={TESTID.designSystem.page} aria-labelledby="ds-heading">
      <h2 id="ds-heading">{t('designSystem.title')}</h2>
      <p className="muted">{t('designSystem.description')}</p>

      <Section id="colors" title={t('designSystem.colors')}>
        <ul className="swatch-grid" role="list">
          {COLOR_TOKENS.map((token) => (
            <li key={token} className="swatch">
              <span className="swatch__chip" style={{ background: `var(${token})` }} />
              <code>{token}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="typography" title={t('designSystem.typography')}>
        <h1>Heading 1 — 다람쥐 헌 쳇바퀴에 타고파</h1>
        <h2>Heading 2 — The quick brown fox</h2>
        <h3>Heading 3</h3>
        <p>
          Body — jumps over the lazy dog. 키스의 고유조건은 입술끼리 만나야 하고 특별한 기술은
          필요치 않다.
        </p>
        <p className="muted">Muted body — secondary information.</p>
        <p>
          <code>code — const answer = 42;</code>
        </p>
      </Section>

      <Section id="buttons" title={t('designSystem.buttons')}>
        <div className="ds-row">
          <Button testId="ds.button.primary">Primary</Button>
          <Button variant="secondary" testId="ds.button.secondary">
            Secondary
          </Button>
          <Button variant="danger" testId="ds.button.danger">
            Danger
          </Button>
          <Button variant="ghost" testId="ds.button.ghost">
            Ghost
          </Button>
          <Button disabled testId="ds.button.disabled">
            Disabled
          </Button>
          <Button loading testId="ds.button.loading">
            Loading
          </Button>
        </div>
      </Section>

      <Section id="form-fields" title={t('designSystem.formFields')}>
        <div className="ds-grid">
          <TextField label="Text field" placeholder="Placeholder" testId="ds.field.default" />
          <TextField
            label="With error"
            defaultValue="Invalid value"
            error="This value is not valid."
            testId="ds.field.error"
          />
          <TextField
            label="Disabled"
            disabled
            defaultValue="Read only"
            testId="ds.field.disabled"
          />
          <Select<'one' | 'two'>
            label="Select"
            value={selectValue}
            options={[
              { value: 'one', label: 'Option one' },
              { value: 'two', label: 'Option two' },
            ]}
            onChange={setSelectValue}
            testId="ds.select"
          />
          <Checkbox label="Checkbox" checked={checked} onChange={setChecked} testId="ds.checkbox" />
        </div>
      </Section>

      <Section id="color-input" title={t('designSystem.colorInput')}>
        <div className="ds-row">
          <Palette
            label="Brand color"
            value={brandColor}
            onChange={pickColor}
            recent={recentColors}
            contrastAgainst={SAMPLE_BACKGROUND}
            testId="ds.palette"
          />
          <span className="ds-color-sample" style={{ color: brandColor }}>
            Sample text on white — {brandColor}
          </span>
        </div>
        <p className="muted">
          Presets, a hex field and the system picker (with an opacity slider — alpha is part of the
          value). Hovering or arrowing onto a swatch shows the exact string it will return. The
          popup opens in the top layer, so it is never clipped and shifts no layout.
        </p>
      </Section>

      <Section id="feedback" title={t('designSystem.feedback')}>
        <div className="ds-stack">
          <Alert tone="info">Info — something noteworthy happened.</Alert>
          <Alert tone="success">Success — the operation completed.</Alert>
          <Alert
            tone="error"
            action={
              <Button variant="secondary" testId="ds.alert.retry">
                {t('common.retry')}
              </Button>
            }
          >
            Error — something went wrong.
          </Alert>
          <div className="ds-row">
            <Spinner label={t('common.loading')} />
            <Badge>Neutral</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
          </div>
        </div>
      </Section>

      <Section id="data-display" title={t('designSystem.dataDisplay')}>
        <div className="ds-grid">
          <Card
            title="Card with image"
            image={{ src: 'https://picsum.photos/640/360', alt: 'Random placeholder landscape' }}
            testId="ds.card.image"
          >
            <p className="muted">
              <ImageIcon aria-hidden size="1em" /> Cover images load lazily and always carry alt
              text.
            </p>
          </Card>
          <Card title="Plain card" testId="ds.card.plain">
            <p>Cards group related content on a surface token.</p>
          </Card>
        </div>
      </Section>

      <Section id="disclosure" title={t('designSystem.disclosure')}>
        <Accordion
          mode="single"
          defaultOpenIds={['motion']}
          testId="ds.accordion"
          items={[
            {
              id: 'motion',
              title: 'Escape hatch #0 — the shift is animated',
              content: (
                <p>
                  Expanding inline content inevitably shifts everything below it. Instead of an
                  instant jump, panels animate open on <code>--duration-expand</code> so the eye can
                  track where content moved. Skins stay in charge: the office skin zeroes the token
                  (instant, like the era), kids stretches it with a springy overshoot, and{' '}
                  <code>prefers-reduced-motion</code> disables it entirely.
                </p>
              ),
            },
            {
              id: 'anchor',
              title: 'Escape hatch #1 — the clicked trigger stays put',
              content: (
                <>
                  <p>
                    In <code>single</code> mode, opening this item collapses the (possibly taller)
                    item above it — without correction, this header would slide up and away from
                    your pointer mid-click. The component records the trigger&apos;s viewport
                    position and compensates the scroll frame-by-frame while layout settles, so the
                    row you clicked never moves under your cursor.
                  </p>
                  <p>
                    Try it: open the first item, scroll until both headers sit mid-viewport, then
                    open this one. The header holds still while the panel above folds away.
                  </p>
                  <p>
                    The correction measures the real delta each frame rather than predicting it, so
                    it converges even when the browser&apos;s own scroll anchoring joins in.
                  </p>
                </>
              ),
            },
            {
              id: 'reveal',
              title: 'Escape hatch #2 — opened content is revealed',
              content: (
                <p>
                  If an opened panel ends up cut off by the bottom of the viewport, the page scrolls
                  just enough to bring it into view — never so far that this header leaves the
                  viewport. A shift the user asked for is guidance; a shift they didn&apos;t is CLS.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Section id="overlays" title={t('designSystem.overlays')}>
        <OverlayDemo />
      </Section>
    </section>
  );
}
