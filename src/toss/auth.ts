// TokenManager: OAuth2 액세스 토큰의 발급·캐싱·갱신을 전담하는 모듈.
//
// 인증은 tool이 아니라 인프라다 — LLM에게 "토큰 발급" tool을 노출하지 않고,
// 모든 API 호출 직전에 이 모듈이 내부적으로 유효한 토큰을 공급한다.
//
// 토스증권 토큰 스펙 (openapi.json /oauth2/token 에서 확인):
// - OAuth 2.0 Client Credentials Grant, 요청은 form-urlencoded
// - expires_in: 86400초 (24시간)
// - refresh token 없음 — 만료 시 같은 엔드포인트로 재발급
// - ⚠ client당 유효 토큰은 1개. 재발급하면 이전 토큰이 즉시 무효화된다.
//   → 프로세스 2개(예: MCP 서버 + smoke 스크립트)를 동시에 돌리면 서로의
//     토큰을 죽일 수 있다. 그래서 불필요한 재발급을 피하도록 캐싱이 필수다.

const TOKEN_URL = "https://openapi.tossinvest.com/oauth2/token";

// 만료 60초 전부터는 "곧 죽을 토큰"으로 간주하고 선제 갱신한다.
// (요청이 날아가는 도중에 만료되는 경계 상황을 피하기 위한 여유분)
const EXPIRY_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // 초 단위
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경 변수 ${name} 이(가) 설정되지 않았습니다. ` +
        `토스증권 WTS > 설정 > Open API 에서 발급받은 값을 넣어주세요.`,
    );
  }
  return value;
}

export class TokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0; // epoch ms. 이 시각 이후 토큰은 무효
  // 동시에 여러 요청이 갱신을 트리거해도 실제 발급 HTTP 요청은 1번만 나가도록,
  // 진행 중인 발급 Promise를 공유한다 (in-flight dedup).
  private inflight: Promise<string> | null = null;

  private readonly clientId = requireEnv("TOSS_CLIENT_ID");
  private readonly clientSecret = requireEnv("TOSS_CLIENT_SECRET");

  /** 유효한 액세스 토큰을 반환한다. 캐시가 살아 있으면 네트워크 요청 없음. */
  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
      return this.accessToken;
    }
    return this.refresh();
  }

  /** 캐시를 버리고 강제 재발급한다. API가 401을 돌려줬을 때 사용. */
  async forceRefresh(): Promise<string> {
    this.accessToken = null;
    return this.refresh();
  }

  private refresh(): Promise<string> {
    if (!this.inflight) {
      this.inflight = this.issue().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async issue(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      // 401=자격증명 오류, 403=허용 IP 미등록, 429=rate limit — 본문에 원인이 담겨 온다
      const detail = await res.text();
      throw new Error(`토큰 발급 실패: HTTP ${res.status} ${detail}`);
    }

    const json = (await res.json()) as TokenResponse;
    this.accessToken = json.access_token;
    this.expiresAt = Date.now() + json.expires_in * 1000;
    console.error(
      `[toss-mcp] 토큰 발급 완료 (유효기간 ${Math.round(json.expires_in / 3600)}시간)`,
    );
    return json.access_token;
  }
}
