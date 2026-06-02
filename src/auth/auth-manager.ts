import { PtdClient, PtdApiError, type ClientAuth } from "../api/client.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  type StoredCredentials,
} from "./credential-store.js";
import { refreshAccessToken } from "./oauth.js";
import type { PtdConfig } from "../config.js";

const PERMANENT_OAUTH_ERRORS = new Set([
  "invalid_grant",
  "unauthorized_client",
  "invalid_client",
]);

const getOAuthErrorCode = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const errorCode = (body as { error?: unknown }).error;
  return typeof errorCode === "string" ? errorCode : undefined;
};

const isPermanentRefreshError = (error: unknown): boolean => {
  if (!(error instanceof PtdApiError) || error.status !== 400) return false;
  const errorCode = getOAuthErrorCode(error.body);
  return errorCode !== undefined && PERMANENT_OAUTH_ERRORS.has(errorCode);
};

export interface AuthManager {
  getAuth(): Promise<ClientAuth | undefined>;
  refreshAuth(): Promise<ClientAuth | undefined>;
  getCredentials(): Promise<StoredCredentials>;
  loginWithApiKey(apiKey: string): Promise<void>;
  loginWithTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): Promise<void>;
  logout(): Promise<void>;
}

export function createAuthManager(config: PtdConfig): AuthManager {
  let cachedCreds: StoredCredentials | undefined;
  const envName = config.environment;

  async function getCreds(): Promise<StoredCredentials> {
    if (!cachedCreds) {
      cachedCreds = await loadCredentials(envName);
    }
    return cachedCreds;
  }

  return {
    async getAuth(): Promise<ClientAuth | undefined> {
      const creds = await getCreds();

      if (creds.apiKey) {
        return { type: "api-key", token: creds.apiKey };
      }

      if (creds.accessToken) {
        return { type: "bearer", token: creds.accessToken };
      }

      return undefined;
    },

    async refreshAuth(): Promise<ClientAuth | undefined> {
      const creds = await getCreds();
      if (!creds.refreshToken) return undefined;

      try {
        const tempClient = new PtdClient({
          apiUrl: config.apiUrl,
          serviceUrl: config.serviceUrl,
          idpUrl: config.idpUrl,
        });

        const result = await refreshAccessToken(tempClient, creds.refreshToken);
        const expiresAt = Math.floor(Date.now() / 1000) + result.expiresIn;

        const newCreds: StoredCredentials = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt,
        };

        await saveCredentials(newCreds, envName);
        cachedCreds = newCreds;

        return { type: "bearer", token: result.accessToken };
      } catch (error) {
        if (isPermanentRefreshError(error)) {
          await clearCredentials(envName);
          cachedCreds = undefined;
        }
        return undefined;
      }
    },

    async getCredentials(): Promise<StoredCredentials> {
      return getCreds();
    },

    async loginWithApiKey(apiKey: string): Promise<void> {
      await saveCredentials({ apiKey }, envName);
      cachedCreds = undefined;
    },

    async loginWithTokens(
      accessToken: string,
      refreshToken: string,
      expiresIn: number,
    ): Promise<void> {
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      await saveCredentials({ accessToken, refreshToken, expiresAt }, envName);
      cachedCreds = undefined;
    },

    async logout(): Promise<void> {
      await clearCredentials(envName);
      cachedCreds = undefined;
    },
  };
}
