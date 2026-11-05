# 업스트림 업데이트 적용: 회원 서버로 로그인 (OIDC) (2026-10)

이 보일러플레이트에서 출발한 저장소(이하 **다운스트림**)에서 일하는 AI 에이전트를 위한 적용 절차입니다.
이 업데이트를 받은 뒤 이 문서를 위에서부터 끝까지 따르세요.

| PR                                                   | 내용                                                                                  | main 머지 순서 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------- |
| [#23](https://github.com/hwahee/boilerplate/pull/23) | 회원 서버에서 OIDC로 로그인, `AUTH_DRIVER=dev`·`users` 테이블·헤더 아이디 입력칸 제거 | 1              |

회원 가입·로그인·로그아웃은 이제 회원 서버([hwahee/boilerplate-auth](https://github.com/hwahee/boilerplate-auth))가
맡습니다. 서비스는 OIDC 표준으로만 회원 서버에 붙고, 회원 테이블을 두지 않으며, 회원을 로그인 때 받은
아이디(`sub`)와 닉네임(`name`)으로만 압니다.

## 0. 작업 원칙

- 다운스트림의 `CLAUDE.md`가 업스트림과 다르면 **다운스트림 것이 우선**입니다. 업스트림의 새 규칙은 다운스트림
  전제와 부딪히지 않는 범위에서 더합니다.
- **3절의 결정 항목은 에이전트가 정하지 않습니다.** 사람에게 묻고, 답을 받기 전에는 기본값(각 항목에 적음)으로 둡니다.
- **이 저장소가 회원 서버(`hwahee/boilerplate-auth`)라면 1~5절 대신 6절만 따릅니다.**
- 각 단계 끝의 검증 명령이 통과해야 다음 단계로 갑니다.

## 1. 이미 적용됐는지 확인

| 확인                                                     | 적용됨의 의미                               |
| -------------------------------------------------------- | ------------------------------------------- |
| `grep -n "'oidc'" src/server/config.ts`                  | 드라이버가 바뀜                             |
| `ls migrations/*_drop_users.sql src/server/auth/oidc.ts` | 회원 테이블 삭제와 OIDC 클라이언트가 들어옴 |
| `bun run db:migrate` 출력에 `drop_users`가 없음          | DB에도 적용됨(이미 적용됐으면 안 나옴)      |

## 2. 충돌 해결 원칙

- 업스트림이 **지운 것**(`POST /api/auth/dev-login`, `AuthService`, `UserRepository`, `users` 테이블, 헤더의 아이디
  입력칸, `devLoginValidator`, `User.createdAt`)을 다운스트림이 고쳤다면 **지우는 쪽**을 택하고, 다운스트림이
  거기에 붙인 기능은 4절 2~3번으로 옮깁니다.
- 회원의 이름은 DB가 아니라 세션에 있습니다: `ctx.caller`의 `member`에 `displayName`이 생겼습니다.
- 들어오는 `000N_drop_users.sql`의 번호를 다운스트림이 이미 썼다면 다음 빈 번호로 바꿉니다(`bun run db:migrate`가
  알려 줍니다). 그 앞에 4절 3번의 마이그레이션이 와야 합니다.

## 3. 사람에게 확인할 결정

| 결정                                                                                                    | 기본값(답을 받기 전)                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 이 서비스의 id. 서브도메인(`https://{id}.hwahee.com`)이자 `OIDC_CLIENT_ID`이며, `auth`는 쓸 수 없습니다 | 없음 — 정해질 때까지 `AUTH_DRIVER=none`          |
| `users`에 다운스트림만의 데이터(다른 테이블이 외래 키로 가리키는 행 등)가 있을 때 지워도 되는지         | 지우지 않음 — 4절 3번에서 멈춤                   |
| 회원 서버의 어느 환경(local/dev/staging/운영)에 이 서비스를 등록하는지, 그 비밀값을 누가 관리하는지     | local만 — 회원 서버 `services/local.json`에 등록 |

## 4. 조치

1. **환경 변수**: `.env`의 `AUTH_DRIVER=dev`는 이제 부팅을 거부합니다. `.env.example`의 로그인 절
   (`AUTH_DRIVER=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `PUBLIC_URL`, `SESSION_SECRET`)을
   옮기고, `OIDC_CLIENT_ID`·`OIDC_CLIENT_SECRET`·`PUBLIC_URL`은 3절의 서비스 id로 회원 서버에 등록한 값과 맞춥니다.
   `SESSION_SECRET`은 32자 이상이고 환경마다 다릅니다.
2. **회원 정보를 읽던 코드**: `grep -rnE "users|UserRepository|authService|devLogin|dev-login|createdAt" src`로 찾아
   회원의 아이디·닉네임은 `ctx.caller`(서버)·`useMe()`(클라이언트)에서 읽게 바꿉니다. 회원 서버에만 있는
   정보(자기소개 등)가 필요하면 멈추고 사람에게 알립니다 — 서비스가 회원 정보를 묻는 API는 아직 없습니다.
3. **`users`를 가리키는 외래 키**: `grep -n "REFERENCES users" migrations/*.sql`. 있으면 3절 결정을 받은 뒤,
   `drop_users`보다 앞 번호의 마이그레이션에서 그 제약만 지웁니다(`ALTER TABLE … DROP CONSTRAINT …`). 열은
   남겨 두면 회원 서버의 회원 아이디를 그대로 담습니다.
4. **회원 서버에 등록**: 회원 서버 저장소의 `services/local.json`에 `{ id, name, secret, origin }`을 더하고 거기서
   `bun run services:register`. `origin`은 이 서비스의 `PUBLIC_URL`입니다.
5. **UI 자동화**: `app.account.form`, `app.account.user-id`가 사라졌고 `sign-in-failed.*`가 생겼습니다
   (`docs/ui-automation.md`). 아이디 입력칸으로 로그인하던 자동화는 회원 서버 페이지를 거치게 고칩니다.
6. **검증**: `bun run check` 통과, `bun run db:migrate`로 `drop_users` 적용. 회원 서버를 띄우고 헤더의
   "로그인" → 회원 서버에서 로그인 → 시작한 페이지로 돌아와 이름 표시 → "로그아웃" → 회원 서버의 확인 → 로그아웃 완료.

## 5. 완료 조건

- `bun run check` 통과, `AUTH_DRIVER=dev`와 `devLogin`·`UserRepository`가 코드에 없음.
- 로컬에서 4절 6번의 로그인·로그아웃이 동작함.
- 3절의 결정이 모두 사람에게서 왔거나 기본값으로 남아 있고, 그 사실을 보고함.

## 6. 회원 서버(`hwahee/boilerplate-auth`)에서는

회원 서버는 로그인을 **주는** 쪽이라 이 변경의 서비스 쪽 로그인을 받지 않습니다. 자기 로그인(아이디로 가입·로그인,
`users`·`memberships`, Hydra 요청에 답하기)을 그대로 둡니다.

- 리베이스 충돌은 **회원 서버 쪽을 택합니다**: `src/server/config.ts`(`AUTH_DRIVER`), `src/server/auth/session.ts`,
  `src/server/routes/auth.ts`, `src/server/services/auth-service.ts`, `src/server/repositories/*`(`UserRepository`),
  `src/shared/domain/user.ts`, `src/server/services/chat-service.ts`(회원 이름 조회), 클라이언트의 인증 화면·API·문구·testid.
- 들어오는 것 중 회원 서버가 쓰지 않는 파일은 지웁니다: `migrations/*_drop_users.sql`(회원 서버는 `users`를
  유지합니다), `src/server/auth/oidc.ts`·`oidc.test.ts`·`fake-issuer.ts`, `src/client/pages/sign-in-failed-page.tsx`와
  그 라우트·testid·문구.
- `CLAUDE.md`는 회원 서버의 것을 유지하고, 업스트림의 새 줄 중 서비스에만 해당하는 것(회원 테이블을 두지 않음,
  `AUTH_DRIVER=oidc`)은 넣지 않습니다.
- 검증: `bun run check` 통과, 회원 서버 README의 Hydra 흐름(서비스 로그인·SSO·전체 로그아웃)이 그대로 동작.

## 7. 되돌리기

- 코드: 이 업데이트의 머지(또는 리베이스로 들어온 커밋)를 되돌립니다.
- DB: `drop_users`는 데이터를 지웁니다. 되돌릴 때는 `0002_users.sql`과 같은 스키마로 `users`를 다시 만드는 새
  마이그레이션을 더합니다(지워진 행은 돌아오지 않습니다).
