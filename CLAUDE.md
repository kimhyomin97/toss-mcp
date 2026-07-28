# toss-mcp — 토스증권 Open API MCP 서버

> 2026-07-27 Claude Code 세션에서 재설계한 문서. 이전 claude.ai 설계안을 참고했으나
> 그대로 따르지 않고, "학습하며 만들기"를 우선순위로 두고 경로를 다시 정했다.
> 이 문서가 현재 유일한 source of truth다.

## 1. 목적

- 토스증권 Open API를 감싸는 **로컬 stdio MCP 서버**를 만든다.
- 최종 사용 형태: Claude Code에 등록 후 자연어로 질의
  - 예: "삼성전자 지금 얼마야", "내 잔고 보여줘", "오늘 수익률은"
- 개인용. 배포(npm publish) 계획 없음.
- **부가 목적이자 진행 원칙: MCP tool의 동작 원리를 직접 구현하며 학습한다.**
  추상화·자동화는 "패턴이 지겨워질 만큼 이해한 뒤"에만 도입한다.

## 2. 확정된 설계 결정 (이번 세션)

| 항목 | 결정 | 근거 |
|---|---|---|
| 언어 | **TypeScript** (Node.js 18+) | MCP 공식 SDK 성숙도·레퍼런스 최다 |
| SDK | `@modelcontextprotocol/sdk` + `zod` | 공식 SDK, zod로 입력 스키마 선언 |
| Transport | **stdio** (`StdioServerTransport`) | 개인 로컬 사용, Claude Code가 프로세스 spawn/종료 관리 |
| tool 굵기 | **API와 1:1 매핑 (얇은 랩핑)** | 조합 지능은 LLM의 agentic loop에 위임. 서버는 HTTP 전달자로 단순하게 |
| tool 등록 방식 | **수작업 2~3개로 패턴 학습 → openapi.json 자동 등록으로 전환** | 학습 순서: tool을 손으로 만들어야 이름·설명·스키마·핸들러의 역할이 보인다. 단, 명세 실측 결과 GET이 24개뿐이라 전수 수작업은 노동 — 패턴 체득 후 자동화 |
| 기능 범위 | **읽기 전용(GET) 23개 전부 매핑.** 주문·조건주문 6개(POST/DELETE)는 제외, 추후 `TOSS_ENABLE_TRADING=true` 같은 opt-in 플래그 뒤에서만 확장 | 23개는 LLM 컨텍스트에 부담 없는 규모. 주문은 tool 미등록 = LLM이 실수로도 주문 불가 — 코드 레벨 안전장치 |
| 인증 | tool이 아닌 인프라. TokenManager 내부 모듈로 처리 | 토큰 발급/갱신을 LLM에 노출할 이유 없음 |
| 자격증명 | 프로젝트 루트 `.env` 파일 (`src/env.ts` 로더, `.gitignore` 등록) 또는 환경 변수 `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET` — 환경 변수가 우선 | 코드·커밋 대상 파일 하드코딩 금지. `.env.example`이 템플릿 |
| 실행 | `npx tsx src/index.ts` (개발) | 빌드는 필요해지면 |

### 1:1 매핑의 두 축 (재설계에서 분리한 개념)

- **축 1 — 굵기**: 1:1(API=tool) vs 유스케이스(여러 API 조합). → **1:1 채택.**
  LLM은 tool 결과를 보고 다음 호출을 결정하는 루프를 돌므로, 조합은 LLM 몫.
- **축 2 — 등록**: 수작업 vs 명세 기반 자동 생성. → **수작업 시작.**
  자동화는 이해가 끝난 뒤의 최적화이지 학습 도구가 아니다.
- 이전 설계는 두 축을 묶어 "자동 등록"으로 직행했다. 이번 설계는 축 2만 뒤로 미룬다.

## 3. 디렉토리 구조 (초기 — 수작업 단계 기준)

```
toss-mcp/
├─ CLAUDE.md             ← 이 문서
├─ package.json
├─ tsconfig.json         ← target es2022, module nodenext
├─ openapi.json          ← 토스증권 공식 명세 (v1.2.5) — tool의 원천 데이터
├─ src/
│  ├─ index.ts           ← 서버 조립 + registrar 호출 + StdioServerTransport 연결
│  ├─ registrar.ts       ← openapi.json 파싱 → GET만 필터 → tool 자동 등록
│  ├─ schema.ts          ← 명세 파라미터 → zod 스키마 변환 (buildZodShape)
│  ├─ handler.ts         ← generic handler 팩토리 (전 tool 공유)
│  ├─ tools/             ← 3~4단계 수작업 tool 4개. 현재 미등록 — 학습 기록으로 보존
│  └─ toss/
│     ├─ client.ts       ← TossClient: HTTP 요청, Bearer 부착, 401 시 1회 재발급 후 재시도
│     └─ auth.ts         ← TokenManager: 토큰 발급·캐싱·선제 갱신
└─ scripts/
   └─ smoke.ts           ← 서버 없이 토큰 발급 + API 1개 수동 호출 검증용
```

## 4. 컴포넌트 요구사항

### TokenManager (`src/toss/auth.ts`) — 작성 완료
- 토큰 캐싱: 프로세스 메모리에만 보관, 만료 60초 전 선제 갱신
- 동시 호출 시 중복 발급 방지 (in-flight refresh Promise 공유)
- 토큰 스펙 (openapi.json에서 확정):
  - `POST /oauth2/token`, form-urlencoded, `grant_type=client_credentials`
  - `expires_in` 86400초(24h), refresh token 없음
  - ⚠ **client당 유효 토큰 1개** — 재발급 시 이전 토큰 즉시 무효화.
    MCP 서버와 smoke 스크립트를 동시에 돌리면 서로 토큰을 죽일 수 있음 (401 재시도 로직이 흡수)
  - ⚠ **허용 IP 등록 필요** — WTS 설정 > Open API > 허용 IP 관리. 미등록 IP는 403.
    승인받으면 자격증명 발급과 함께 IP 등록도 해야 함

### TossClient (`src/toss/client.ts`)
- Base URL: `https://openapi.tossinvest.com`
- 모든 요청에 `Authorization: Bearer <token>` 자동 부착
- **계좌·자산·주문 API는 `X-Tossinvest-Account` 헤더 추가 필요** (시세·종목·시장 API는 토큰만).
  헤더 값은 계좌번호가 아니라 `GET /api/v1/accounts` 응답의 **`accountSeq`(정수)**.
  → 확정: 환경 변수 주입 대신 `get_accounts` tool을 등록하고, 계좌 계열 tool은
  `accountSeq`를 입력으로 받는다. LLM이 get_accounts → get_holdings 로 연쇄 호출 (얇은 랩핑 원칙)
- 401 응답 시 토큰 1회 강제 재발급 후 재시도, 재실패 시 에러 반환

### 각 tool (`src/tools/*.ts`)
- zod로 입력 스키마 선언, 파라미터마다 `.describe()`로 한국어 설명 부착
- 핸들러는 TossClient 호출 → **raw JSON을 가공 없이 반환** (해석은 LLM 몫)
  - 성공: `{ content: [{ type: "text", text: JSON.stringify(raw) }] }`
  - 실패: `{ isError: true, content: [{ type: "text", text: 에러메시지 }] }`
- description은 API 문서의 summary/description을 기반으로 작성 (LLM의 tool 선택 정확도 = description 품질)

## 5. 코딩 규칙 (stdio 서버 특수사항 — 이전 설계에서 유지)

- **stdout에 절대 아무것도 출력하지 않는다.** stdout은 JSON-RPC 전용 채널.
  `console.log` 한 줄로 프로토콜이 깨진다. 로그·디버그는 `console.error`(stderr)로만.
- 프로세스 라이프사이클(spawn/종료)은 Claude Code가 관리. 시그널/EOF 처리는 SDK에 맡기고
  커스텀 종료 로직을 넣지 않는다.
- 상태(토큰 캐시)는 프로세스 메모리에만. 파일/DB 영속화 불필요.
- 로컬 Node가 v18.16.0(EOL)이라 TypeScript는 5.x로 고정 (7.x는 Node 18에서 실행 불가).
  Node를 20+/22 LTS로 올리면 이 제약은 사라짐 — 여유 있을 때 업그레이드 권장.

## 6. 로드맵과 현재 상태

| 단계 | 내용 | 상태 |
|---|---|---|
| 0a | 토스증권 WTS 설정 > Open API에서 사전신청 → 승인 → client_id/secret 발급 + 허용 IP 등록 | ✅ 2026-07-28 발급, `.env` 등록 |
| 0b | API 명세 확보 — 공식 openapi.json이 인증 없이 공개됨: `https://openapi.tossinvest.com/openapi-docs/latest/openapi.json` | ✅ 다운로드 완료 (v1.2.5, 프로젝트 루트 `openapi.json`) |
| 1 | 스캐폴딩: package.json, SDK·zod·tsx 설치, tsconfig, 최소 index.ts (initialize 응답 확인) | ✅ |
| 2 | TokenManager + `scripts/smoke.ts`로 토큰 발급→API 1개 수동 호출 검증 | ✅ 2026-07-28 통과 (삼성전자·AAPL 실시세 수신) |
| 3 | 첫 tool `get_quote` 수작업 등록 → tools/list·tools/call 프로토콜 검증 (TossClient 포함) | ✅ (수작업 tool은 5단계에서 자동 등록으로 대체, src/tools/에 기록 보존) |
| 4 | 패턴 변형 tool 수작업: `get_accounts`(무입력), `get_holdings`(헤더형), `get_stock_warnings`(path형) | ✅ (동일 — 자동 등록으로 대체) |
| 5 | openapi.json 자동 등록으로 전환: **"GET만 등록" 필터로 23개 전부 매핑** (registrar + schema + generic handler) | ✅ 실데이터 검증 완료 (get_prices 실호출 성공) |
| 6 | Claude Code 등록 + 자연어 실사용 테스트 | ✅ 헤드리스 E2E 통과: "삼성전자 지금 얼마야" → get_prices → **218,000원 실데이터 답변** (2026-07-28). 잔고·환율 등 추가 시나리오는 실사용하며 관찰 |
| 8 | 수익률 추이: `scripts/collect.ts` 일일 스냅샷 수집기(holdings.dailyProfitLoss→CSV) + 작업 스케줄러 등록. 과거는 orders+candles+exchange-rate로 근사 재구성 (get_orders from/to는 전체 기간 지원 — 실제 범위는 실데이터로 확인) | ❌ 키 발급 후 |
| 9 | (추후) 주문·조건주문 6개를 opt-in 플래그 뒤에서 확장 | ❌ |

### 키 발급 시 체크리스트 (승인 알림 오면 이 순서대로)

1. WTS > 설정 > Open API: client_id/secret 발급 + **허용 IP 등록** (유동 IP면 변경 시 재등록)
2. `.env.example`을 `.env`로 복사해 실제 값 기입 (사용자가 직접. 채팅에 secret 금지)
3. `npx tsx scripts/smoke.ts` → 현재가 수신 확인 (2·3·5단계 실데이터 E2E 일괄 완료)
4. 재등록 불필요 — 서버가 `.env`를 직접 읽으므로 기존 등록 그대로, 새 세션이면 자동 반영
5. 자연어 시나리오 테스트: 시세 / 잔고(연쇄) / 환율 / 랭킹 → 실패 패턴 있으면 3절 하이브리드 표 적용
6. **수집기(8단계)를 바로 제작·가동** — 스냅샷 데이터는 시작일부터만 쌓이므로 최우선

**단계 순서를 지킨다.** 특히 3단계(수작업 tool 1개 E2E)가 이 프로젝트의 학습 핵심이므로
건너뛰지 않는다. 1단계는 0단계와 무관하게 진행 가능. 각 단계 완료 시 이 표를 갱신한다.

## 7. 검증·등록 커맨드

```bash
# 단독 검증 (Claude Code 연결 전 필수)
npx @modelcontextprotocol/inspector npx tsx src/index.ts

# Claude Code 등록
claude mcp add toss-invest --scope user \
  -e TOSS_CLIENT_ID=발급받은_ID \
  -e TOSS_CLIENT_SECRET=발급받은_SECRET \
  -- npx tsx /절대경로/toss-mcp/src/index.ts

# 세션 내 연결 상태 확인
/mcp
```

디버깅 순서: Inspector에서 tool 단독 동작 확인 → Claude Code 연결 → `/mcp`로 상태 확인 → 자연어 질문 테스트.

## 8. 배경 지식 요약 (재설명 불필요)

- stdio MCP 서버 = stdin/stdout 파이프로 JSON-RPC를 반복 처리하는 상주 프로세스 (LSP와 동일 아키텍처).
- 프로세스 라이프사이클 주체는 MCP 클라이언트(Claude Code) — 세션 시작 시 spawn, 종료 시 kill.
- LLM에게는 tool 명세(이름·설명·JSON Schema)만 컨텍스트로 주입되고, LLM은 호출 의사만 출력. 실제 실행·인증은 서버 담당.
- tool 호출은 agentic loop — 결과가 올 때마다 LLM이 읽고 다음 호출을 결정. 여러 API 조합이 필요한 질문은 LLM이 tool을 연쇄 호출해 해결한다.

## 9. 공식 문서 (Source of Truth — 토스증권이 기계 판독용으로 공개)

- Overview: `https://openapi.tossinvest.com/openapi-docs/overview.md`
- API 레퍼런스(마크다운): `https://openapi.tossinvest.com/openapi-docs/latest/api-reference/README.md`
- **OpenAPI JSON(정규 명세)**: `https://openapi.tossinvest.com/openapi-docs/latest/openapi.json`
- llms.txt: `https://developers.tossinvest.com/llms.txt`
- 명세 실측 (v1.2.5 기준, 2026-07-27 다운로드): 27개 path / 30개 operation.
  태그: Auth, Market Data, Stock Info, Market Info, Ranking, Market Indicators,
  Account, Asset, Order, Order History, Conditional Order, Conditional Order History, Order Info
- 쓰기 동작은 정확히 6개뿐: 주문 생성/정정/취소(POST), 조건주문 생성/수정(POST)/취소(DELETE).
  **나머지는 전부 GET** → 자동 등록 전환 시 "GET만 등록" 필터가 가장 단순·안전.
  태그도 읽기(Order History/Order Info)와 쓰기(Order/Conditional Order)가 이미 분리되어 있음
- 첫 tool `get_quote` 대상: `GET /api/v1/prices` (현재가 조회)

## 10. 참고 구현체 (막힐 때 코드 레벨 참조)

- `JeongSeongMok/tossinvest-openapi-mcp` (TypeScript) — openapi.json 내장·파싱 구조 (6단계 전환 시 참고)
- `nangchang/stock-toss-mcp` (Node) — 실제 토스 API 호출 + env 기반 인증 구조
- `tossinvest-mcp` (Python/PyPI) — `TOSS_ENABLE_TRADING` opt-in 플래그 패턴 (7단계 참고)
