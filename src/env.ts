// .env 로더: 프로젝트 루트의 .env 파일을 읽어 process.env에 주입한다.
//
// - .env는 .gitignore에 등록되어 있어 커밋되지 않는다 — 자격증명 전용 파일
// - 이미 설정된 환경 변수가 파일보다 우선한다 (실행 환경 > 파일)
// - Node 18에는 --env-file 플래그가 없어서 직접 구현했다 (dotenv 의존성 회피)

import { readFileSync } from "node:fs";

export function loadDotEnv(): void {
  let text: string;
  try {
    // import.meta.url 기준 상대 경로 — 어느 디렉토리에서 실행해도 프로젝트 루트의 .env를 찾는다
    text = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  } catch {
    return; // .env가 없으면 조용히 통과 — 환경 변수로 직접 주입하는 방식도 계속 유효
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // 빈 줄·주석 무시

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, ""); // 따옴표로 감싼 값 허용

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
