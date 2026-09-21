# 오버레이(Overlay) 컴포넌트 — 기획 & 기술 검토

Modal / BottomSheet / Sidebar 세 컴포넌트의 설계 문서입니다. 구현 전에 결정을 고정하고,
왜 그렇게 결정했는지와 무엇을 기각했는지를 남깁니다.

세 컴포넌트를 따로 다루지 않고 하나의 문서에 묶은 이유가 곧 이 설계의 핵심입니다 —
**셋은 표현만 다르고, 어려운 부분은 완전히 동일**합니다.

---

## 1. 목표와 범위

### 해결하려는 것

디자인 시스템에 오버레이 계열 컴포넌트가 없습니다. 현재 top layer를 쓰는 것은
`Palette`의 팝오버 하나뿐이고(`popover="auto"`), 모달·바텀시트·사이드바는 전무합니다.

오버레이는 각각 따로 만들면 반드시 실패합니다. 세 컴포넌트가 화면에 하나뿐인 자원을
각자 점유하려 들기 때문입니다. 가장 흔한 증상이 **백드롭 중첩으로 화면이 점점 어두워지는 것**이고,
포커스 복귀 순서, 스크롤 잠금 해제, ESC 전파도 같은 뿌리에서 나옵니다.

### 요구사항

1. Modal / BottomSheet / Sidebar 세 가지 표현
2. 중첩(오버레이 위 오버레이)이 정상 동작할 것 — 백드롭이 겹치지 않을 것
3. 기존 컴포넌트와 같은 계약: `title`/`testId` 필수, controlled, 스킨 4종 × 테마 2종 대응
4. 계약을 **우회할 수 없을 것** — 타입·린트로 강제
5. 닫기 애니메이션 중 내용물이 먼저 사라지지 않을 것

### 범위 밖 (명시적 비목표)

| 항목                           | 이유                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| Toast / Snackbar               | 스택이 아니라 큐. 생명주기와 배치 규칙이 다르므로 별도 작업     |
| Tooltip                        | `Palette`가 이미 자체 구현. 비모달·비스택이라 코어를 공유 안 함 |
| Popover (앵커 기반 팝업)       | `popover-position.ts` + `popover="auto"`로 충분                 |
| 드래그로 시트 높이 자유 조절   | `'content' \| 'full'` 2단으로 시작 (§13)                        |
| 오버레이 모션 커스터마이징 API | 스킨 토큰으로 충분                                              |

---

## 2. 핵심 원리 — 오버레이는 전역 자원을 점유한다

### 2.1 전역 자원 목록

오버레이가 열릴 때 건드리는, **화면에 하나뿐인** 자원들입니다. 오버레이가 N개 열리면
각 자원이 N번 점유되고, 그게 버그가 됩니다.

| 전역 자원           | 중첩 시 증상                                 |
| ------------------- | -------------------------------------------- |
| 백드롭(scrim)       | 겹쳐서 점점 진해짐                           |
| z-index             | 값 인플레이션, sticky 헤더·토스트와 충돌     |
| 포커스 트랩         | 트랩끼리 경합, 닫을 때 엉뚱한 곳으로 복귀    |
| body 스크롤 잠금    | 안쪽만 닫아도 잠금이 풀려 뒤가 스크롤됨      |
| ESC 키              | 한 번 눌렀는데 전부 닫힘                     |
| 배경 `inert`        | 바로 아래 오버레이까지 비활성화되거나, 안 됨 |
| 히스토리(뒤로 가기) | 오버레이 하나당 엔트리 하나씩 쌓임           |
| 애니메이션 생명주기 | 닫히는 중 재오픈 시 상태 꼬임                |

### 2.2 결정: 자원은 스택이 소유하고, 컴포넌트는 선언만 한다

컴포넌트가 스택에게 "백드롭 켜줘"라고 **명령**하면(위임), 모달 두 개가 각자 명령하므로
스택이 중복을 방어해야 합니다. 방어를 빠뜨리면 원래 문제가 한 겹 아래로 내려갔을 뿐입니다.

그래서 컴포넌트는 그 자원을 **애초에 갖지 않습니다.** 자기 자신에 대한 사실만 선언하고,
결정은 스택이 전체 상태로부터 **계산(derive)** 합니다.

```ts
// 컴포넌트가 선언하는 것 — 자기 자신에 대한 사실뿐
{ modal: true, dismissable: true }

// 스택이 계산하는 것 — 순수 함수
derive(stack) => {
  perOverlay: { isTop, paintsScrim, trapsFocus, inert },
  global:     { scrollLocked: stack.some(o => o.modal) },
}
```

실무적 이득이 분명합니다. 명령형 위임은 `lock()`/`unlock()` 같은 **짝 맞춤 API**가 되고,
짝은 반드시 깨집니다(언마운트 누락, 예외로 인한 조기 리턴, StrictMode의 이펙트 이중 실행).
한 번 깨지면 _스크롤이 영영 잠긴 화면_ 같은 복구 불가 버그가 됩니다.
파생 방식에는 짝 맞춤 자체가 없습니다 — 스택에서 항목이 사라지면 다음 계산에서 자동으로 풀립니다.

**컴포넌트가 계속 소유하는 것**도 명확합니다. 기준은 *뷰포트에 하나뿐인 것은 스택,
패널 안에 갇힌 것은 컴포넌트*입니다: 패널 레이아웃과 사이징, 내부 스크롤 영역,
시트의 드래그 제스처, 트랩 *안에서*의 포커스 순서, 자기 진입/퇴장 애니메이션, `aria-labelledby`.

### 2.3 자원의 세 종류

파생 함수를 쓸 때 이 구분이 전부입니다.

| 종류            | 자원                           | 파생 규칙                            |
| --------------- | ------------------------------ | ------------------------------------ |
| 배타적 (최대 1) | scrim, 포커스 트랩, ESC 수신자 | **최상단이 가진다**                  |
| 누적            | body 스크롤 잠금               | **모달이 1개 이상이면 잠금**(카운트) |
| 계층적          | `inert`                        | **최상단 제외 전부** + 앱 루트       |

백드롭 중첩은 배타적 자원을 누적처럼 다뤄서 생기고, "안쪽만 닫았는데 뒤가 스크롤되는" 버그는
누적 자원을 배타적(boolean)으로 다뤄서 생깁니다. 방향만 다른 같은 실수입니다.

이 중 **`inert`·포커스 가둠·ESC 순서는 직접 구현하지 않습니다.** `<dialog>.showModal()`이
top layer를 LIFO 스택으로 유지하면서 셋 다 정확히 처리합니다. 스택이 소유한다는 원칙은
그대로이고, 그 소유를 플랫폼이 대신 실현할 뿐입니다. 플랫폼이 _스택에 대해_ 틀리는 것은
scrim 하나뿐이라(`::backdrop`은 top layer 요소마다 하나씩 생깁니다) 거기에만 코드가
필요합니다.

---

## 3. 백드롭

### 3.1 중첩이 만드는 문제

백드롭이 겹치면 색이 **선형으로 진해지지 않습니다.** 50% 검정 두 장은 100%가 아니라
75%(1 − 0.5²), 세 장이면 87.5%입니다. 그래서 "겹칠 걸 감안해 각각 25%로 낮추자"는
개수에 따라 틀어지므로 애초에 틀린 접근입니다. **겹침을 보정하지 말고 겹침을 막아야 합니다.**

중요한 함정: 네이티브 `<dialog>`/popover를 써도 `::backdrop`은 top layer **요소마다**
하나씩 생깁니다. 플랫폼에 맡긴다고 자동으로 해결되지 않습니다.

### 3.2 후보 비교

| 후보                        | 총 어둡기 | 깊이감                                 | 판정           |
| --------------------------- | --------- | -------------------------------------- | -------------- |
| 각자 자기 `::backdrop`      | N장       | —                                      | ❌ 문제의 원인 |
| 맨 아래 오버레이만 그린다   | 1장       | 위 모달이 아래 모달과 구분되지 않음    | ❌             |
| **맨 위 오버레이만 그린다** | **1장**   | **아래 모달이 dim 되어 자연히 물러남** | ✅             |

### 3.3 결정: 최상단만 그린다

`::backdrop`은 원래 "자기 요소 바로 아래"에 깔리므로, 최상단만 칠하면 top layer 순서와
의미가 정확히 일치합니다. B가 A 위에 열릴 때:

- 페이지 바깥 영역 — 이전엔 A의 backdrop, 이제는 B의 backdrop이 덮음 → **밝기 연속, 깜빡임 없음**
- A — 이제 B의 backdrop 아래에 놓여 dim 처리됨 → **의도대로 뒤로 물러남**

CSS에 `:topmost` 선택자가 없으므로 스택이 최상단에만 `data-overlay-top`을 부여하고,
CSS는 그 속성에만 scrim 색을 칠합니다(나머지는 `transparent`).

**비모달 오버레이는 scrim을 등록하지 않습니다.** 데스크톱 고정 사이드바(`modality="inline"`),
팝오버, 툴팁이 해당합니다. 그래서 API가 모달리티를 명시적으로 선언하게 만듭니다 — 기본값을
주면 실수로 scrim이 붙습니다.

### 3.4 z-index 정책

이 레포의 `z-index`는 현재 두 곳뿐입니다 — `.skip-link`(10)와 `.palette__tooltip`(1).
이 상태를 자산으로 보고 규칙으로 고정합니다:

> **디자인 시스템 컴포넌트는 raw z-index를 선언하지 않는다. 레이어링은 top layer의 일이다.**

top layer는 조상의 `overflow: hidden`·`transform`·`filter`·`contain`에 잘리거나
고정이 깨지지 않는다는 이점도 함께 옵니다(`main.css`의 팔레트 팝업 주석 참조).

---

## 4. 생명주기 — 닫기는 이벤트가 아니라 트랜잭션이다

### 4.1 두 개의 시계

닫기를 누르면 서로 다른 두 시계가 동시에 돕니다.

- **DOM/CSS 시계** — 패널은 transition이 끝날 때까지 남는다 (`--duration-fast`)
- **데이터/상태 시계** — `setOpen(false)`와 같은 커밋에서 즉시 끝난다 (0ms)

껍데기는 CSS 시계를, 내용물은 상태 시계를 따릅니다. 그래서 **빈 껍데기가 슬라이드 아웃**합니다.
애니메이션 버그가 아니라 생명주기 버그입니다.

### 4.2 네 가지 원인과 진단

`--duration-fast`를 `3s`로 바꿔놓고 닫은 뒤 Elements 패널을 보면 갈라집니다.

| 관찰                              | 깨진 시계 | 원인                                   |
| --------------------------------- | --------- | -------------------------------------- |
| 노드는 있는데 비어 있음           | 데이터    | ① 호출자가 닫으면서 상태를 같이 비움   |
| 내용물 노드 자체가 사라짐         | DOM       | ② 껍데기 안에서 `{open && <Content/>}` |
| 노드는 그대로인데 화면에서 사라짐 | 렌더링    | ③ top layer 조기 이탈                  |
| 내용물만 먼저 페이드아웃          | 모션      | ④ 이중 애니메이션, duration 불일치     |

③은 CSS 쪽 함정이고 `main.css`의 팔레트 팝업이 이미 올바르게 막아두었습니다.

```css
/* `overlay`가 빠지면 닫는 즉시 top layer 이탈,
   `display`가 빠지면 즉시 display:none — 둘 다 애니메이션이 사라진다. */
transition:
  opacity var(--duration-fast) var(--ease-interaction),
  overlay var(--duration-fast) allow-discrete,
  display var(--duration-fast) allow-discrete;
```

`overlay`는 top layer 소속 여부를 나타내는 discrete 속성입니다. transition 목록에 없으면
닫는 즉시 top layer를 떠나 조상의 `overflow`/stacking에 다시 지배당합니다.

④는 이 레포에서 특히 위험합니다 — 스킨마다 duration이 다르므로(office `0s`, kids `380ms`)
한쪽이라도 하드코딩하면 **특정 스킨에서만 재현되는** 버그가 됩니다.

### 4.3 결정: 닫기 트랜잭션은 CSS가 들고, `onClosed`가 자리를 준다

**(1) 상태는 DOM이 갖는다 (구현에서 수정된 결정)**

처음에는 `'closed' | 'opening' | 'open' | 'closing'` phase를 컴포넌트 상태로 두려 했습니다.
구현해 보니 둘 다 불필요했습니다.

- `opening`은 어디서도 읽히지 않습니다. 진입은 전적으로 `@starting-style`이 담당합니다.
- `closing`도 React 상태일 필요가 없습니다. `overlay`/`display`를 `allow-discrete`로
  전환하면 `dialog.close()` 이후에도 브라우저가 요소를 top layer에 붙들어 두므로,
  "닫혔지만 아직 보이는" 상태는 **DOM의 `dialog.open`이 이미 표현**하고 있습니다.

그래서 셸은 **자기 상태를 하나도 갖지 않습니다.** 닫기 한 번이 오버레이를 연 트리 전체로
리렌더를 번지게 하지 않는다는 실질적 이득이 따라옵니다.

**(2) 콜백을 둘로**

```ts
onClose:   () => void;   // 닫기 요청. 실제로 닫는 건 호출자가 open을 내리는 것
onClosed?: () => void;   // 완전히 닫힘. 상태 초기화는 반드시 여기서
```

`onClose` 하나만 주면 **모든 호출자가 거기서 상태를 비웁니다.** 원인 ①은 사용자의 실수가
아니라 API가 유도한 실수입니다.

**(3) 내용물 래치는 만들지 않는다 (구현에서 뒤집은 결정)**

닫히는 동안 마지막으로 그린 내용을 ref에 붙들어 두는 안전망을 계획했지만, 넣지
않았습니다. 세 가지가 겹쳤습니다.

- **기본 문이 이미 면역입니다.** 명령형에서는 레지스트리가 `render`와 엔트리를 트랜지션이
  끝날 때까지 들고 있으므로 내용물이 비워질 경로 자체가 없습니다. 래치가 보호하는 것은
  린트로 막아 둔 선언형 문뿐이고, 그 문은 `onClosed`라는 올바른 자리를 문서화합니다.
- **래치는 렌더 중 ref 쓰기를 요구합니다.** `eslint-plugin-react-hooks` v7의
  `react-hooks/refs`가 이를 금지합니다. 우회하려면 이펙트로 미뤄야 하는데, 그러면 비워진
  `children`이 한 프레임 나가서 막으려던 바로 그 깜빡임이 생깁니다.
- 즉 **API가 이미 막아 둔 경우를 위한 방어**입니다. 규칙을 끄면서까지 넣을 값은 아니라고
  판단했습니다. 선언형 문으로 이 버그가 실제로 관측되면 그때 다시 검토합니다.

**(4) 애니메이션 소유권은 패널 하나** — 내용물은 자기 진입/퇴장 transition을 갖지 않습니다.
시계를 하나로 유지하는 가장 값싼 방법이고 원인 ④를 구조적으로 없앱니다.

**(5) 트랜지션 종료 판정은 실측으로** — `accordion.tsx`의 `transitionSettleMs()`를
같은 방식을 씁니다. 요소의 계산된 duration을 읽으므로 스킨 토큰이 바뀌어도, office의 `0s`여도,
`prefers-reduced-motion`이어도 알아서 맞습니다. `setTimeout(300)`은 스킨 4종 중 3종에서 틀립니다.

### 4.4 재오픈 경합

`closing` 도중 재오픈되면 phase는 `opening`으로 돌아가고, **예약된 `onClosed`는 반드시
취소돼야 합니다.** 남아 있으면 새로 연 오버레이의 상태를 이전 닫기가 뒤늦게 초기화합니다.
증상이 "가끔 모달이 빈 채로 열린다"라서 원래 버그보다 고약합니다.

---

## 5. API — 두 개의 문

### 5.1 결정: 명령형 우선, 선언형은 예비

두 문을 **대등하게** 두면 매번 선택해야 하고, 그 규칙은 시간이 지나면 흐려집니다.
비대칭을 두면 판단이 이렇게 줄어듭니다:

> 그냥 `overlay.modal()`을 쓴다. 아래 셋 중 하나에 걸릴 때만 멈춰서 선언형을 쓴다.

| 상황                                       | 문     | 이유                                 |
| ------------------------------------------ | ------ | ------------------------------------ |
| **기본값 (그 외 전부)**                    | 명령형 | 상태 배선 0, 생명주기 버그 원천 차단 |
| 결과가 값으로 돌아옴 (확인·선택)           | 명령형 | `await` 한 줄                        |
| 컴포넌트 밖에서 호출 (401 인터셉터 등)     | 명령형 | 유일한 방법                          |
| URL 입장 파라미터                          | 명령형 | 마운트 시 한 번 호출로 끝            |
| 서브트리 컨텍스트 필요 (`FormProvider` 등) | 선언형 | 레지스트리는 루트 컨텍스트만 본다    |
| 내용물이 계속 갱신 (진행률·구독)           | 선언형 | 명령형은 클로저에 고정됨             |
| `modality="inline"` 상시 사이드바          | 선언형 | 그건 팝업이 아니라 레이아웃이다      |

선택이 없어지고 **예외 확인**만 남습니다. 그리고 두 번째 문은 신규 코드가 아닙니다 —
명령형 레지스트리가 어차피 껍데기 컴포넌트를 렌더하므로, 선언형은 그걸 export하는 한 줄입니다.

### 5.2 명령형 (기본)

```tsx
const overlay = useOverlay();

const edit = async (todo: Todo) => {
  const saved = await overlay.modal({
    title: t('todos.edit.title'),
    testId: TESTID.todos.editModal,
    size: 'md',
    render: ({ close, resolve }) => <TodoForm todo={todo} onDone={resolve} />,
  });
  if (!saved) return;
  update.mutate(saved);
};
```

푸터 액션은 `renderFooter`로 받습니다. 노드가 아니라 렌더 함수인 이유는 분명합니다 —
답을 내는 버튼이 바로 거기 있으므로 본문과 같은 `resolve`가 필요합니다.

확인 다이얼로그처럼 결과가 값으로 돌아오는 흐름이 `await` 한 줄이 됩니다.

```tsx
const ok = await overlay.modal<boolean>({
  title: t('todos.delete.title'),
  testId: TESTID.todos.deleteConfirm,
  tone: 'danger', // role="alertdialog"
  render: ({ resolve }) => <ConfirmBody onAnswer={resolve} />,
});
```

**`await`에 대해** — 이 Promise는 네트워크와 무관합니다. "나중에 도착하는 값"이 곧
**사용자의 결정**입니다. 그래서:

1. **취소는 예외가 아니므로 절대 reject하지 않습니다.** 취소 시 reject하면 호출부마다
   `try/catch`가 붙습니다. `close()`는 `undefined`로 resolve하고, 그래서 반환 타입이
   `Promise<R | undefined>`이며 호출부에 `if (!saved) return;`이 있습니다.
2. **호출자가 언마운트되면 자동으로 닫고 `undefined`로 resolve합니다.** `useOverlay()`는
   컴포넌트 스코프 훅이라 cleanup에서 자기가 연 것을 정리합니다. 모듈 스코프 싱글턴으로
   부르는 인터셉터 케이스는 스코프가 없으므로 해당하지 않습니다 — 규칙이 깔끔하게 갈립니다.
3. `await` 이후의 클로저 값은 낡았을 수 있으므로 **결과값만 씁니다.**

React에서의 사용 규칙은 하나뿐입니다 — **컴포넌트 함수에 `async`를 붙이지 않습니다.**
핸들러와 이펙트 내부의 async 함수는 평범한 JS입니다.
이 레포 린트 기준으로는 `@typescript-eslint/no-misused-promises`가 `checksVoidReturn: false`라
async 핸들러를 `onClick`에 직접 넘겨도 통과하고, `no-floating-promises`가 `error`라
`onClick={() => { edit(todo); }}`(블록 바디의 표현식 문)는 걸립니다 —
`onClick={() => edit(todo)}` 또는 `void edit(todo)`를 씁니다.

### 5.3 선언형 (예비)

```tsx
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- 편집 폼이 상위 FormProvider 컨텍스트를 사용함
import { Modal } from '@client/ui/overlay/declarative';

<Modal
  open={open}
  onClose={() => setOpen(false)} // 닫기 시작
  onClosed={() => setEditing(null)} // 완전히 닫힌 뒤 — 여기서만 초기화
  title={t('todos.edit.title')}
  testId={TESTID.todos.editModal}
>
  …
</Modal>;
```

`onClose`는 **명령이 아니라 요청**입니다. 컴포넌트는 스스로 닫지 않고 `open`을 내리는 건
호출부이므로, 별도 veto API 없이 조건부 닫기가 공짜로 됩니다.

### 5.4 계약의 단일 출처

두 문이 각자 `title`/`testId`를 선언하면 언젠가 어긋납니다. 계약은 **선언형 props에만**
존재하고 명령형은 거기서 파생시킵니다.

```ts
interface OverlayLifecycle {
  open: boolean;
  onClose: () => void;
  onClosed?: () => void;
}

export interface ModalProps extends OverlayLifecycle {
  title: string; // 필수
  testId: string; // 필수
  dismissable?: boolean; // 기본 true
  initialFocus?: RefObject<HTMLElement>;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'danger';
  children: ReactNode;
}

// 파생 — ModalProps에 prop이 늘면 명령형에도 자동으로 생긴다
type Request<P extends OverlayLifecycle, R> = Omit<P, keyof OverlayLifecycle | 'children'> & {
  render: (api: { close: () => void; resolve: (value: R) => void }) => ReactNode;
};

export interface Overlay {
  modal: <R = void>(req: Request<ModalProps, R>) => Promise<R | undefined>;
  sheet: <R = void>(req: Request<BottomSheetProps, R>) => Promise<R | undefined>;
  sidebar: <R = void>(req: Request<SidebarProps, R>) => Promise<R | undefined>;
}
```

`title`/`testId`는 `Omit` 이후에도 required로 살아남으므로 빠지면 컴파일 실패입니다.
두 문이 **구조적으로 같은 계약**을 갖고, 드리프트가 발생할 자리가 없습니다.

### 5.5 고유 프로퍼티

표현에 관한 것만 다릅니다.

| 컴포넌트      | 고유                                                           | 기본 모달리티 |
| ------------- | -------------------------------------------------------------- | ------------- |
| `Modal`       | `size?: 'sm'\|'md'\|'lg'`, `tone?: 'default'\|'danger'`        | 항상 모달     |
| `BottomSheet` | `snapPoint?: 'content'\|'full'`                                | 항상 모달     |
| `Sidebar`     | `side: 'start'\|'end'`, `modality?: 'auto'\|'modal'\|'inline'` | `auto`        |

`modality="auto"`는 데스크톱에서 비모달(scrim·트랩 없음), 모바일에서 모달입니다.
**호출부에 브레이크포인트 분기가 없습니다** — 모달리티는 scrim·포커스·스크롤을 전부
결정하는 값이라, 호출부로 새어나오면 §2의 규칙이 통째로 무너집니다.

---

## 6. 계약 강제

### 6.1 껍데기 계약 vs 내용물 계약

"계약 우회"를 정확히 답하려면 둘로 쪼개야 합니다.

|                          | 껍데기 계약                                                 | 내용물 계약                                  |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------- |
| 무엇                     | `title`·`testId`, `role`, 포커스·scrim·스크롤·ESC, 생명주기 | 패널 **안쪽** 요소의 testId, 토큰, 포털 금지 |
| 닫히나                   | **타입으로 100%** — 컴파일 실패                             | 타입 밖                                      |
| 명령형 도입으로 나빠지나 | 아니오, **더 강해짐**                                       | 아니오, **선언형과 동일**                    |

내용물 계약은 명령형 때문에 생기는 위험이 아닙니다. 선언형 `<Modal>` 안에도 똑같이
아무 JSX나 넣을 수 있습니다. 명령형의 순증 위험은 0입니다.

### 6.2 타입

명령형에서 껍데기를 레지스트리가 그리면, 호출자는 `render`로 **내용물만** 넘기므로
껍데기를 잘못 그릴 경로가 없습니다. `docs/ui-automation.md` 원칙 1의
_"타입 에러가 나므로 자동화 불가능한 컨트롤이 애초에 만들어질 수 없습니다"_ 가 그대로 적용됩니다.

### 6.3 import 경계

막아야 할 것은 껍데기가 아니라 **코어**입니다. 여기에 손이 닿으면 누구나 네 번째 오버레이
종류를 만들 수 있고, 그때 §2의 규칙이 무너집니다. 선언형은 차단이 아니라 **opt-in**으로 둡니다.

```js
// eslint.config.js — 기존 client 존 블록의 patterns에 추가한다
// (flat config는 같은 규칙 이름을 덮어쓰므로 새 블록을 만들면 server 경계가 사라진다)
{
  files: ['src/client/**/*.{ts,tsx}'],
  ignores: ['src/client/ui/overlay/**'],          // 오버레이 모듈 자신은 예외
  rules: {
    '@typescript-eslint/no-restricted-imports': ['error', {
      patterns: [
        // ↓ 기존 server 경계 항목을 그대로 유지한 채, 아래 두 항목을 덧붙인다
        { group: ['@server/*', '**/server/**'], allowTypeImports: true, message: '…' },
        {
          group: ['**/ui/overlay/internal/*'],
          message:
            'Overlay internals (stack, scrim, focus trap, scroll lock) belong to the overlay ' +
            'module. Use useOverlay() — see docs/overlay-design.md.',
        },
        {
          group: ['**/ui/overlay/declarative'],
          message:
            'Overlays default to the imperative door: useOverlay(). The declarative components ' +
            'exist for three cases only — subtree context, continuously-updating content, and ' +
            'always-visible (inline) overlays. If one applies, disable this rule on the import ' +
            'line and write which case it is:\n' +
            '// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- <이유>',
        },
      ],
    }],
  },
}
```

선언형을 별도 모듈 경로(`declarative.ts`)로 분리한 이유는 상대경로 깊이가 제각각이라
이름 기반 매칭이 취약하기 때문입니다. glob 하나로 잡히고, 덤으로 import 줄이 의도를 드러냅니다.

`-- 이유` 문법은 ESLint 내장이라 플러그인이 필요 없습니다. 이유 작성을 *강제*하려면
`@eslint-community/eslint-plugin-eslint-comments`의 `require-description`이 있지만,
이것 하나 때문에 의존성을 늘리지 않고 **메시지로 요청만** 합니다.

### 6.4 dev 런타임 검사

타입이 못 보는 영역(패널 _안쪽_)을 실제로 잡는 유일한 수단입니다. 프로덕션 비용 0입니다.

```ts
if (import.meta.env.DEV) {
  const bad = panel.querySelectorAll(
    'button:not([data-testid]), a[href]:not([data-testid]), input:not([data-testid])',
  );
  if (bad.length) console.warn(`[overlay:${testId}] ${bad.length} untestable control(s)`, bad);

  for (const el of panel.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.zIndex !== 'auto') {
      console.warn(`[overlay:${testId}] content paints its own layer`, el);
    }
  }
}
```

스택 depth가 임계치를 넘을 때도 경고합니다 — 중첩 금지는 비현실적이지만(폼 모달 위 확인창은
정당합니다) 깊어지는 건 대개 설계 실수입니다.

### 6.5 우회 경로 총정리

| 우회 시도                        | 닫는 층                    | 결과                  |
| -------------------------------- | -------------------------- | --------------------- |
| `title`/`testId` 누락            | 타입 (required)            | 컴파일 실패           |
| 껍데기를 직접 그림               | 타입 (`render`는 내용물만) | 불가능                |
| 코어를 직접 import               | ESLint import 경계         | 린트 실패             |
| 선언형을 이유 없이 사용          | ESLint opt-in 규칙         | 린트 실패 → 주석 필요 |
| 스크롤/ESC/포털 직접 조작        | 공개 API에 없음 + 린트     | 사실상 차단           |
| 내용물 안 raw `<button>`         | dev 런타임 경고            | 경고                  |
| 내용물이 `position:fixed`로 흉내 | dev 런타임 경고            | 경고                  |

아래 두 줄만 경고이고, 이 둘은 선언형을 써도 똑같이 열려 있습니다.

---

## 7. 컴포넌트별 고유 사항

### 7.1 Modal

중첩이 정당한 유일한 케이스(폼 모달 위 확인창)를 가진 컴포넌트입니다. 금지하지 않고
depth 경고로 다룹니다. `tone="danger"`는 `role="alertdialog"`로 매핑합니다.

### 7.2 BottomSheet

- 높이는 `100vh`가 아니라 `100dvh` — 모바일 브라우저 크롬이 접혔다 펴지면 `vh`는 틀립니다
- 키보드가 올라올 때의 시트 높이 처리 (`interactive-widget=resizes-content` 또는 VisualViewport)
- 내부 스크롤 영역에 `overscroll-behavior: contain` — 스크롤 체이닝 차단
- **드래그로 닫기는 반드시 키보드 대안과 병행합니다.** 제스처가 유일한 닫기 수단이면 안 됩니다

### 7.3 Sidebar

브레이크포인트에 따라 **모달리티가 바뀌는 유일한 컴포넌트**입니다(`modality="auto"`).
전환 순간에 scrim·트랩·스크롤 잠금이 한꺼번에 붙거나 떨어지므로, 그 전환을 코어가 처리합니다.
`modality="inline"`은 사실상 레이아웃 요소이므로 선언형 문의 확실한 용도입니다(§5.1).

---

## 8. URL과 뒤로 가기

### 8.1 결정: URL은 상태의 거울이 아니라 입장 지시다

| 모델                | 동작                                  | 비용                                            |
| ------------------- | ------------------------------------- | ----------------------------------------------- |
| URL = 상태의 거울   | 열면 URL 변경, 뒤로가기로 닫힘        | 양방향 동기화 루프, push/replace 판단, popstate |
| **URL = 입장 지시** | **진입 시 한 번 읽고 여는 것으로 끝** | **없음**                                        |

링크 공유라는 실제 요구는 입장 지시만으로 충족되고, 거울 모델의 비용은 전부 사라집니다.
파라미터는 읽은 직후 `replace`로 지웁니다 — 안 지우면 URL이 거짓말을 합니다.

```tsx
const [params, setParams] = useSearchParams();
useEffect(() => {
  const id = params.get('edit');
  if (!id) return;
  setParams(
    (p) => {
      p.delete('edit');
      return p;
    },
    { replace: true },
  );
  void openEditModal(id);
}, []);
```

### 8.2 뒤로 가기는 별도 결정

모바일 바텀시트에서 뒤로가기로 닫히길 기대하는 건 강한 관습입니다. URL 의미론을 건드리지 않고
**history state만** push해서 해결합니다(`history.pushState({ overlay: id }, '', location.href)`),
popstate에서는 최상단만 닫습니다.

이건 개별 컴포넌트가 아니라 **스택이 소유**해야 합니다 — 안 그러면 시트 3개에 엔트리 3개가 쌓입니다.
스택에 `backToDismiss` 자리만 만들고 구현은 실제 모바일 시트가 생길 때로 미룹니다(§13).

---

## 9. 접근성

- `role="dialog"` + `aria-modal="true"`, `tone="danger"`는 `role="alertdialog"`
- 접근 이름은 `title`에서 `aria-labelledby`로 연결 — 그래서 `title`이 required입니다
- 배경 비활성화는 `inert`. 포커스가 안에 있는 동안 조상에 `aria-hidden`을 걸지 않습니다
- **포커스 트랩은 최상단 하나만**, 나머지는 `inert`
- **복귀 지점은 전역 변수가 아니라 스택 프레임마다 각자 기억** — 중첩에서 가장 흔한 버그
- 여는 순간의 포커스는 "첫 번째 포커스 가능 요소"가 아니라 **의미 있는 첫 요소**.
  닫기 X에 포커스가 가면 스크린리더가 "닫기"부터 읽습니다. 모바일 시트에서 입력창 자동 포커스는
  키보드가 시트를 덮으므로 금지
- ESC는 **한 번에 하나만**. `document`에 keydown을 달면 전부 닫힙니다.
  top layer(popover/dialog)에 맡기면 LIFO가 공짜로 따라옵니다
- 백드롭 클릭은 pointerdown 지점이 패널 안이면 무시 — 드래그로 텍스트 선택하다 바깥에서
  손을 뗀 경우가 닫히면 안 됩니다
- 입력 중인 데이터가 있으면 `dismissable={false}`

---

## 10. 스킨 대응

모션은 반드시 토큰 경유입니다. office는 `--duration-fast: 0s`라 즉시 열리고 kids는
`cubic-bezier(0.34, 1.8, 0.5, 1)`로 튑니다. 하드코딩하면 특정 스킨에서만 깨집니다.

추가할 시맨틱 토큰:

| 토큰                  | 용도                           |
| --------------------- | ------------------------------ |
| `--overlay-scrim`     | 최상단 백드롭 색 (스킨·테마별) |
| `--overlay-max-width` | 모달 폭 상한                   |
| `--sheet-max-height`  | 바텀시트 `full` 스냅 높이      |
| `--sidebar-width`     | 사이드바 폭                    |

`prefers-reduced-motion: reduce`에서는 전환이 0이 되고, 그때도 **중간의 빈 프레임이
없어야** 합니다(§4.3-5의 실측 방식이 이를 보장합니다).

### 10.1 스크롤 박스는 인터랙션 여유를 확보한다

첫 배포에서 실제로 터진 버그입니다. kids 스킨에서 모달 안 버튼에 호버하면 **스크롤바가
생기면서 버튼의 왼쪽 외곽선과 그림자가 잘렸습니다.** 원인은 `.overlay__body`가 패딩 없는
스크롤 컨테이너였다는 것 하나입니다.

스크롤 컨테이너는 **padding box 경계에서 자릅니다.** 그리고 넘치는 방향에 따라 증상이
갈립니다 — 블록 끝/인라인 끝으로 넘친 건 스크롤 가능 영역으로 계산돼 **스크롤바가 생기고**,
블록 시작/인라인 시작으로 넘친 건 명세상 스크롤 영역에 포함되지 않아 **그냥 잘립니다.**
둘이 동시에 나타난 이유가 이것입니다.

레포가 같은 계열 문제를 이미 두 번 우회했다는 점이 이게 일반적 패턴이라는 증거입니다 —
아코디언은 포커스 링을 `outline-offset` 음수로 안쪽에 그리고(`main.css`), 팔레트 툴팁은
일부러 스크롤 박스 바깥에 렌더합니다.

**성장의 종류가 둘이고, 대응도 둘입니다.**

| 성장            | 예                                          | 고정 여유로 막히나 | 대응                              |
| --------------- | ------------------------------------------- | ------------------ | --------------------------------- |
| 크기에 **비례** | `scale`, `rotate` — 자식이 넓을수록 더 커짐 | ❌ 불가능          | 스크롤 박스가 해당 토큰을 중화    |
| **상수**        | 포커스 링(6px), 그림자, lift                | ✅ 가능            | bleed(패딩 + 같은 크기 음수 마진) |

`.scroll-box` 하나가 둘 다 합니다. 비례 손잡이 중화는 **커스텀 프로퍼티 상속**으로 하므로
스킨 이름도 컴포넌트 이름도 나열하지 않습니다 — 토큰을 소비하는 것은 나중에 추가되는
컴포넌트까지 전부 무장해제됩니다. 눌렀을 때의 `scale(0.9)`는 _작아지는_ 방향이라 넘칠 수
없으므로 그대로 둡니다. 스킨은 성격을 유지하고, 이 안에서만 커지지 않습니다.

측정 (전체폭 버튼, kids. 음수 = 상자 안쪽 = 안전):

|                           | 호버 좌측      | 스크롤바 | 포커스 링    |
| ------------------------- | -------------- | -------- | ------------ |
| 수정 전                   | 21.1 잘림      | 발생     | 6px 잘림     |
| bleed만                   | 9.1 잘림       | 없음     | 안전         |
| 중화만                    | 0 (여유 제로)  | 없음     | **6px 잘림** |
| **`.scroll-box` (둘 다)** | **−12**        | **없음** | **안전**     |
| ↑ 스킨을 3배로 과장해도   | **−12 (불변)** | 없음     | 안전         |

**둘 중 하나로는 부족합니다.** 중화만 하면 포커스 링이 그대로 잘립니다 — `outline`은
`transform`이 아니라 토큰 중화가 닿지 않기 때문입니다. bleed만 하면 자식이 넓어지는 순간
무너집니다.

bleed는 음수 마진으로 상쇄되므로 flex `gap`을 잡아먹습니다. 스크롤 박스를 끼워 넣는
레이아웃은 `--scroll-bleed`를 자기 gap에 더해 돌려놓습니다(`.overlay__panel` 참조).

**남은 한계**(정직하게):

- 하드코딩된 비례 변형(`.card`/`.todo-item`의 `scale(1.02) rotate(-1deg)`)은 토큰을 쓰지
  않아 중화를 피해 갑니다. bleed가 흡수하지만 여유가 크지 않으므로, 그 값들을 토큰으로
  바꾸는 것이 후속 과제입니다
- `.scroll-box` 대신 raw `overflow: auto`를 쓰면 여전히 무방비입니다. 이건 관례이지 강제가
  아니고, 강제하려면 스킨별 호버 회귀 검사(§13)가 필요합니다

---

## 11. 모듈 구조

```
src/client/ui/overlay/
├── index.ts                  # 공개 표면 — OverlayProvider, useOverlay
├── declarative.ts            # Modal / BottomSheet / Sidebar 재export (opt-in 문)
├── overlay-stack.ts          # 순수 리듀서: open/beginClose/remove/derive
├── overlay-stack.test.ts     # DOM 없이 중첩 규칙 검증 (10 케이스)
├── registry.tsx              # OverlayProvider + 아웃렛 + useOverlay
└── internal/                 # ESLint로 잠김
    ├── overlay-shell.tsx     # 공용 <dialog> 셸 — 상태 없음, 전부 이펙트/콜백
    ├── stack-context.tsx     # 스택 상태 + 스크롤 잠금 + depth 경고
    ├── modal.tsx             # 계약의 출처 (ModalProps)
    ├── bottom-sheet.tsx
    ├── sidebar.tsx           # modal 셸 / inline <aside> 분기
    └── use-media-query.ts    # modality="auto"의 브레이크포인트
```

`popover-position.ts`가 취한 방식 그대로입니다 — **순수 로직을 분리하고 컴포넌트는 얇게.**
스택 리듀서는 DOM 없이 테스트되므로, 중첩 규칙(scrim 소유자, 잠금 카운트, inert 대상)이
브라우저 없이 검증됩니다.

아웃렛은 `app.tsx`의 `<BrowserRouter>` 안쪽, `<Shell />` 옆에 둡니다 — 쿼리 캐시·테마·i18n·
라우터가 모두 살아 있는 지점입니다. 명령형 오버레이가 볼 수 있는 컨텍스트는 이 위치로
**정적으로 결정**되며, 그 밖의 것(서브트리 컨텍스트)은 컨텍스트가 아니라 props로 받습니다.

> 컨텍스트 브리지(호출 지점의 컨텍스트를 붙잡아 렌더 지점에서 다시 제공)는 **기각**합니다.
> React에서 범용 브리지는 불가능해 컨텍스트 목록을 손으로 나열해야 하고, 그 목록은 반드시
> 낡습니다. 낡은 줄 모르는 채로요.

---

## 12. 부수 작업

### testid

`TESTID`에 오버레이 항목을 등록하고, 컴포넌트가 `{testId}.panel` / `.close` / `.title`을
파생합니다 — `Palette`가 `.popup` / `.swatch.<hex>`를 파생하는 방식 그대로입니다.

`docs/ui-automation.md`에 한 줄 추가합니다: 오버레이는 top layer에 뜨므로 DOM 위치가 아니라
testid나 `role="dialog"`로 잡고, 열림/닫힘 대기는 패널의 존재로 합니다.

### i18n

닫기 버튼의 `aria-label`, 확인/취소 기본 레이블을 `en.ts`/`ko.ts`에 추가합니다.

### 디자인 시스템 페이지

`design-system-page.tsx`에 오버레이 섹션을 추가합니다 — 단일/중첩/세 종류를 모두 열어볼 수
있어야 백드롭 중첩 규칙을 눈으로 검증할 수 있습니다.

---

## 13. 지금 만들지 않는 것 (자리만 남긴다)

| 항목                        | 미루는 이유                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| `TestId` 브랜딩             | 가치는 있으나 전 컴포넌트에 걸치는 **별도 작업**. 묶으면 리뷰 2배   |
| `backToDismiss` 히스토리    | 실제 모바일 시트 없이는 검증 불가. 스택에 자리만                    |
| `snapPoint` 자유 배열       | `'content' \| 'full'` 2단으로 시작                                  |
| 내용물 래치                 | 기본 문이 이미 면역이고, 린트 규칙과 충돌 (§4.3-3)                  |
| `.card`/`.todo-item` 토큰화 | 하드코딩된 비례 변형을 중화 범위에 넣는 작업 (§10.1)                |
| 스킨별 호버 회귀 검사       | 새 스크롤 박스까지 잡는 유일한 수단. E2E 하네스 신설이 필요 (§10.1) |
| 컨텍스트 브리지             | 명시적으로 안 함 (props 규칙으로 대체)                              |
| 모션 커스터마이징 API       | 스킨 토큰으로 충분                                                  |

`TestId` 브랜딩은 별건이지만 같은 걱정의 연장입니다. 현재 `docs/ui-automation.md` 원칙 2
("testid 문자열은 인라인으로 쓰지 않습니다")는 **관례일 뿐 강제가 아닙니다** — `testId: string`이라
인라인 문자열이 그냥 통과합니다. `HexColor`와 같은 브랜딩으로 닫을 수 있으니 별도 작업으로 권합니다.

---

## 14. 회수 판정 기준

이 설계가 과했는지는 나중에 네 가지로 확인할 수 있습니다.

1. 오버레이 4개를 만들 때까지 `z-index`를 한 번도 쓰지 않는다 (현재 레포 전체 2곳 유지)
2. 폼 모달 위에 확인창을 띄우는 데 추가 코드가 0이다
3. 새 오버레이 추가가 호출 1줄이다
4. 스킨 4종 × 테마 2종에서 오버레이 CSS를 손대지 않는다

넷 다 충족되면 투자가 회수된 것이고, 하나라도 깨지면 코어가 잘못 잘린 것입니다.

---

## 참고

- `src/client/ui/popover-position.ts` — 순수 기하 모듈. 코어 분리 방식의 선례
- `src/client/ui/accordion.tsx` — `transitionSettleMs()`, 실측 기반 전환 종료 판정
- `src/client/styles/main.css` (팔레트 팝업) — top layer + `allow-discrete` + `@starting-style`
- `docs/palette-design.md` §7 — 팝업 레이어 후보 비교
- `docs/ui-automation.md` — testid 계약
