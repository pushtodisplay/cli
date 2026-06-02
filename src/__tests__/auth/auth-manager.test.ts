import { createAuthManager } from "../../auth/auth-manager.js";
import { PtdApiError } from "../../api/client.js";
import type { ApiError } from "../../api/types.js";
import type { PtdConfig } from "../../config.js";

// Mock credential-store
const mockLoadCredentials = jest.fn();
const mockSaveCredentials = jest.fn();
const mockClearCredentials = jest.fn();

jest.mock("../../auth/credential-store.js", () => ({
  loadCredentials: (...args: unknown[]) => mockLoadCredentials(...args),
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
  clearCredentials: (...args: unknown[]) => mockClearCredentials(...args),
}));

// Mock oauth
const mockRefreshAccessToken = jest.fn();
jest.mock("../../auth/oauth.js", () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
}));

const config: PtdConfig = {
  apiUrl: "https://api.test.com",
  serviceUrl: "https://service.test.com",
  idpUrl: "https://idp.test.com",
};

beforeEach(() => {
  mockLoadCredentials.mockReset();
  mockSaveCredentials.mockReset();
  mockClearCredentials.mockReset();
  mockRefreshAccessToken.mockReset();
});

describe("AuthManager", () => {
  describe("getAuth", () => {
    it("returns api-key auth when api key is stored", async () => {
      mockLoadCredentials.mockResolvedValue({ apiKey: "my-key" });
      const mgr = createAuthManager(config);

      const auth = await mgr.getAuth();

      expect(auth).toEqual({ type: "api-key", token: "my-key" });
    });

    it("returns bearer auth when access token is stored", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "jwt-123",
        expiresAt: 9999999999,
      });
      const mgr = createAuthManager(config);

      const auth = await mgr.getAuth();

      expect(auth).toEqual({ type: "bearer", token: "jwt-123" });
    });

    it("returns bearer auth even when access token is expired", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "expired-jwt",
        expiresAt: 1000,
      });
      const mgr = createAuthManager(config);

      const auth = await mgr.getAuth();

      // No proactive refresh — just returns the stored token
      expect(auth).toEqual({ type: "bearer", token: "expired-jwt" });
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("returns undefined when no credentials exist", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(config);

      const auth = await mgr.getAuth();

      expect(auth).toBeUndefined();
    });

    it("prefers api key over access token", async () => {
      mockLoadCredentials.mockResolvedValue({
        apiKey: "key",
        accessToken: "jwt",
      });
      const mgr = createAuthManager(config);

      const auth = await mgr.getAuth();

      expect(auth).toEqual({ type: "api-key", token: "key" });
    });
  });

  describe("refreshAuth", () => {
    it("refreshes and returns new auth when refresh token exists", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "old-jwt",
        refreshToken: "rt-123",
      });
      mockRefreshAccessToken.mockResolvedValue({
        accessToken: "new-jwt",
        refreshToken: "new-rt",
        expiresIn: 3600,
      });
      const mgr = createAuthManager(config);

      const auth = await mgr.refreshAuth();

      expect(auth).toEqual({ type: "bearer", token: "new-jwt" });
      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "new-jwt",
          refreshToken: "new-rt",
        }),
        undefined,
      );
    });

    it("returns undefined when no refresh token exists", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "jwt-only",
      });
      const mgr = createAuthManager(config);

      const auth = await mgr.refreshAuth();

      expect(auth).toBeUndefined();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("returns undefined when refresh fails", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "old-jwt",
        refreshToken: "rt-123",
      });
      mockRefreshAccessToken.mockRejectedValue(new Error("network error"));
      const mgr = createAuthManager(config);

      const auth = await mgr.refreshAuth();

      expect(auth).toBeUndefined();
      expect(mockClearCredentials).not.toHaveBeenCalled();
    });

    it("clears credentials on permanent OAuth error (invalid_grant)", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "old-jwt",
        refreshToken: "rt-123",
      });
      mockRefreshAccessToken.mockRejectedValue(
        new PtdApiError(400, {
          status: 400,
          error: "invalid_grant",
          error_description: "User no longer exists",
        } as unknown as ApiError),
      );
      const mgr = createAuthManager(config);

      const auth = await mgr.refreshAuth();

      expect(auth).toBeUndefined();
      expect(mockClearCredentials).toHaveBeenCalledTimes(1);
    });

    it("does NOT clear credentials on transient error", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "old-jwt",
        refreshToken: "rt-123",
      });
      mockRefreshAccessToken.mockRejectedValue(
        new PtdApiError(500, { status: 500, title: "Internal Server Error" }),
      );
      const mgr = createAuthManager(config);

      const auth = await mgr.refreshAuth();

      expect(auth).toBeUndefined();
      expect(mockClearCredentials).not.toHaveBeenCalled();
    });

    it("subsequent getAuth returns refreshed token", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "old-jwt",
        refreshToken: "rt-123",
      });
      mockRefreshAccessToken.mockResolvedValue({
        accessToken: "new-jwt",
        refreshToken: "new-rt",
        expiresIn: 3600,
      });
      const mgr = createAuthManager(config);

      await mgr.refreshAuth();
      const auth = await mgr.getAuth();

      expect(auth).toEqual({ type: "bearer", token: "new-jwt" });
    });
  });

  describe("loginWithApiKey", () => {
    it("saves api key and clears cache", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(config);

      await mgr.loginWithApiKey("new-key");

      expect(mockSaveCredentials).toHaveBeenCalledWith(
        { apiKey: "new-key" },
        undefined,
      );
    });
  });

  describe("loginWithTokens", () => {
    it("saves tokens with computed expiresAt", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(config);
      const now = Math.floor(Date.now() / 1000);

      await mgr.loginWithTokens("at", "rt", 3600);

      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "at",
          refreshToken: "rt",
          expiresAt: expect.any(Number),
        }),
        undefined,
      );
      const saved = mockSaveCredentials.mock.calls[0][0];
      expect(saved.expiresAt).toBeGreaterThanOrEqual(now + 3599);
      expect(saved.expiresAt).toBeLessThanOrEqual(now + 3601);
    });
  });

  describe("logout", () => {
    it("clears credentials", async () => {
      mockLoadCredentials.mockResolvedValue({ apiKey: "key" });
      const mgr = createAuthManager(config);

      await mgr.logout();

      expect(mockClearCredentials).toHaveBeenCalled();
    });
  });

  describe("environment scoping", () => {
    const stagingConfig: PtdConfig = {
      ...config,
      environment: "staging",
    };

    it("passes environment name to loadCredentials", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(stagingConfig);

      await mgr.getAuth();

      expect(mockLoadCredentials).toHaveBeenCalledWith("staging");
    });

    it("passes environment name to saveCredentials on login", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(stagingConfig);

      await mgr.loginWithApiKey("key");

      expect(mockSaveCredentials).toHaveBeenCalledWith(
        { apiKey: "key" },
        "staging",
      );
    });

    it("passes environment name to clearCredentials on logout", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(stagingConfig);

      await mgr.logout();

      expect(mockClearCredentials).toHaveBeenCalledWith("staging");
    });

    it("passes environment name to saveCredentials on refresh", async () => {
      mockLoadCredentials.mockResolvedValue({
        accessToken: "old",
        refreshToken: "rt",
      });
      mockRefreshAccessToken.mockResolvedValue({
        accessToken: "new",
        refreshToken: "new-rt",
        expiresIn: 3600,
      });
      const mgr = createAuthManager(stagingConfig);

      await mgr.refreshAuth();

      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "new" }),
        "staging",
      );
    });

    it("passes undefined for production config", async () => {
      mockLoadCredentials.mockResolvedValue({});
      const mgr = createAuthManager(config);

      await mgr.getAuth();

      expect(mockLoadCredentials).toHaveBeenCalledWith(undefined);
    });
  });
});
