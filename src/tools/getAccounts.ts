// get_accounts (계좌 목록 조회) — GET /api/v1/accounts
//
// 입력이 없는 가장 단순한 tool. 하지만 역할이 중요하다:
// 응답의 `accountSeq`가 보유주식·주문 등 모든 사용자 컨텍스트 API의
// X-Tossinvest-Account 헤더 값이 된다. 즉 "내 잔고 보여줘"라는 질문은
// LLM이 get_accounts → get_holdings 순서로 연쇄 호출해서 해결한다.
// (여러 API 조합은 서버가 아니라 LLM의 agentic loop가 담당한다는 설계의 실례)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TossClient } from "../toss/client.js";

export function registerGetAccounts(server: McpServer, toss: TossClient): void {
  server.registerTool(
    "get_accounts",
    {
      title: "계좌 목록 조회",
      description:
        "사용자의 토스증권 계좌 목록을 조회합니다. 현재는 종합매매(BROKERAGE) 계좌만 반환합니다. " +
        "응답의 accountSeq 값은 보유 주식 조회 등 계좌 관련 tool의 accountSeq 인자로 사용합니다.",
      inputSchema: {},
    },
    async () => {
      try {
        const raw = await toss.request("GET", "/api/v1/accounts");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(raw) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }
    },
  );
}
