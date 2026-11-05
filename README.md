# Bun Fullstack Boilerplate

React + Bun + Bun server 기반의 풀스택 모노레포 보일러플레이트입니다. 서버와 클라이언트가
하나의 저장소에서 살고, 공통 코드는 `src/shared`에 둡니다.

```
src/
├── shared/          # 서버·클라이언트 공통 (양쪽 모두에서 import 가능)
│   ├── validation/  # 스키마 검증 파사드 (현재 zod/mini, 교체 가능)
│   ├── i18n/        # 로케일 협상 + 메시지 카탈로그 (en/ko)
│   ├── time/        # UTC 전용 시간 유틸 (경계에서만 타임존 변환)
│   ├── api/         # 페이지네이션 규약, 에러 엔벨로프, 버전 핸드셰이크
│   └── domain/      # 도메인 타입 + 검증기 (서버·클라이언트 공용 계약)
├── server/          # Bun server (API + 클라이언트 서빙 + 워커)
│   ├── http/        # 라우트 공통 미들웨어 (CORS, 버전, 에러 매핑, locale)
│   ├── auth/        # 요청 신원(서명된 세션 쿠키) + 회원 서버 로그인(OIDC 표준만)
│   ├── routes/      # 엔드포인트 정의
│   ├── services/    # 비즈니스 로직 (트랜잭션 경계가 여기서 드러남)
│   ├── repositories/# 영속성 계약 + postgres/in-memory 구현
│   ├── db/          # Bun 내장 SQL 드라이버, 마이그레이션 러너
│   ├── pubsub/      # 인스턴스 간 통신 (memory/redis 드라이버)
│   ├── presence/    # 누가 어디에 접속해 있나 (memory/redis 드라이버, 채팅 접속자 목록)
│   ├── realtime/    # 채팅 WebSocket 게이트웨이 (/ws/chat)
│   └── container.ts # 컴포지션 루트 — 프로세스당 싱글톤 관리
└── client/          # React SPA
    ├── api/         # ★ 모든 API가 endpoints.ts 한 곳에 문서화되어 모임
    ├── auth/        # 헤더의 로그인/로그아웃 컨트롤
    ├── chat/        # 채팅 코어 — 소켓·방 상태·useChatRoomState/Actions (UI 없음)
    ├── ui/          # 디자인 시스템 컴포넌트
    ├── styles/      # 디자인 토큰 (라이트/다크 × 디자인 A/B)
    ├── theme/ i18n/ # 테마·로케일 컨텍스트
    ├── testing/     # data-testid 레지스트리 (docs/ui-automation.md 참고)
    └── pages/       # Home(Todos + 채팅), Design System, 로그인 실패, NotFound

public/             # 런타임에 디스크에서 읽는 정적 데이터 (번들되지 않음)
└── sitemap.json    # 서비스 디렉터리 — 푸터의 "Other Services" 컬럼 소스
```

## 요구 사항

| 런타임 | 버전        |
| ------ | ----------- |
| Bun    | **1.4.2**   |
| Node   | **24.19.0** |

버전은 `package.json` 한 곳에만 적혀 있습니다 — `packageManager`(`bun@1.4.2`)와
`engines`(`bun`/`node`). CI는 이 필드를 그대로 읽고(`setup-bun`은 `packageManager`,
`setup-node`는 `engines.node`), Docker 이미지도 같은 버전(`oven/bun:1.4.2`)을 씁니다.
버전을 올릴 때는 `package.json`과 `Dockerfile`만 고치면 됩니다.

애플리케이션은 Bun으로 실행·빌드·테스트합니다. Node는 Bun 밖에서 도는 에디터
플러그인·툴링(ESLint/TypeScript 언어 서버 등)이 쓰는 런타임이라 함께 고정합니다.

## 시작하기

```bash
bun install               # 의존성 설치 (+ husky 훅 설치)
cp .env.example .env      # 환경 설정 — 비밀값은 절대 커밋 금지

bun run db:setup          # docker로 Postgres 기동 + 마이그레이션 + 시드 (한 번에)
bun run dev               # 개발 서버 (서버 watch + 클라이언트 HMR) → http://localhost:3000
```

로그인은 회원 서버([hwahee/boilerplate-auth](https://github.com/hwahee/boilerplate-auth))가 맡으므로
로컬에서도 회원 서버를 함께 띄웁니다(그 저장소 README의 "시작하기": `db:setup` → `hydra:up` →
`services:register` → `dev`). 회원 서버 없이 띄우려면 `.env`에서 `AUTH_DRIVER=none`으로 바꿉니다.

DB 없이 바로 실행하려면 `.env`에서 `DB_DRIVER=memory`로 바꾸면 됩니다(테스트도 이 드라이버를 사용).
다른 프로젝트의 Postgres와 함께 띄우려면 `.env`의 `POSTGRES_PORT`와 `DATABASE_URL`의 포트를 같이 바꿉니다
(다른 Postgres가 이미 그 포트를 쓰고 있으면 `db:setup`이 비밀번호 오류로 바로 멈춥니다).

| 명령                      | 설명                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| `bun run dev`             | 개발 모드. 서버 자동 재시작 + 클라이언트 HMR                            |
| `bun test`                | 단위 + API 통합 테스트. 외부 환경 불필요 (in-memory DB), 한 번에 실행   |
| `bun run check`           | prettier + eslint + tsc + knip + test 전체 게이트 (pre-push와 동일)     |
| `bun run build`           | 프로덕션 빌드 → `dist/` (서버가 클라이언트를 포함하는 단일 산출물)      |
| `bun run start`           | 빌드 산출물 실행                                                        |
| `bun run db:*`            | `db:up` / `db:migrate` / `db:seed` / `db:setup`                         |
| `bun run chat:load`       | 채팅 부하 테스트: 한 방에 N명 입장 + 메시지 전송 (`[인원] [메시지 수]`) |
| `bun run compiler:report` | React Compiler가 컴파일하지 못한 컴포넌트·훅 목록 (`--all`: 전부)       |

## 아키텍처 결정

### 의존 방향 (ESLint로 강제)

- `client` → `server` 런타임 import **금지** (타입 전용 import는 허용).
- `shared` → `server`/`client` import 금지.
- `zod`는 `src/shared/validation` 안에서만 import 가능 — 나머지는 전부 파사드를 통합니다.

### 검증 파사드 (`@shared/validation`)

모든 소비자는 라이브러리 중립적인 `Validator<T>` 인터페이스(`parse`/`safeParse`)에만
의존합니다. 현재 구현은 zod/mini이며, yup 등으로 바꾸려면 어댑터 하나를 새로 쓰고
스키마 정의 파일만 갱신하면 됩니다. 라우트·폼·설정 로딩 코드는 전혀 바뀌지 않습니다.

### 시간 정책

서버 내부는 항상 UTC입니다(`process.env.TZ = 'UTC'`, DB는 `timestamptz`, 애플리케이션은
`UtcIsoString` 브랜드 타입). 타임존 변환은 오직 경계에서만 — 클라이언트가
`formatUtcInTimeZone`으로 표시할 때 수행합니다.

### 목록 API 규약 (`@shared/api/pagination`)

모든 목록 엔드포인트는 `?page&pageSize&sortBy&sortOrder` + 엔드포인트별 평면 필터
파라미터를 받고, `Page<T>` 엔벨로프(`items/page/pageSize/totalItems/totalPages/hasNextPage`)로
응답합니다. 정렬 필드는 엔드포인트별 화이트리스트로만 허용됩니다.

### 환경 설정

로컬/개발/운영 전환은 `.env`(또는 배포 환경 변수) 교체 한 번으로 끝나며 코드 수정이
필요 없습니다. 모든 설정은 부팅 시 `src/server/config.ts`에서 검증됩니다.
`.env*`는 gitignore되어 있고 `.env.example`만 커밋합니다.

### 데이터베이스

- 기본 Postgres(Bun 내장 SQL 클라이언트, 외부 패키지 없음). 리포지토리 인터페이스
  (`src/server/repositories/types.ts`) 뒤에 있어서 다른 DB로 교체하려면 구현 파일 하나만
  새로 쓰면 됩니다. 테스트·로컬용 in-memory 구현이 이미 동일 계약을 따릅니다.
- 마이그레이션: `migrations/NNNN_name.sql` 파일이 곧 스키마 이력입니다.
  `bun run db:migrate`가 순서대로 적용하고 `schema_migrations`에 기록하며, advisory lock으로
  다중 인스턴스 동시 기동에도 안전합니다. 시드는 `bun run db:seed`(멱등).
- 트랜잭션 경계는 서비스 계층의 `uow.run(async (tx) => { … })` 블록으로 명시됩니다
  (예: `TodoService.create` — todo insert + audit log가 원자적).
- N+1: 목록 조회는 `count(*) OVER ()` 윈도 함수로 데이터+총계를 한 번에 가져옵니다.
  연관 행이 생기면 행별 쿼리 대신 `WHERE id IN (…)` 배치 조회를 사용하세요
  (리포지토리 주석 참고).

### 수평 확장

- **pub/sub 버스** (`src/server/pubsub`): 인스턴스 간 통신 추상화. 기본 `memory`,
  다중 인스턴스에서는 `PUBSUB_DRIVER=redis`(+`REDIS_URL`)로 전환 — Bun 내장 Redis
  클라이언트를 사용하며 코드 변경이 없습니다.
- **워커 역할**: `SERVER_ROLE=web|worker|all`. 같은 바이너리를 HTTP 전용/백그라운드 잡
  전용으로 나눠 띄울 수 있습니다. 잡은 pub/sub `jobs` 채널로 흐릅니다(`src/server/worker.ts`).
- **싱글톤**: 컨테이너(`src/server/container.ts`)에서 resolve되는 모든 서비스는 프로세스당
  싱글톤(lazy + memoized)입니다. 새로 싱글톤이 필요하면 같은 방식으로 등록하면 됩니다.
- **WebSocket**: `/ws`로 todo 변경 이벤트를 push합니다. 브리지가 pub/sub을 경유하므로
  redis 드라이버에서는 다른 인스턴스에 붙은 소켓에도 팬아웃됩니다. 채팅은 별도 소켓
  `/ws/chat`을 씁니다(아래 [채팅](#채팅)).

### Graceful shutdown & 롤링 배포 버전 스큐

SIGTERM/SIGINT 수신 시: ① readiness가 즉시 503으로 바뀌어 LB가 트래픽을 뺌
(`SHUTDOWN_DRAIN_MS` 동안 대기) → ② 처리 중인 요청을 끝까지 마친 뒤 리스너 종료
→ ③ DB/Redis 등 자원 정리 후 종료.

롤링 배포 중 구버전 클라이언트 ↔ 신버전 서버(또는 그 반대) 조합 문제는 버전
핸드셰이크로 차단합니다: 빌드 시 git SHA가 서버·클라이언트 번들 양쪽에 주입되고
(`APP_BUILD_VERSION` define), 클라이언트는 모든 API 요청에 `X-App-Version` 헤더를
보냅니다. 불일치 시 서버가 409 `VERSION_MISMATCH`를 반환하고 클라이언트는 1회
새로고침하여 새 서버의 에셋을 받아옵니다. 서버 번들이 자신과 같은 빌드의 클라이언트를
내장하므로(단일 산출물) 항상 정합성이 보장됩니다. (`src/shared/api/version.ts`)

### 헬스체크

- `GET /api/health/live` — 프로세스 생존 (의존성 안 봄)
- `GET /api/health/ready` — DB 연결 여부 구분(`db: up|down`), 종료 중이면 503

### CORS

허용 origin은 `CORS_ORIGINS` 환경 변수(콤마 구분)로만 제어합니다. 와일드카드 없음,
암묵적 허용 없음 (`src/server/http/cors.ts`).

### 인증 (회원)

확정된 전제는 [CLAUDE.md](CLAUDE.md)에 있습니다: 비밀번호를 다루지 않고, 회원 가입·로그인·로그아웃은
회원 서버([hwahee/boilerplate-auth](https://github.com/hwahee/boilerplate-auth))가 맡으며, 브라우저에는
토큰을 두지 않습니다.

- **드라이버**: `AUTH_DRIVER=none|oidc` (미설정 시 `none`, `.env.example`은 `oidc`).
  - `none` — 로그인 없음. `/api/auth/*`가 마운트되지 않아 JSON 404이고, 헤더 컨트롤도 숨겨집니다.
  - `oidc` — 회원 서버에서 OpenID Connect로 로그인합니다. 이 서비스는 표준(OIDC)에만 의존하고
    (`src/server/auth/oidc.ts`), 회원 서버가 무엇으로 돌아가는지 모릅니다. `OIDC_*`·`PUBLIC_URL`은
    회원 서버에 등록한 이 서비스의 값과 같아야 합니다(`.env.example`).
- **로그인**: 헤더의 "로그인" → `GET /api/auth/login?returnTo=` → 회원 서버의 로그인 페이지 →
  `GET /api/auth/callback`에서 코드를 회원 정보로 바꾸고 → 시작한 페이지로 돌아옵니다. 다른 서비스에
  이미 로그인해 있으면 회원 서버 페이지는 입력 없이 지나갑니다. 끝내지 못한 로그인(거절·만료·재사용)은
  `/sign-in-failed`로 옵니다. 로그인 링크는 지금의 테마·디자인·언어(`theme`·`design`·`ui_locales`)를 함께
  넘기고, 서버가 이를 authorize 요청에 붙여 회원 서버의 로그인 페이지가 같은 모습으로 뜹니다
  (`src/shared/domain/appearance.ts`).
- **로그아웃**: 헤더의 "로그아웃" → `GET /api/auth/logout` → 회원 서버의 확인 페이지. 확인하면 회원
  서버가 모든 서비스의 `GET /api/auth/frontchannel-logout`을 불러 각자의 세션을 끝내고, 회원 서버의
  로그아웃 완료 페이지에서 끝납니다.
- **세션 쿠키**: `session-{OIDC_CLIENT_ID}`에 회원 아이디·닉네임(OIDC `sub`·`name`)과 회원 서버 세션
  id만 담고 `SESSION_SECRET`으로 서명합니다. 토큰은 담지 않습니다. httpOnly + `SameSite=Lax`이고,
  `PUBLIC_URL`이 https면 `Secure`입니다. 브라우저를 닫으면 사라집니다. 쿠키 이름에 서비스 id가 붙는
  것은 localhost에서 포트가 달라도 쿠키를 함께 쓰기 때문입니다. CORS에서
  `Access-Control-Allow-Credentials`를 켜지 않으므로 교차 출처 호출자에게는 쿠키가 가지 않습니다.
- **회원 정보**: 이 서비스는 회원 테이블을 두지 않습니다(`0004_drop_users`). 회원은 로그인할 때
  회원 서버가 알려 준 아이디와 닉네임으로만 압니다.
- **API**: `GET /api/auth/me` → `User({id, displayName}) | 401`. 로그인·로그아웃은 주소로 이동합니다
  (`authApi.signInUrl(returnTo, appearance)`, `authApi.signOutUrl` — `src/client/api/endpoints.ts`).
- **신원 전달**: 라우트는 `ctx.caller`(`src/server/http/context.ts`)만 읽습니다 — `member`(로그인,
  아이디·닉네임), `guest`(로그인 기능은 있지만 로그인 안 함), `anyone`(`none` — 구분 없음).
  클라이언트의 `useCaller()`가 같은 셋(+ 로딩 중 `unknown`)을 돌려줍니다.
- **게스트가 할 수 있는 일**: **접속을 끊은 뒤에도 의미가 남는 행동은 회원만**, 접속해 있는 동안에만
  의미가 있는 행동(예: 게임 한 판의 점수)은 게스트도 합니다. 조회는 게스트에게도 열려 있습니다.
  회원 전용 행동은 핸들러 첫 줄의 `requireMember(ctx.caller)`로 선언하며, 게스트면 로컬라이즈된
  401 `UNAUTHORIZED`가 됩니다. Todos는 저장되는 데이터이므로 생성·수정·삭제가 회원 전용이고,
  화면도 게스트에게는 쓰기 UI 대신 안내를 보여 줍니다. 게스트 상태는 서버가 아닌 탭 안에 두므로
  게스트 식별자는 없습니다. **예외는 채팅**입니다: 게스트도 메시지를 보내고, 탭이 만든 `guestId`로
  표시됩니다(서버는 이를 신원 증명으로 쓰지 않음).
- **아직 없는 것**: todos와 회원의 연결(소유자 — 지금은 회원 모두가 한 목록을 함께 씀), 감사 로그의
  행위자, 다른 서비스가 회원 정보를 묻는 API, 외부 로그인(회원 서버 쪽).

### 채팅

채팅은 어떤 기능에든 **붙이는** 시스템입니다. 방이 어느 기능에 붙어 있는지는 채팅이 모르고,
저장·번호 매기기·실시간 전달·접속자 목록·재연결은 모든 방에서 똑같이 동작합니다. 붙이는 쪽이
정하는 것은 방 id와 정책뿐이고, 화면은 붙이는 곳마다 다르게 그려도 됩니다.

- **붙이는 법**
  - 서버: 누가 들어오기 전에 방을 엽니다 — `container.chatService().openRoom({ id, policy })`.
    다시 열면 정책만 갱신되므로 부팅마다 불러도 됩니다. id는 `inquiry.42`처럼 기능 이름으로 구분합니다.
  - 클라이언트: `useChatRoomState(roomId, (room) => room.messages)`처럼 필요한 조각만 구독하고
    (`messages`, `participants`, `status`), 보내기와 "내 메시지" 판별은 `useChatRoomActions(roomId)`
    (`send(text)`, `isMine(message)`)로 합니다. 컴포넌트는 자기가 고른 조각이 바뀔 때만 다시 그려집니다.
  - 화면: 붙이는 쪽이 직접 그립니다. 예시는 홈 페이지의 채팅 상자(`src/client/pages/home-chat.tsx`,
    방은 `src/shared/domain/home-chat.ts`)입니다.
- **방 정책** (`ChatRoomPolicy`, 방마다 다름): `retentionMs`는 메시지를 얼마나 보존할지(`null` = 방이
  있는 동안 계속), `backlog`는 입장 직후 보여 줄 지난 채팅(최근 `maxCount`개, `maxAgeMs`보다 오래된 것은
  제외)입니다. 예: 문의는 오래 보존, 게임 방은 잠깐만. 보존 기한이 지난 메시지는 워커가 1분마다 지우고,
  지우기 전에도 조회에서는 빠집니다.
- **흐름**: 전송은 `POST /api/chat/rooms/:roomId/messages`(검증·에러 형식·i18n을 그대로 씀), 수신은
  탭당 소켓 하나(`/ws/chat`)로 여러 방을 `join`/`leave`합니다. 메시지에는 방 안에서 1씩 늘어나는
  번호(`seq`)가 붙습니다. 입장할 때는 소켓 가입(`joined`)이 끝난 뒤 지난 채팅을 불러와 둘을 번호로
  합치므로 빠지는 메시지가 없고, 다시 연결되면 `?after=<마지막 seq>`로 놓친 것만 받습니다. 이 조회는
  새 메시지가 계속 쌓이므로 page/pageSize 규약 대신 커서(`after`)를 씁니다.
- **회원과 게스트**: 채팅은 게스트도 회원과 똑같이 보냅니다(아래 인증 절의 예외). 게스트는 탭이 만든
  `guestId`(6자리, `sessionStorage`)로 표시되며 새로고침하면 유지되고 새 탭이나 재방문이면 새
  게스트입니다. 소켓은 연결할 때 신원을 읽으므로 로그인·로그아웃하면 클라이언트가 소켓을 새로 엽니다.
- **접속자 목록과 수평 확장**: 메시지(`chat.messages`)와 입퇴장(`chat.presence`)은 pub/sub으로 모든
  인스턴스에 퍼지고, 각 인스턴스가 자기 소켓에 전달합니다. 접속자 목록은 연결(탭) 단위로 다룹니다.
  들어온 소켓에는 그 순간의 목록을 한 번 보내고(`presence`), 이후에는 누가 들어오고 나갔는지만
  보냅니다(`presence-add` / `presence-remove`). 목록이 전송되는 동안 일어난 변화는 목록 뒤에 이어서
  보냅니다. 한 사람의 여러 탭은 클라이언트가 한 명으로 합칩니다. 목록은 `PUBSUB_DRIVER`를 따라
  memory 또는 Redis 해시(`presence:<방 id>`)에 둡니다. 죽은 인스턴스는 퇴장을 알릴 수 없으므로 항목은
  60초 뒤 만료되고, 살아 있는 인스턴스가 20초마다 자기 연결을 갱신하면서 만료된 연결의 퇴장을 알립니다
  (여러 인스턴스가 동시에 정리해도 한 번만). 정상 종료 때는 그 인스턴스의 소켓을 목록에서 바로 빼고
  닫아서 클라이언트가 다른 인스턴스로 다시 붙게 합니다.
- **부하에서의 동작**: 채팅 코어는 메시지가 몇 개가 오든 화면에 알리는 것을 애니메이션 프레임당 한 번으로
  묶고(숨은 탭에서는 멈춤), 바뀐 조각만 새 값으로 바꿉니다. 한 번 받은 메시지 객체는 그대로 유지되므로
  목록은 새 메시지 행만 그립니다(배포 빌드에서 React Compiler가 이미 그린 행을 건너뜁니다). `bun run chat:load [인원] [메시지 수]`는
  실제 앱과 WebSocket으로 한 방에 인원을 넣고 메시지를 보내 입장 완료 시간과 전송량을 잽니다.
- **아직 없는 것**: 비공개(참여자만 읽는) 방과 운영자 역할, 입력 중·읽음 표시, 메시지 수정·삭제,
  도배 제한, 지난 채팅 더 불러오기.

### i18n

`@shared/i18n` 파사드를 서버(에러 메시지 — `Accept-Language`/`?lang=` 협상)와
클라이언트(UI 문자열 — 로케일 컨텍스트)가 공유합니다. 로케일 추가는 카탈로그 파일
하나 + 등록 한 줄입니다. DB에는 로케일 독립적인 데이터만 저장합니다.

## 클라이언트

- **API 카탈로그**: 모든 엔드포인트는 `src/client/api/endpoints.ts` 한 곳에 상세 주석과
  함께 정의됩니다. 컴포넌트는 `fetch`를 직접 부르지 않고 이 카탈로그(또는 그 위의
  TanStack Query 훅 `queries.ts`)만 사용합니다.
- **TanStack Query**: 목록 조회는 로딩/에러(재시도 버튼)/데이터/빈 상태를 모두 처리하고,
  mutation은 성공 시 목록 캐시를 invalidate합니다. 상태 토글은 **optimistic update**
  (스냅샷 → 즉시 반영 → 실패 시 롤백 → settle 시 재동기화)로 구현되어 있습니다.
  실패한 조회는 1회 재시도하되, 4xx(400/401/404 등 — 다시 물어도 답이 같은 실패)는
  재시도하지 않습니다 (`isRetryableError`, `src/client/api/http.ts`).
- **최소 상태**: 페이지/필터/정렬은 URL 쿼리에서 파생, 서버 데이터는 쿼리 캐시에만 존재.
  로컬 `useState`는 "아직 제출 안 된 폼 입력"뿐입니다.
- **라우팅**: react-router (BrowserRouter). 서버의 SPA 캐치올이 딥링크를 지원합니다
  (`/api/*`는 제외 — 없는 API 경로는 JSON 404).
- **디자인 시스템**: 토큰 3계층(원시 → 디자인 치수 → 시맨틱 컬러)으로 구성되며
  `/design-system` 페이지에서 전부 확인할 수 있습니다. `<html>`의 `data-theme`
  (light/dark)와 `data-design`(A=심미성/B=시인성) 속성만으로 전환됩니다 — 푸터의 토글
  버튼으로 즉시 스위칭됩니다. 아이콘은 lucide-react. 색상 입력(`Palette`)은 Popover API
  top layer에 떠서 어떤 `overflow` 조상 안에서도 잘리지 않으며, 값은 알파를 포함한 정규화
  hex 문자열입니다 — 설계 근거는 **[docs/palette-design.md](docs/palette-design.md)** 참고.
- **공용 푸터**(`src/client/ui/footer.tsx`): 세 밴드 구조입니다 —
  ① **정체성 행**(서비스명 · 태그라인 + 테마/디자인/언어 컨트롤)을 자체 hairline으로 닫고,
  ② 그 아래 **링크 컬럼**(관련 서비스 / 연결)을 행의 좌우 끝으로 벌려 위쪽 컨트롤과 세로로
  맞추고, ③ 마지막에 **미니멀 1줄**(저작권 · 디자인 시스템 · 약관 링크)을 둡니다. 헤더에는
  내비게이션이 없어서 홈은 헤더의 서비스명이 링크하고, 이 서비스의 참고 페이지(디자인 시스템)는
  서비스가 아니라 사이트 정보라 "관련 서비스"가 아닌 하단 줄에 둡니다 — 사이드바가 생기면 그리로
  옮길 자리입니다. 본문과는 얇은
  `border-top` 하나로 구분되며, 푸터 안의 규칙선은 정체성 행을 닫는 것 하나뿐입니다 —
  선을 더 그으면 조용한 블록이 상자 더미가 됩니다. 좁은 화면에서는 좌우로 벌리는 대신
  컬럼이 세로로 쌓입니다(휴대폰 폭의 양 끝은 서로 무관해 보일 만큼 멉니다). 배치는 **sticky footer**(fixed 아님) — 앱 셸이 `min-height: 100dvh` 세로
  플렉스 컬럼이고 `<main>`이 `flex: 1 0 auto`로 남는 공간을 전부 먹습니다. 내용이 짧으면
  푸터가 화면 맨 아래에 붙고, 길면 스크롤해야 보이는 문서 맨 끝에 놓입니다 — 어느 쪽이든
  뷰포트에 고정되어 본문을 가리는 일은 없습니다. 톤은 본문보다 한 단계 낮게 — `--font-size-sm`(디자인 A 기준 13px),
  `--color-text-muted`, 링크는 hover에서 밑줄만 붙습니다. 하드코딩된 12~13px 대신 토큰을
  쓰기 때문에 시인성 디자인(B)·스킨에서도 각자의 스케일을 유지합니다.
  "Other Services" 컬럼은 `GET /sitemap.json`(→ `public/sitemap.json`)을 그대로 렌더링하므로
  **서비스 추가는 코드 수정이 아니라 데이터 편집**입니다. 파일은 요청마다 디스크에서 읽히니
  재빌드·재시작도 필요 없습니다(브라우저 캐시 5분). 목록이 로딩 중이거나 실패하면 컬럼을
  비운 채로만 렌더링합니다 — 스크롤 하단 크롬에 스피너나 에러 배너를 띄우지 않습니다.
  링크 URL은 절대 http(s)이거나 루트 상대 경로만 허용되며(`@shared/domain/sitemap`),
  검증에 실패한 파일은 500으로 거절됩니다 — 깨진 링크를 배포하느니 눈에 띄게 실패합니다.
  크롤러용 `sitemap.xml`과는 무관한 별개의 문서입니다.
- **푸터 on/off는 라우트 단위**: 크롬은 react-router의 layout route로 표현됩니다
  (`app.tsx`의 `AppLayout` / `AppRoutes`). 기본값은 `footer = true`라 새 라우트는 가만히
  두면 푸터를 갖고, 뷰포트 전체를 쓰는 페이지(전체화면 에디터·임베드 위젯 등)만
  `<Route element={<AppLayout footer={false} />}>` 그룹에 넣어 예외를 **선언**합니다.
  라우트는 소스 순서가 아니라 구체성으로 랭킹되므로 `*` 폴백이 다른 그룹의 구체적 경로를
  가리지 않습니다.
- **UI 자동화 / 접근성**: 모든 인터랙티브 컴포넌트는 `testId`가 **필수 prop**이며 값은
  `src/client/testing/testids.ts` 레지스트리에서만 나옵니다. WAI-ARIA(라벨, live region,
  `aria-busy`, `aria-current`, skip link, 네이티브 컨트롤 우선)를 준수합니다.
  전체 규약은 **[docs/ui-automation.md](docs/ui-automation.md)** 한 문서에서 확인하세요.

## CI / DX

- **GitHub Actions** (`.github/workflows/ci.yml`): 모든 push마다
  prettier → eslint → tsc → knip → test → build.
- **husky + lint-staged**: pre-commit에 staged 파일 lint/format, pre-push에
  `bun run check` 전체 게이트.
- **React Compiler**: 배포 빌드는 Bun 내장 React Compiler(실험 기능)로 `.tsx` 컴포넌트를 컴파일해,
  입력이 그대로인 JSX·계산값을 재사용하는 코드를 빌드 시점에 넣습니다. 그래서 속도만을 위한
  `memo`/`useMemo`/`useCallback`은 직접 쓰지 않습니다. 개발 서버와 `.ts` 파일(훅 등)은 컴파일되지
  않으므로 동일성에 기대는 memo(이펙트 의존성, context로 내려가는 함수, `.ts` 훅의 반환값)는 계속 씁니다.
  컴파일러가 빌드에서 빠지면 `bun run build`가 실패합니다. 컴파일러는 지원하지 않는 문법이나 React 규칙
  위반이 있는 컴포넌트를 경고 없이 건너뛰므로, `bun run compiler:report`로 컴파일되지 않은 컴포넌트·훅을
  확인합니다. 원칙은 [CLAUDE.md](CLAUDE.md)에 있습니다.
- **빌드**: Bun 번들러 단독 사용. `bun run build` 한 번으로 서버+클라이언트+마이그레이터가
  `dist/`에 떨어집니다. 개발 모드는 Bun의 HTML import 기반 HMR.
- **Docker**:
  - DB만: `bun run db:up` (redis 포함: `docker compose --profile redis up -d`)
  - 컨테이너 안에서 빌드까지: `docker compose --profile app up --build`
    (멀티스테이지 Dockerfile — 런타임 이미지에는 빌드 산출물만 포함)

## GraphQL을 도입한다면 (가이드)

이 보일러플레이트는 REST 기반이지만, GraphQL을 붙일 경우 **persisted query** 방식을
따르세요: 앱 안에 정의된 각 쿼리의 핑거프린트(해시)를 빌드 시 저장해 두고, 일반
사용자 토큰은 등록된 해시의 쿼리만 실행할 수 있게 하며, 임의 쿼리는 관리자 토큰에만
허용합니다. 버전 핸드셰이크(`X-App-Version`)와 동일하게 빌드 시점 주입 패턴을 재사용할
수 있습니다.

## 테스트 전략

- **단위**: 비즈니스 로직(`TodoService`, `ChatService` — 방별 번호, 지난 채팅의 개수·나이·
  보존 기한, 보존 기한 정리) — 트랜잭션 롤백, 이벤트 발행,
  성공/실패 케이스. 설정 가드(`AUTH_DRIVER=oidc`의 필수 값), 서명된 세션 쿠키 해석, OIDC 클라이언트
  (가짜 발급자 `src/server/auth/fake-issuer.ts` 상대로: 코드 교환, 클레임 확인, 재사용 거절)도 단위로 검증합니다.
  라우트가 아직 던지지 않는 도메인 에러의 HTTP 매핑(401)은 `respond.test.ts`에서 검증합니다.
- **통합**: 실제 앱을 임시 포트에 띄워 HTTP로 검증 — CRUD, 페이지네이션/정렬/필터,
  검증 실패(400)와 로컬라이즈된 메시지, 404(없는 API 경로·메서드 포함), 버전 스큐(409),
  CORS 허용/거부, 헬스체크, 로그인(가짜 발급자를 거쳐 콜백 → `me` 200, 끝내지 못한 로그인은
  `/sign-in-failed`), 로그아웃(front-channel이 지목한 세션만 종료), 게스트의 todos 쓰기 401
  (`none`에서는 허용).
- **채팅**: HTTP(전송·지난 채팅·`after`)와 실제 WebSocket(가입, 실시간 수신, 접속자 목록과 중복 제거,
  퇴장, 없는 방)을 통합으로, 게이트웨이의 접속자 순서(목록과 경합한 변화)와 만료 정리를 대역 소켓으로,
  클라이언트 코어(소켓 공유·재연결, 번호 합치기와 빈틈 처리, 프레임당 한 번 알림, 객체 유지)를 가짜
  소켓으로 검증합니다. presence 계약 테스트는 `REDIS_URL`이 있으면 Redis 드라이버(실제 만료 포함)에도 돕니다.
- 전부 in-memory 드라이버로 돌므로 **`bun test` 하나로, 외부 환경 없이** 실행됩니다.
