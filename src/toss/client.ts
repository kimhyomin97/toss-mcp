// TossClient: 토스증권 API 호출의 공통 관심사를 한곳에 모은 HTTP 클라이언트.
// - Bearer 토큰 자동 부착 (TokenManager에게 위임)
// - 401 응답 시 토큰 1회 강제 재발급 후 재시도 ("client당 토큰 1개" 정책 때문에
//   다른 프로세스가 토큰을 재발급하면 내 토큰이 죽는데, 그 상황을 여기서 흡수한다)
// - 계좌 계열 API용 X-Tossinvest-Account 헤더 지원 (4단계에서 사용 예정)
//
// tool 핸들러는 이 클래스 덕분에 "어떤 경로를 어떤 파라미터로 부를지"만 신경 쓴다.

import { TokenManager } from "./auth.js";

const BASE_URL = "https://openapi.tossinvest.com";

export interface RequestOptions {
  /** querystring으로 붙을 파라미터. 값이 undefined면 생략된다. */
  query?: Record<string, string | undefined>;
  /** JSON body (POST용. 조회 전용 단계에서는 쓰지 않는다) */
  body?: unknown;
  /** 계좌 계열 API에 필요한 X-Tossinvest-Account 헤더 값 */
  accountNo?: string;
}

export class TossClient {
  // TokenManager를 여기서 바로 만들지 않고 첫 요청 때 생성한다(lazy).
  // 이유: 환경 변수가 없어도 서버는 뜨고 tools/list까지는 동작해야
  // Inspector 검증이 가능하다. 자격증명 오류는 "tool 호출 시점"의 에러로 표면화된다.
  private tokenManager: TokenManager | null = null;

  private getTokenManager(): TokenManager {
    if (!this.tokenManager) {
      this.tokenManager = new TokenManager();
    }
    return this.tokenManager;
  }

  /** API를 호출하고 raw JSON(파싱된 객체)을 그대로 반환한다. 실패 시 throw. */
  async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const tm = this.getTokenManager();

    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const doFetch = async (token: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (options.accountNo) headers["X-Tossinvest-Account"] = options.accountNo;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";

      return fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    };

    let res = await doFetch(await tm.getToken());

    // 401 = 토큰 무효. 딱 1회만 강제 재발급 후 재시도한다.
    if (res.status === 401) {
      console.error("[toss-mcp] 401 수신 — 토큰 재발급 후 1회 재시도");
      res = await doFetch(await tm.forceRefresh());
    }

    const text = await res.text();
    if (!res.ok) {
      // 에러 본문을 가공 없이 포함 — LLM이 원인(파라미터 오류 등)을 읽고 재시도 판단
      throw new Error(`토스증권 API 오류: HTTP ${res.status} ${method} ${path}\n${text}`);
    }
    return text ? JSON.parse(text) : null;
  }
}
