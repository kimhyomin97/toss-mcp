// 진입점: MCP 서버를 조립하고 stdio 파이프에 연결한다.
//
// 이 프로세스의 정체는 "stdin으로 JSON-RPC 요청을 읽고, stdout으로 응답을 쓰는
// 상주 프로세스"다. 네트워크 포트를 열지 않는다. Claude Code(MCP 클라이언트)가
// 세션 시작 시 이 프로세스를 spawn하고, 세션 종료 시 stdin을 닫아(EOF) 종료시킨다.
//
// tool은 손으로 등록하지 않는다 — registrar가 openapi.json의 GET operation을
// 전부 자동 등록한다 (쓰기 동작은 등록 자체가 안 되는 것이 안전장치).
// 수작업 버전은 src/tools/ 에 학습 기록으로 남아 있다 (등록되지 않음).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDotEnv } from "./env.js";
import { TossClient } from "./toss/client.js";
import { registerSpecTools } from "./registrar.js";

// 자격증명(.env)을 가장 먼저 로드 — TokenManager가 process.env를 읽기 전에
loadDotEnv();

// 서버의 이름·버전은 initialize 핸드셰이크 때 클라이언트에게 전달된다.
const server = new McpServer({
  name: "toss-invest",
  version: "0.1.0",
});

// TossClient는 모든 tool이 공유한다 (토큰 캐시가 하나여야 하므로)
const toss = new TossClient();

const toolNames = registerSpecTools(server, toss);

// StdioServerTransport = "stdin에서 한 줄씩 읽어 JSON-RPC로 파싱하고,
// 응답을 stdout에 한 줄씩 쓰는" 어댑터. connect() 이후부터 요청 수신 루프가 돈다.
const transport = new StdioServerTransport();
await server.connect(transport);

// 주의: stdout은 JSON-RPC 전용 채널이라 console.log는 프로토콜을 깨뜨린다.
// 사람이 볼 로그는 전부 stderr(console.error)로. 등록 목록을 찍어
// 필터(GET만)가 의도대로 동작했는지 시작할 때마다 검증한다.
console.error(
  `[toss-mcp] 서버 시작됨 — tool ${toolNames.length}개 등록:\n  ${toolNames.join("\n  ")}`,
);
