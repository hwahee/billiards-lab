# 업스트림 업데이트 적용: 채팅 · React 프로덕션 빌드 · React Compiler (2026-09)

이 보일러플레이트에서 출발해 자기 기능을 쌓은 저장소(이하 **다운스트림**)에서 일하는 AI 에이전트를 위한
적용 절차입니다. 이 업데이트를 머지한 뒤 이 문서를 위에서부터 끝까지 따르세요.

| PR                                                                                                          | 내용                                                                         | main 머지 순서 |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------- |
| [#16](https://github.com/hwahee/boilerplate/pull/16)                                                        | 배포 빌드에 React 프로덕션 빌드를 싣기                                       | 1              |
| [#17](https://github.com/hwahee/boilerplate/pull/17) → [#18](https://github.com/hwahee/boilerplate/pull/18) | Bun 내장 React Compiler로 컴포넌트 자동 memo, 컴파일 리포트                  | 2              |
| [#19](https://github.com/hwahee/boilerplate/pull/19)                                                        | 붙일 수 있는 채팅(서버·클라이언트 코어·홈 채팅), 마이그레이션 번호 충돌 검사 | 3              |

#17은 다른 브랜치에 머지되어, 같은 커밋이 #18로 main에 들어갔습니다. #19는 먼저 올렸다 닫은 #15를 검토해 다시 올린 것입니다.
아래에서 PR 번호는 변경 묶음을 가리키는 이름입니다. 다운스트림은 `upstream/main`을 한 번 머지하면 셋을 모두 받습니다.

## 0. 작업 원칙

- 다운스트림의 `CLAUDE.md`가 업스트림과 다르면 **다운스트림 것이 우선**입니다. 업스트림의 새 규칙은 다운스트림
  전제와 부딪히지 않는 범위에서 더합니다.
- **3절의 결정 항목은 에이전트가 정하지 않습니다.** 사람에게 묻고, 답을 받기 전에는 기본값(각 항목에 적음)으로 둡니다.
- 각 단계 끝의 검증 명령이 통과해야 다음 단계로 갑니다. Bun은 **1.4.2 이상**이어야 합니다(`bun --version`).

## 1. 이미 적용됐는지 확인

| 확인                                                | 적용됨의 의미        |
| --------------------------------------------------- | -------------------- |
| `grep -n "process.env.NODE_ENV" scripts/build.ts`   | #16                  |
| `grep -n "reactCompiler: true" scripts/build.ts`    | #17                  |
| `ls migrations/*_chat.sql src/client/chat/hooks.ts` | #19                  |
| `grep -n "planMigrations" src/server/db/migrate.ts` | #19의 번호 충돌 검사 |

일부만 적용된 상태라면 빠진 PR의 절(4.1 / 4.2 / 4.3)만 따르면 됩니다.

## 2. 가져오기와 충돌 해결

```bash
git remote add upstream https://github.com/hwahee/boilerplate.git   # 한 번만
git fetch upstream
git switch -c chore/upstream-2026-09
git merge upstream/main        # 공유 브랜치는 rebase하지 않습니다
```

충돌이 잘 나는 곳과 해결 원칙입니다. 대부분 **양쪽을 다 살리는 추가형**입니다.

| 파일                                                          | 해결 원칙                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`, `README.md`                                      | 다운스트림 내용을 유지하고 업스트림의 새 절을 더합니다: "React 렌더링 최적화", 게스트 절의 "예외 — 채팅", "업스트림 업데이트 적용". **Git이 충돌 없이 합쳐도 내용이 모순될 수 있습니다**(예: 다운스트림의 "게스트는 쓰기 불가"와 업스트림의 "예외 — 채팅"이 함께 남음). 머지 후 `CLAUDE.md`를 처음부터 다시 읽고, 모순되는 부분은 3절 결정으로 가져갑니다.                                                                                                                                                          |
| `scripts/build.ts`                                            | 다운스트림의 엔트리포인트·옵션을 유지하되, **클라이언트를 번들하는 모든 `Bun.build`**에 `define['process.env.NODE_ENV']`, `reactCompiler: true`, `metafile: true`와 두 가드(개발용 React 검사, 컴파일러 런타임 검사)가 있어야 합니다.                                                                                                                                                                                                                                                                               |
| `eslint.config.js`                                            | 다운스트림이 클라이언트 파일에 `no-restricted-syntax`나 `@typescript-eslint/prefer-nullish-coalescing`을 이미 설정했다면 합쳐야 합니다. flat config에서는 파일 범위가 겹치는 블록이 같은 규칙을 설정하면 **뒤 블록의 옵션이 앞 블록을 통째로 대체**해, 앞 블록의 설정이 조용히 사라집니다. 업스트림 블록(`src/client/**/*.tsx`)의 `no-restricted-syntax` 목록에 다운스트림 블록의 선택자들을 **모두 다시 적어** 넣습니다. 확인: `bunx eslint --print-config src/client/app.tsx`에 양쪽 선택자가 모두 나와야 합니다. |
| `migrations/0003_chat.sql`                                    | 다운스트림이 `0003`을 이미 썼다면 **다음 빈 번호로 이름을 바꿉니다**(예: `0009_chat.sql`). 4.3의 1번을 보세요.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/server/app.ts`                                           | 소켓 데이터가 `SocketData = { kind: 'todos' } \| ChatSocketData` 유니온이 됐습니다. 다운스트림의 WebSocket 엔드포인트는 자기 `kind`를 유니온에 더하고 `server.upgrade(req, { data: { kind: … } })`로 넘기며, `open`/`message`/`close`에서 `ws.data.kind`로 나눕니다.                                                                                                                                                                                                                                                |
| `src/server/container.ts`                                     | `chatService()`, `chatGateway()`, presence 저장소(`ContainerOverrides.presence`)를 더하고, `dispose()`에서 presence를 닫습니다.                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/server/index.ts`                                         | 서버를 띄우기 전에 `openRoom(HOME_CHAT_ROOM)`을 호출합니다(홈 채팅을 둘 때만). `chatGateway().start()`가 돌려주는 stop 함수는 `server.stop()`보다 먼저 호출합니다.                                                                                                                                                                                                                                                                                                                                                  |
| `src/server/worker.ts`                                        | 채팅 보존 기한 정리 타이머가 추가됐습니다. `startWorker`가 돌려주는 stop 함수가 이 타이머도 멈춥니다.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/server/repositories/*`, `src/server/pubsub/types.ts`     | 추가만 있습니다(채팅 저장소, `CHANNELS.chatMessages`/`chatPresence`).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/server/http/api.integration.test.ts` 등 테스트           | 서버 타입이 `Bun.Server<SocketData>`입니다(`import { type SocketData } from '../app'`).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/client/app.tsx`                                          | `/`가 `HomePage`(할 일 + 채팅)를 렌더합니다. 다운스트림이 홈을 바꿨다면 3절 2번.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/shared/i18n/messages/*.ts`                               | `chat.*` 키 16개가 추가됐습니다. **다운스트림이 추가한 로케일에도 전부 넣어야** 타입 검사가 통과합니다(`Record<MessageKey, string>`).                                                                                                                                                                                                                                                                                                                                                                               |
| `src/client/testing/testids.ts`, `src/client/styles/main.css` | 추가만 있습니다. 다운스트림 CSS에 `.chat-*`, `.home-layout` 클래스가 있으면 이름이 겹치지 않는지 확인합니다.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `package.json`                                                | 스크립트 `chat:load`, `compiler:report`가 추가됐습니다. `bun.lock`은 손으로 고치지 말고 `bun install`로 다시 만듭니다.                                                                                                                                                                                                                                                                                                                                                                                              |

검증: `bun install && bun run check`

## 3. 사람에게 확인할 결정

1. **게스트의 채팅 전송**. 업스트림은 게스트도 채팅을 보내게 했습니다(CLAUDE.md의 "예외 — 채팅"). 다운스트림의 게스트
   정책이 더 엄격하다면 사람에게 묻습니다.
   - 막기로 하면: `src/server/routes/chat.ts`의 `POST` 첫 줄에 `requireMember(ctx.caller)`를 넣고, 입력창은 회원에게만 보이게 합니다.
   - 게스트의 소켓 입장과 읽기는 그대로 열어 둡니다.
   - 기본값: 업스트림대로 허용.
2. **홈 채팅 유지 여부**. 다운스트림이 홈 화면을 바꿨다면 묻습니다.
   - 유지: 다운스트림 홈에 `<HomeChat />`을 배치합니다.
   - 제거: `index.ts`의 `openRoom(HOME_CHAT_ROOM)`, `src/client/pages/home-page.tsx`, `home-chat.tsx`, `src/shared/domain/home-chat.ts`, `home.*` testid와 관련 CSS를 지웁니다. 채팅 코어(`src/client/chat`, 서버 쪽 전부)는 다른 기능이 쓰도록 남깁니다.
   - 기본값: 유지.
3. **인터넷 노출**. 채팅에는 아직 도배 제한과 신고·삭제 기능이 없습니다. 게스트 전송까지 열린 상태로 운영에 노출하기 전에 사람에게 알립니다.
4. **React Compiler 사용**. Bun의 실험 기능입니다. 끄려면 `scripts/build.ts`의 `reactCompiler: true`와 컴파일러 런타임 가드를 지웁니다. 기본값: 켬.

## 4. PR별 조치

### 4.1 #16 — React 프로덕션 빌드

1. 클라이언트를 번들하는 모든 빌드에 `define: { 'process.env.NODE_ENV': '"production"' }`가 있는지 확인합니다.
   서버의 HTML import로 번들되는 클라이언트는 이 값을 스스로 정하지 않아서, 없으면 React 개발 빌드가 배포됩니다(약 4배 느림).
2. 빌드 후 `dist/*.js`에 `jsxDEV`가 있으면 실패하는 가드가 있는지 확인합니다.

검증: `bun run build`가 성공하고, `grep -c jsxDEV dist/*.js`가 모두 0.

### 4.2 #17 — React Compiler

배포 빌드(`bun run build`)만 `.tsx` 파일을 컴파일합니다. **개발 서버와 `.ts` 파일은 컴파일되지 않으므로**,
코드는 컴파일러 없이도 올바르게 동작해야 합니다.

1. **Bun 버전.** `bun build --help | grep react-compiler`가 나와야 합니다. 안 나오면 `package.json`의
   `packageManager`·`engines.bun`과 `Dockerfile`의 `oven/bun` 이미지를 1.4.2 이상으로 올립니다.
2. **빌드 설정.** `reactCompiler: true`, `metafile: true`를 켜고, 메타파일 입력에 `compiler-runtime`이 없으면
   실패하는 가드를 둡니다(업스트림 `scripts/build.ts` 참고).
3. **린트 오류 고치기.** `bun run lint`에서 `no-restricted-syntax`(논리 할당) 오류가 난 클라이언트 `.tsx`를 풉니다.
   - `x ||= y` → `if (!x) x = y`
   - `x &&= y` → `if (x) x = y`
   - `x ??= y` → `if (x === null || x === undefined) x = y` (타입이 `T | null`이면 `x === null`만 검사)
   - 컴파일러는 이 문법이 든 컴포넌트를 **통째로, 아무 경고 없이** 건너뜁니다. `.ts` 파일은 해당 없습니다.
4. **컴파일 현황 점검.** `bun run compiler:report`가 컴파일되지 않은 컴포넌트·훅을 보여 줍니다.
   - `.ts` 파일의 훅은 원래 컴파일되지 않습니다.
   - `.tsx`의 항목마다 "캐시할 게 없는 것"(예: `useContext`만 읽는 훅)인지, "건너뛴 것"인지 판단합니다.
   - 건너뛴 컴포넌트가 성능상 중요하면 아래 원인을 고칩니다. 원인은 컴파일러 메시지에서 확인한 것입니다.
     - 컴포넌트 안의 `catch` 없는 `try`, `finally`가 있는 `try`, `try/catch` 안의 `throw`
     - `for await`, `var`, 컴포넌트 안의 클래스 선언이나 표현식, 제너레이터(`yield`), `this`, `eval`, `with`
     - 보간이 든 태그드 템플릿(예: 컴포넌트 안의 `` css`…${x}` ``)
     - 클로저가 붙잡은 변수를 `x++`, `x += 1`로 바꾸기, 구조 분해 패턴에 대한 복합 대입, 객체 구조 분해의 계산된 키
     - 손으로 쓴 `useMemo`·`useCallback`의 의존성이 컴파일러 추론과 다름(ESLint `react-hooks/preserve-manual-memoization`)
     - React 규칙 위반: 렌더 중 ref 읽기, props·state 변경, 렌더 중 `Date.now()`·`Math.random()` 같은 비순수 호출 등.
       `eslint-plugin-react-hooks` 7의 recommended 규칙이 잡으니 **다운스트림에서 이 규칙들을 끄지 마세요.**
     - 컴파일러가 알려진 비호환 라이브러리로 분류한 것: TanStack Table `useReactTable`, TanStack Virtual `useVirtualizer`,
       React Hook Form `useForm`. 이 컴포넌트들은 건너뛰므로 손으로 쓴 memo를 유지합니다.
5. **손으로 쓴 memo 정리(선택, 권장).** 다운스트림 `.tsx`의 `memo`·`useMemo`·`useCallback`을 하나씩 분류합니다.
   남겨 둬도 동작은 같습니다(컴파일러가 보존함). 판단이 서지 않으면 남깁니다.

   | 종류                      | 예                                                                                                                                                                                 | 조치                      |
   | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
   | 속도만을 위한 것          | 목록 행 `memo`, 파생 값·객체 `useMemo`(받는 쪽이 내용으로 비교)                                                                                                                    | 지웁니다                  |
   | 동일성에 기대는 것        | 이펙트 의존성, context로 내려가는 함수, 커스텀 훅이 돌려주는 함수·객체, 동일성으로 비교하는 라이브러리 입력(`useSyncExternalStore`의 subscribe, TanStack Table의 `columns`/`data`) | 남깁니다                  |
   | `.ts` 파일 안의 모든 memo | —                                                                                                                                                                                  | 남깁니다(컴파일되지 않음) |

   지운 뒤에는 **개발 서버**(컴파일되지 않음)에서 해당 화면을 열어, 이펙트가 반복 실행되거나 요청이 반복되지 않는지 확인합니다.

6. **배포 산출물로 테스트.** 컴파일러는 배포 빌드에서만 돌기 때문에, 컴파일러 자체의 문제는 배포 빌드에서만 드러납니다.
   다운스트림의 E2E·수동 점검을 `bun run build && bun run start`로 띄운 앱에서 한 번 돌립니다.

검증: `bun run check`, `bun run build`(가드 통과), `bun run compiler:report`의 `.tsx` 항목마다 판단 완료.

### 4.3 #19 — 채팅

1. **마이그레이션 번호.** 마이그레이션은 번호만으로 식별됩니다.
   - 다운스트림에 같은 번호의 파일이 있으면 업스트림의 `0003_chat.sql`을 **다음 빈 번호로 바꿉니다**(파일 첫 줄 주석의 번호도 함께).
   - 업데이트된 러너는 번호가 겹치거나, 기록된 이름과 파일 이름이 다르면 멈추고 해결 방법을 출력합니다. 전에는 조용히 건너뛰었습니다.
   - 앞으로 업스트림 마이그레이션을 가져올 때마다 같은 방식으로 번호를 맞춥니다.
2. **배포 순서.** 새 서버를 띄우기 **전에** 모든 환경에서 마이그레이션을 적용합니다.
   - 로컬: `bun run db:migrate`, 컨테이너: `bun migrate.js`.
   - 서버는 부팅할 때 홈 채팅방을 열기 때문에, `chat_rooms` 테이블이 없으면 시작에 실패합니다.
3. **프록시와 로드밸런서.** 새 WebSocket 경로 `/ws/chat`도 `/ws`처럼 업그레이드 헤더와 함께 전달되게 합니다.
4. **Redis.** `PUBSUB_DRIVER=redis`면 접속자 목록도 Redis 해시(`presence:<방 id>`, 60초 TTL)에 둡니다.
   Redis 계정에 `HSET`·`HDEL`·`HGETALL`·`PEXPIRE` 권한이 있어야 합니다.
5. **인증 연동.** 채팅은 `ctx.caller`(HTTP)와, 소켓 업그레이드 때의 `readCaller(req, config)`로 신원을 읽습니다.
   - 다운스트림이 인증 드라이버나 `Caller`를 바꿨다면 두 가지를 확인합니다. 회원이 `{ kind: 'member', userId }`로 오는지, `ChatService.participantFor`가 `UserRepository.findById`로 표시 이름을 찾는지.
   - 게스트 식별(`guestId`)은 탭이 만들어 쿼리·본문으로 보내며, 인증과는 무관합니다.
6. **다운스트림 기능에 채팅 붙이기**(원할 때).
   - 서버: 기능이 방을 만드는 시점에 `container.chatService().openRoom({ id: '<기능>.<id>', policy })`를 호출합니다.
   - 클라이언트: `useChatRoomState(roomId, (room) => room.messages)`처럼 필요한 조각만 구독합니다. `select`는 새 배열이나 객체를 만들지 말고 기존 조각을 그대로 돌려줍니다.
   - 보내기와 "내 메시지" 판별은 `useChatRoomActions(roomId)`로 합니다. 화면은 기능마다 직접 그립니다.
   - 예시는 `src/client/pages/home-chat.tsx`, 자세한 설명은 README의 "채팅" 절입니다.
7. **알아 둘 동작 변화.**
   - `formatUtcInTimeZone`이 locale과 시간대별로 포맷터를 재사용합니다. 결과는 같습니다.
   - `DB_DRIVER=memory`에서는 채팅 메시지가 쌓일수록 전송이 느려집니다(트랜잭션마다 저장소 전체를 복사함). 테스트·로컬 전용 드라이버의 한계입니다.

검증: `bun run check`, `bun run db:migrate`(스테이징 DB 사본에서 `NNNN_chat`이 적용됨), 아래 5절.

## 5. 완료 조건

- [ ] `bun run check` 통과
- [ ] `bun run build` 통과(개발용 React 가드, 컴파일러 가드)
- [ ] `bun run compiler:report`의 `.tsx` 항목마다 판단 완료(4.2의 4번)
- [ ] 모든 환경의 배포 절차에 "마이그레이션 → 새 서버" 순서가 들어감, `/ws/chat` 프록시 설정 완료
- [ ] 배포 산출물로 띄운 앱에서 확인: 다운스트림 주요 화면, 로그인·로그아웃, 홈 채팅(브라우저 두 개로 주고받기, 접속자 목록)
- [ ] (선택) `bun run chat:load 300 100`, 멀티 인스턴스라면 `PUBSUB_DRIVER=redis`로 한 번 더
- [ ] 다운스트림 `CLAUDE.md`에 업스트림의 새 절이 다운스트림에 맞게 반영됨
- [ ] 3절의 결정 항목에 대해 사람의 답을 받았거나, 기본값으로 둔 것을 알림

## 6. 되돌리기

- **React Compiler만 끄기**: `scripts/build.ts`의 `reactCompiler: true`와 컴파일러 런타임 가드를 지웁니다. 4.2에서 뺀 memo는 성능만
  영향이 있으니 필요한 곳에만 되돌립니다.
- **채팅 걷어내기**: 서버 배선(`app.ts`의 `/api/chat/*`·`/ws/chat`, `index.ts`, `container.ts`, `worker.ts`)과 홈 채팅을 지웁니다.
  `chat_*` 테이블은 데이터가 필요 없을 때만 새 마이그레이션으로 지웁니다. 이미 적용된 마이그레이션 파일은 지우거나 번호를 바꾸지 않습니다.
