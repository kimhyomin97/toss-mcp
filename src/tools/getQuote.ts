// 첫 번째 tool: get_quote (현재가 조회) — GET /api/v1/prices 를 1:1로 감싼다.
//
// tool은 세 조각으로 이루어진다:
//   1) 이름·설명   → LLM이 "언제 이 tool을 쓸지" 판단하는 근거 (tools/list로 전달)
//   2) 입력 스키마 → LLM이 "어떤 인자를 만들어야 할지" 아는 근거 (zod → JSON Schema 변환)
//   3) 핸들러     → 실제 실행 코드. LLM은 이 코드를 보지 못하고, 결과 텍스트만 받는다
//
// 설명·스키마 문구는 openapi.json의 summary/description/파라미터 설명을 그대로 옮겼다.
// (명세 품질 = tool 선택 정확도라는 설계 원칙)

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TossClient } from "../toss/client.js";

export function registerGetQuote(server: McpServer, toss: TossClient): void {
  server.registerTool(
    "get_quote",
    {
      title: "현재가 조회",
      description:
        "국내(KRX)·미국 주식 종목의 현재가 정보를 조회합니다. " +
        "최대 200건까지 다건 조회를 지원하며 콤마(,)로 구분합니다.",
      inputSchema: {
        symbols: z
          .string()
          .regex(/^[A-Za-z0-9.,-]+$/)
          .describe(
            "종목 심볼. 여러 개면 콤마로 구분 (최대 200개). " +
              "국내 주식은 6자리 종목코드(예: '005930'은 삼성전자), " +
              "미국 주식은 티커(예: 'AAPL'). 예: '005930,000660' 또는 'AAPL,MSFT'",
          ),
      },
    },
    async ({ symbols }) => {
      try {
        const raw = await toss.request("GET", "/api/v1/prices", {
          query: { symbols },
        });
        // raw JSON을 가공 없이 반환 — 해석은 LLM 몫 (얇은 랩핑 원칙)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(raw) }],
        };
      } catch (err) {
        // isError: true 로 돌려주면 LLM이 에러 메시지를 읽고 재시도를 판단한다
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
