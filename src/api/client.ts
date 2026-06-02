import type {
  MessageRequest,
  MessagePostAcceptedResponse,
  CreateBoardRequest,
  UpdateBoardRequest,
  BoardResponse,
  ActiveStreamResponse,
  OAuthTokenRequest,
  OAuthTokenResponse,
  DeviceAuthorizationResponse,
  ApiError,
} from "./types.js";

export class PtdApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.detail ?? body.title ?? `API error ${status}`);
    this.name = "PtdApiError";
  }
}

export interface ClientAuth {
  type: "api-key" | "bearer";
  token: string;
}

export interface PtdClientOptions {
  /** Base URL for PushToDisplayApi (updates endpoint) */
  apiUrl: string;
  /** Base URL for PushToDisplayService (boards, api-keys, devices) */
  serviceUrl: string;
  /** Base URL for PushToDisplayIdP (auth endpoints) */
  idpUrl: string;
  /** Auth credentials */
  auth?: ClientAuth;
  /** Called when token refresh is needed */
  onTokenRefresh?: () => Promise<ClientAuth | undefined>;
}

export class PtdClient {
  private auth: ClientAuth | undefined;

  constructor(private readonly options: PtdClientOptions) {
    this.auth = options.auth;
  }

  setAuth(auth: ClientAuth | undefined) {
    this.auth = auth;
  }

  // --- Display Messages ---

  async sendUpdate(
    request: MessageRequest,
  ): Promise<MessagePostAcceptedResponse> {
    return this.request<MessagePostAcceptedResponse>(
      this.options.apiUrl,
      "POST",
      "/v1/updates",
      request,
    );
  }

  // --- Boards ---

  async listBoards(): Promise<BoardResponse[]> {
    return this.request<BoardResponse[]>(
      this.options.serviceUrl,
      "GET",
      "/v1/boards",
    );
  }

  async getBoard(boardId: string): Promise<BoardResponse> {
    return this.request<BoardResponse>(
      this.options.serviceUrl,
      "GET",
      `/v1/boards/${encodeURIComponent(boardId)}`,
    );
  }

  async createBoard(request: CreateBoardRequest): Promise<BoardResponse> {
    return this.request<BoardResponse>(
      this.options.serviceUrl,
      "POST",
      "/v1/boards",
      request,
    );
  }

  async updateBoard(
    boardId: string,
    request: UpdateBoardRequest,
  ): Promise<BoardResponse> {
    return this.request<BoardResponse>(
      this.options.serviceUrl,
      "PATCH",
      `/v1/boards/${encodeURIComponent(boardId)}`,
      request,
    );
  }

  async setDefaultBoard(boardId: string): Promise<BoardResponse> {
    return this.request<BoardResponse>(
      this.options.serviceUrl,
      "POST",
      `/v1/boards/${encodeURIComponent(boardId)}/default`,
    );
  }

  async deleteBoard(boardId: string): Promise<void> {
    await this.request<void>(
      this.options.serviceUrl,
      "DELETE",
      `/v1/boards/${encodeURIComponent(boardId)}`,
    );
  }

  // --- Active Streams / Devices ---

  async listActiveStreams(): Promise<ActiveStreamResponse[]> {
    return this.request<ActiveStreamResponse[]>(
      this.options.serviceUrl,
      "GET",
      "/v1/boards/devices/active",
    );
  }

  // --- OAuth (IdP) ---

  async exchangeOAuthToken(
    request: OAuthTokenRequest,
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined) body.set(key, value);
    }

    const response = await fetch(`${this.options.idpUrl}/oauth/v1.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new PtdApiError(response.status, errorBody as ApiError);
    }

    return response.json() as Promise<OAuthTokenResponse>;
  }

  async requestDeviceAuthorization(
    clientId: string,
    scope: string,
  ): Promise<DeviceAuthorizationResponse> {
    const body = new URLSearchParams();
    body.set("client_id", clientId);
    body.set("scope", scope);

    const response = await fetch(
      `${this.options.idpUrl}/oauth/v1.0/device/authorize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new PtdApiError(response.status, errorBody as ApiError);
    }

    return response.json() as Promise<DeviceAuthorizationResponse>;
  }

  // --- Internal ---

  private async request<T>(
    baseUrl: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      return await this.executeRequest<T>(baseUrl, method, path, body);
    } catch (err) {
      if (
        err instanceof PtdApiError &&
        err.status === 401 &&
        this.options.onTokenRefresh
      ) {
        this.auth = undefined;
        const refreshed = await this.options.onTokenRefresh();
        if (refreshed) {
          this.auth = refreshed;
          return this.executeRequest<T>(baseUrl, method, path, body);
        }
      }
      throw err;
    }
  }

  private async executeRequest<T>(
    baseUrl: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const auth = await this.resolveAuth();

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (auth) {
      if (auth.type === "api-key") {
        headers["X-Api-Key"] = auth.token;
      } else {
        headers["Authorization"] = `Bearer ${auth.token}`;
      }
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({
        status: response.status,
        title: response.statusText,
      }));
      throw new PtdApiError(response.status, errorBody as ApiError);
    }

    if (
      response.status === 204 ||
      response.headers.get("content-length") === "0"
    ) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async resolveAuth(): Promise<ClientAuth | undefined> {
    if (this.auth) return this.auth;
    if (this.options.onTokenRefresh) {
      const refreshed = await this.options.onTokenRefresh();
      if (refreshed) {
        this.auth = refreshed;
        return refreshed;
      }
    }
    return undefined;
  }
}
