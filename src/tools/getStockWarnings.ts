// get_stock_warnings (매수 유의사항 조회) — GET /api/v1/stocks/{symbol}/warnings
//
// 패턴 변형 ②: 인자가 URL 경로 자체에 치환되는(path parameter) tool.
// /api/v1/stocks/005930/warnings 처럼 경로가 입력에 따라 달라진다.
// encodeURIComponent로 감싸는 이유: 입력이 경로 구분자(/) 등을 포함해도
// URL 구조를 깨뜨리지 못하게 하는 방어.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TossClient } from "../toss/client.js";

export function registerGetStockWarnings(server: McpServer, toss: TossClient): void {
  server.registerTool(
    "get_stock_warnings",
    {
      title: "매수 유의사항 조회",
      description:
        "종목의 매수 유의사항 및 변동성 완화(VI) 발동 정보를 조회합니다. " +
        "포함 종류: 정리매매, 단기과열종목, 투자경고, 투자위험, VI 정적/동적/혼합, 신주인수권. " +
        "종목이 없으면 404, 종목은 있으나 활성 유의사항이 없으면 빈 배열을 반환합니다.",
      inputSchema: {
        symbol: z
          .string()
          .regex(/^[A-Za-z0-9.\-]+$/)
          .describe(
            "종목 심볼 1개. KRX: 6자리 숫자(예: '005930'은 삼성전자), US: 영문 티커(예: 'AAPL').",
          ),
      },
    },
    async ({ symbol }) => {
      try {
        const raw = await toss.request(
          "GET",
          `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`,
        );
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
