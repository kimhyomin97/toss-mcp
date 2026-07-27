// registrar.ts: openapi.json을 파싱해 tool을 자동 등록한다.
//
// "openapi.json이 프로젝트의 데이터"라는 설계의 구현부. 토스증권이 API를
// 추가하면 openapi.json 파일 교체만으로 tool이 늘어난다.
//
// 안전장치(가장 중요): **GET operation만 등록한다.**
// 주문 생성/정정/취소 등 쓰기 동작은 전부 POST/DELETE이므로 여기서 걸러진다.
// tool이 등록되지 않으면 LLM은 실수로라도 주문을 낼 수 없다.

import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TossClient } from "./toss/client.js";
import { buildZodShape, mapParameters, type SpecParameter } from "./schema.js";
import { createGenericHandler } from "./handler.js";

// "#/components/parameters/AccountSeq" 같은 명세 내부 참조($ref)를 실제 객체로 치환.
// 명세 전체가 아니라 우리가 쓰는 parameters 부분만 해석하면 되므로 직접 구현했다.
function deref<T>(spec: Record<string, unknown>, node: T): T {
  const ref = (node as { $ref?: unknown } | undefined)?.$ref;
  if (typeof ref !== "string") return node;
  let cur: unknown = spec;
  for (const part of ref.replace(/^#\//, "").split("/")) {
    cur = (cur as Record<string, unknown> | undefined)?.[part];
  }
  if (!cur) throw new Error(`$ref 해석 실패: ${ref}`);
  return cur as T;
}

// operationId → tool 이름: getPrices → get_prices
function toSnakeCase(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** 명세의 GET operation 전부를 tool로 등록하고, 등록한 이름 목록을 반환한다. */
export function registerSpecTools(server: McpServer, toss: TossClient): string[] {
  const spec = JSON.parse(
    readFileSync(new URL("../openapi.json", import.meta.url), "utf-8"),
  ) as {
    paths: Record<string, Record<string, unknown> & { parameters?: unknown[] }>;
  };

  const registered: string[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const op = pathItem.get as
      | {
          operationId: string;
          summary?: string;
          description?: string;
          parameters?: unknown[];
        }
      | undefined;
    if (!op) continue; // GET이 없는 경로(주문 생성 전용 등)는 건너뜀

    // path 공통 파라미터 + operation 파라미터를 합치고 $ref 해석
    const rawParams = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])];
    const params: SpecParameter[] = rawParams.map((p) => {
      const r = deref(spec as Record<string, unknown>, p) as SpecParameter;
      return { ...r, schema: deref(spec as Record<string, unknown>, r.schema) };
    });

    const mapped = mapParameters(params);
    const name = toSnakeCase(op.operationId);

    server.registerTool(
      name,
      {
        title: op.summary,
        // 명세 문서를 그대로 사용: summary + description 조합
        description: [op.summary, op.description].filter(Boolean).join("\n\n"),
        inputSchema: buildZodShape(mapped),
      },
      createGenericHandler(toss, "GET", path, mapped),
    );
    registered.push(name);
  }

  return registered;
}
