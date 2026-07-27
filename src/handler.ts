// handler.ts: 전 tool이 공유하는 generic handler의 팩토리.
//
// 수작업 tool 4개의 핸들러가 전부 같은 모양이었던 것을 하나로 일반화했다.
// 하는 일: LLM이 준 인자를 명세의 파라미터 위치(in: path/query/header)에 따라
// HTTP 요청으로 조립 → TossClient 호출 → raw JSON 그대로 반환.
// 실패 시 isError: true + 에러 메시지 원문 (재시도 판단은 LLM 몫).

import type { TossClient } from "./toss/client.js";
import type { MappedParameter } from "./schema.js";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown; // SDK의 CallToolResult 인덱스 시그니처 요구사항
}

export function createGenericHandler(
  toss: TossClient,
  method: "GET",
  pathTemplate: string,
  mapped: MappedParameter[],
) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      let path = pathTemplate;
      const query: Record<string, string | undefined> = {};
      let accountNo: string | undefined;

      for (const { key, param } of mapped) {
        const value = args[key];
        if (value === undefined || value === null) continue; // optional 미지정
        const str = String(value); // boolean/number도 query에서는 문자열

        if (param.in === "path") {
          path = path.replace(`{${param.name}}`, encodeURIComponent(str));
        } else if (param.in === "query") {
          query[param.name] = str;
        } else {
          // 현 명세에서 header 파라미터는 X-Tossinvest-Account 하나뿐
          accountNo = str;
        }
      }

      const raw = await toss.request(method, path, { query, accountNo });
      return { content: [{ type: "text", text: JSON.stringify(raw) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: err instanceof Error ? err.message : String(err) },
        ],
      };
    }
  };
}
