// smoke test: MCP 서버 없이 "토큰 발급 → API 1개 호출"이 되는지만 확인하는 스크립트.
// 인증·네트워크 문제를 서버 코드와 분리해서 검증하기 위한 최소 실험이다.
//
// 실행 (자격증명 발급 + WTS에서 허용 IP 등록 후):
//   1. .env.example을 .env로 복사해 실제 값 기입 (.env는 커밋되지 않음)
//   2. npx tsx scripts/smoke.ts
//
// 참고: 여기서는 console.log(stdout)를 써도 된다. "stdout 금지" 규칙은
// stdout이 JSON-RPC 채널인 MCP 서버 프로세스에만 적용된다. 이건 일반 스크립트다.

import { loadDotEnv } from "../src/env.js";
import { TokenManager } from "../src/toss/auth.js";

loadDotEnv();

const BASE_URL = "https://openapi.tossinvest.com";

console.log("=== toss-mcp smoke test ===");

console.log("\n[1/2] 액세스 토큰 발급...");
const tokenManager = new TokenManager();
const token = await tokenManager.getToken();
console.log(`  OK — 토큰 수신 (앞 12자: ${token.slice(0, 12)}...)`);

console.log("\n[2/2] 현재가 조회: 005930(삼성전자), AAPL(애플)");
const res = await fetch(`${BASE_URL}/api/v1/prices?symbols=005930,AAPL`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`  HTTP ${res.status}`);

const bodyText = await res.text();
if (!res.ok) {
  console.log(`  실패 응답 본문:\n${bodyText}`);
  process.exit(1);
}

// raw JSON을 그대로 출력 — 응답 구조(envelope, 필드명)를 눈으로 확인하는 것도 목적
console.log(JSON.stringify(JSON.parse(bodyText), null, 2));
console.log("\n=== smoke test 통과 ===");
