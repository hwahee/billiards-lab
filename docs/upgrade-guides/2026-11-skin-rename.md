# 업스트림 업데이트 적용: 스킨 이름 변경 (A/B → standard/contrast) (2026-11)

이 보일러플레이트에서 출발한 저장소(이하 **다운스트림**)에서 일하는 AI 에이전트를 위한 적용 절차입니다.
이 업데이트를 받은 뒤 이 문서를 위에서부터 끝까지 따르세요.

| PR                                                   | 내용                                                                           | main 머지 순서 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | -------------- |
| [#28](https://github.com/hwahee/boilerplate/pull/28) | 스킨 `a`/`b`를 `standard`/`contrast`로 이름 변경, contrast를 standard 모양으로 | 1              |

바뀌는 것:

| 예전                                       | 지금                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `data-design="a"` (디자인 A, 심미성)       | `data-design="standard"` (기본 스킨, 기본값)        |
| `data-design="b"` (디자인 B, 시인성)       | `data-design="contrast"` (고대비 스킨)              |
| `Design` 타입의 `'a'` / `'b'`              | `'standard'` / `'contrast'`                         |
| i18n `common.design.a` / `common.design.b` | `common.design.standard` / `common.design.contrast` |
| 토글 배지 `A` / `B`                        | `Standard` / `Contrast`                             |

contrast는 이제 standard와 **모양이 같습니다**. 글자 크기, 컨트롤 높이, 모서리, 그림자가 같고 다른 것은
**색(예전 B의 색 그대로)**, 테두리 2px, 포커스 링 4px, 진한 스크림뿐입니다. 예전 B의 큰 글자(본문 1.125rem)와
3rem 컨트롤은 없어졌습니다.

예전 이름은 계속 읽힙니다. `designFrom()`(`src/shared/domain/appearance.ts`)이 query parameter와 `localStorage`의
`a`/`b`를 새 이름으로 바꿔 읽고, 다음 저장 때 새 이름으로 씁니다. 그래서 이 업데이트를 받지 않은 서비스가 보내는
링크도, 브라우저에 저장된 선택도 깨지지 않습니다. **이 호환 처리는 지우지 않습니다.**

## 0. 작업 원칙

- 다운스트림의 `CLAUDE.md`가 업스트림과 다르면 **다운스트림 것이 우선**입니다.
- **3절의 결정 항목은 에이전트가 정하지 않습니다.** 사람에게 묻고, 답을 받기 전에는 기본값(각 항목에 적음)으로 둡니다.
- **이 저장소가 회원 서버(`hwahee/boilerplate-auth`)라면 4절에 더해 6절도 따릅니다.**
- 각 단계 끝의 검증 명령이 통과해야 다음 단계로 갑니다.

## 1. 이미 적용됐는지 확인

| 확인                                                        | 적용됨의 의미                  |
| ----------------------------------------------------------- | ------------------------------ |
| `grep -n "'contrast'" src/shared/domain/appearance.ts`      | 새 이름이 들어옴               |
| `grep -n "RENAMED_DESIGNS" src/shared/domain/appearance.ts` | 예전 이름 호환이 있음          |
| 4절 1번의 grep이 `index.html`의 호환 두 줄만 찾음           | 다운스트림 코드도 새 이름을 씀 |

## 2. 충돌 해결 원칙

- `src/client/styles/tokens.css`: 업스트림은 A/B 치수 블록을 `[data-design='standard'], [data-design='contrast']`
  공유 블록 하나와 contrast 전용 블록(테두리·포커스 링·스크림)으로 바꿨습니다. **구조는 업스트림 쪽을 택하고**,
  다운스트림이 A에서 바꾼 값은 공유 블록이나 standard 색 블록으로, B에서 바꾼 **색**은 contrast 색 블록으로
  옮깁니다. B에서 바꾼 **치수**(글자 크기, 컨트롤 높이 등)는 3절의 첫 결정을 따릅니다.
- `theme-context.tsx`, `index.html`, `app-controls.tsx`, i18n 메시지: 이름은 업스트림 쪽을 택하고, 다운스트림이
  더한 스킨이나 문구는 새 이름 옆에 그대로 둡니다.
- 다운스트림이 기본 스킨을 바꿨다면(예: `'standard'` 대신 `'kids'`가 기본값) 그 기본값을 유지합니다. 이 경우
  `theme-context.tsx`의 `?? 'standard'`와 `index.html`의 마지막 `'standard'`도 다운스트림의 기본값으로 둡니다.

## 3. 사람에게 확인할 결정

| 결정                                                                                                              | 기본값(답을 받기 전)                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 다운스트림이 B 스킨의 **치수**(큰 글자, 큰 컨트롤 등)를 고쳤거나 그 크기를 제품에서 약속했다면, contrast에 남길지 | 업스트림을 따름: contrast는 standard와 같은 치수. 다운스트림의 치수 변경은 버리고 보고 |
| 다운스트림의 화면 문구가 "디자인 A/B"를 사용자에게 보여 주고 있었다면(도움말, 공지 등), 새 이름으로 바꿀지        | 코드·주석은 바꾸고, 사용자에게 보이는 별도 문서는 그대로 두고 보고                     |

## 4. 조치

1. **예전 이름을 쓰는 다운스트림 코드 찾기**:

   ```sh
   grep -rnE "data-design=.?(a|b)\b|design === '(a|b)'|design=(a|b)\b|common\.design\.(a|b)\b|[Dd]esign[- ][AB]\b|디자인 [AB]\b" \
     src docs e2e tests README.md 2>/dev/null | grep -v upgrade-guides
   ```

   `src/client/index.html`의 `if (design === 'a') design = 'standard';`와 `'b'` 줄은 예전 이름 호환이라 남깁니다.
   그 밖에 찾은 것을 위 표대로 바꿉니다. `Record<Design, …>`처럼 타입으로 묶인 곳은 `bun run typecheck`가 찾아 줍니다.
   다운스트림이 더한 로케일(예: `ja.ts`)에는 `common.design.standard`, `common.design.contrast`를 더합니다.

2. **다운스트림이 직접 고른 스킨 값**: 링크·리다이렉트·테스트에 `design=a`/`design=b`를 직접 쓰고 있었다면 새 이름으로
   바꿉니다(예전 이름도 읽히지만 새로 쓰는 곳은 새 이름).
3. **UI 자동화**: `data-design` 값이 바뀌었습니다(`docs/ui-automation.md`). `toHaveAttribute('data-design', 'b')` 같은
   단언, `localStorage.setItem('app.design', 'a')` 같은 셋업은 새 이름으로 바꿉니다. testid는 바뀌지 않았습니다.
4. **회원 서버와의 배포 순서**: 서비스는 로그인할 때 `design=`을 회원 서버로 넘깁니다. 회원 서버가 새 이름을 아는
   버전(6절 적용)이 먼저 배포돼 있어야 고대비 스킨 사용자가 로그인 화면에서도 고대비로 봅니다. 회원 서버가 아직
   예전 버전이어도 로그인은 되고, 로그인 화면만 기본 스킨으로 보입니다.
5. **검증**: `bun run check` 통과. 앱을 띄우고 푸터의 스킨 토글이 Standard → Contrast → Office → Kids →
   Standard로 돕니다. 개발자 도구에서 `localStorage.setItem('app.design', 'b')` 후 새로고침하면
   `<html data-design="contrast">`가 되고 저장값도 `contrast`로 바뀝니다.

## 5. 완료 조건

- `bun run check` 통과, 4절 1번의 grep이 `index.html`의 호환 두 줄 말고는 아무것도 찾지 않음.
- `RENAMED_DESIGNS`(예전 이름 호환)가 남아 있음.
- 3절의 결정이 모두 사람에게서 왔거나 기본값으로 남아 있고, 그 사실을 보고함.

## 6. 회원 서버(`hwahee/boilerplate-auth`)에서는

회원 서버는 서비스들이 보내는 `design=`을 받아 화면에 적용하는 쪽입니다. 서비스마다 이 업데이트를 받는 시점이
다르므로 **예전 이름(`a`/`b`)과 새 이름을 모두 받아야** 합니다.

- 리베이스할 때 `src/shared/domain/appearance.ts`는 회원 서버 쪽 설명(테마·스킨은 서비스가 정함)을 유지하되,
  `DESIGNS`·`RENAMED_DESIGNS`·`designFrom()`은 업스트림 것을 받고 `appearanceFromParams()`가 `designFrom()`으로
  `design`을 읽게 합니다.
- `src/client/theme/theme-context.tsx`의 `setDesign`과 `use-apply-appearance.ts`는 `Design` 타입을 따르므로 이름
  변경만 받으면 됩니다.
- 4절 1번의 grep이 찾는 회원 서버의 테스트·주석(예: `design=a|b|office|kids`)을 새 이름으로 바꾸고,
  예전 이름이 새 이름으로 적용되는 테스트를 하나 둡니다(예: `?design=b` → `contrast`).
- 검증: `bun run check` 통과. 회원 서버 로그인 페이지를 `?design=contrast`와 `?design=b`로 열면 둘 다 고대비로,
  `?design=a`는 기본 스킨으로 보입니다.

## 7. 되돌리기

- 코드: 이 업데이트의 머지(또는 리베이스로 들어온 커밋)를 되돌립니다.
- 브라우저 저장값: 이 업데이트를 거친 브라우저는 `app.design`을 `standard`/`contrast`로 저장합니다. 되돌린
  코드는 이 값을 모르므로 그 사용자는 기본 스킨(A)으로 돌아갑니다. 지키려면 되돌린 코드에 반대 방향 변환
  (`standard` → `a`, `contrast` → `b`)을 더합니다.
