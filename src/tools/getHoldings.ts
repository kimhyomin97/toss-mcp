// get_holdings (보유 주식 조회) — GET /api/v1/holdings
//
// 패턴 변형 ①: 인자가 querystring이 아니라 "HTTP 헤더"로 들어가는 tool.
// 명세상 X-Tossinvest-Account 헤더(값 = get_accounts의 accountSeq)가 필수다.
// LLM 입장에서는 그냥 accountSeq라는 입력일 뿐이고, 그것이 헤더가 되는지
// querystring이 되는지는 핸들러(서버 구현)만 아는 세부사항이다.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TossClient } from "../toss/client.js";

export function registerGetHoldings(server: McpServer, toss: TossClient): void {
  server.registerTool(
    "get_holdings",
    {
      title: "보유 주식 조회",
      description:
        "계좌의 보유 주식 정보를 조회합니다. 국내(KR)·미국(US) 주식만 포함하며 해외 옵션·채권은 제외합니다. " +
        "보유 종목이 없으면 요약 금액은 0이고 items는 빈 배열입니다. " +
        "accountSeq는 get_accounts로 먼저 조회하세요.",
      inputSchema: {
        accountSeq: z
          .number()
          .int()
          .describe("조회할 계좌의 accountSeq. get_accounts 응답의 accountSeq 값."),
        symbol: z
          .string()
          .regex(/^[A-Za-z0-9.\-]+$/)
          .optional()
          .describe(
            "선택. 특정 종목만 필터링할 때 지정 (KR: '005930' 같은 6자리 코드, US: 'AAPL' 같은 티커). " +
              "미지정 시 전체 보유 종목 반환.",
          ),
      },
    },
    async ({ accountSeq, symbol }) => {
      try {
        const raw = await toss.request("GET", "/api/v1/holdings", {
          accountNo: String(accountSeq), // X-Tossinvest-Account 헤더로 들어간다
          query: { symbol },
        });
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
