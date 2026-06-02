// API request/response types mirroring backend DTOs

// --- Display Messages (PushToDisplayApi) ---

export interface DisplayMessageBlock {
  text: string;
  size?: "small" | "medium" | "large";
  color?: string;
  background?: string;
  weight?: "regular" | "semibold" | "bold";
}

export interface MessageRequest {
  boardId?: string;
  blocks: DisplayMessageBlock[];
  panelId?: number;
  fullPanel?: boolean;
  density?: "compact" | "standard" | "spacious";
  alignX?: "start" | "center" | "end";
  alignY?: "start" | "center" | "end";
  background?: string;
}

export interface MessagePostAcceptedResponse {
  messageId: string;
  enqueuedAtUtc: string;
  userId: string;
}

// --- Boards (PushToDisplayService) ---

export interface CreateBoardRequest {
  name: string;
  description?: string;
  layoutId?: number;
}

export interface UpdateBoardRequest {
  name?: string;
  description?: string;
  layoutId?: number;
}

export interface BoardResponse {
  boardId: string;
  name: string;
  description: string;
  layoutId: number;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
}

export interface ActiveStreamResponse {
  boardId: string;
  deviceId: string;
}

// --- Auth (GobanSource.Auth) ---

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  refreshTokenExpiresAt: number;
  refreshTokenExpiresIn: number;
  userInfo: UserInfo;
}

export interface UserInfo {
  id: string;
  provider: string;
  providerKey: string;
  login: string;
  email: string;
  name: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface OAuthTokenRequest {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  code_verifier?: string;
  refresh_token?: string;
  device_code?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

// --- Device Code Flow (future) ---

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

// --- API Error ---

export interface ApiError {
  status: number;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}
