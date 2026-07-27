// schema.ts: openapi.json의 파라미터 정의 → zod 스키마 변환.
//
// 수작업 단계에서 손으로 쓰던 `z.string().regex(...).describe(...)` 를
// 명세 데이터에서 기계적으로 생성한다. 명세의 description이 그대로
// `.describe()`가 되므로 "명세 품질 = tool 선택 정확도" 원칙이 유지된다.
//
// 지원 범위는 실제 명세 조사 결과에 맞췄다 (GET 24개 기준):
// 위치 query/path/header, 타입 string(pattern)/integer/boolean/enum.

import { z, type ZodTypeAny, type ZodRawShape } from "zod";

export interface SpecSchema {
  type?: string;
  enum?: string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
}

export interface SpecParameter {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  description?: string;
  schema?: SpecSchema;
}

/** LLM에게 보여줄 입력 필드 이름과 명세 파라미터의 짝. */
export interface MappedParameter {
  key: string;
  param: SpecParameter;
}

// 명세의 헤더 이름 "X-Tossinvest-Account"는 입력 필드명으로 부적합하므로
// LLM에게는 "accountSeq"라는 이름으로 노출한다. (수작업 get_holdings와 동일한 판단)
// 값이 헤더로 들어간다는 사실은 handler만 아는 세부사항이다.
export function mapParameters(params: SpecParameter[]): MappedParameter[] {
  return params.map((param) => {
    if (param.in === "header" && param.name === "X-Tossinvest-Account") {
      return {
        key: "accountSeq",
        param: {
          ...param,
          description:
            (param.description ?? "") + " (get_accounts tool로 조회할 수 있습니다)",
        },
      };
    }
    return { key: param.name, param };
  });
}

function schemaToZod(schema: SpecSchema | undefined): ZodTypeAny {
  if (!schema) return z.string();

  if (schema.enum) {
    return z.enum(schema.enum as [string, ...string[]]);
  }

  switch (schema.type) {
    case "integer": {
      let t = z.number().int();
      if (schema.minimum !== undefined) t = t.min(schema.minimum);
      if (schema.maximum !== undefined) t = t.max(schema.maximum);
      return t;
    }
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default: {
      // string 및 미지정 타입
      let t = z.string();
      if (schema.pattern) t = t.regex(new RegExp(schema.pattern));
      return t;
    }
  }
}

/** 파라미터 목록 → registerTool의 inputSchema로 쓸 zod shape. */
export function buildZodShape(mapped: MappedParameter[]): ZodRawShape {
  // ZodRawShape 자체는 readonly라서, 조립은 일반 Record로 하고 반환만 그 타입으로
  const shape: Record<string, ZodTypeAny> = {};
  for (const { key, param } of mapped) {
    let t = schemaToZod(param.schema);
    if (param.description) t = t.describe(param.description.trim());
    if (!param.required) t = t.optional();
    shape[key] = t;
  }
  return shape;
}
