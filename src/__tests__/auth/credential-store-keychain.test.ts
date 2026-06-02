import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { NativeKeychain } from "../../auth/native-keychain.js";

// Create an in-memory mock keychain
const mockStore = new Map<string, string>();
const mockKeychain: NativeKeychain = {
  getPassword: jest.fn(async (account: string) => mockStore.get(account) ?? null),
  setPassword: jest.fn(async (account: string, password: string) => {
    mockStore.set(account, password);
  }),
  deletePassword: jest.fn(async (account: string) => {
    mockStore.delete(account);
  }),
};

// Mock native-keychain to return our mock keychain
jest.mock("../../auth/native-keychain.js", () => ({
  createNativeKeychain: jest.fn().mockReturnValue(mockKeychain),
  isKeychainSupported: jest.fn().mockReturnValue(true),
}));

import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from "../../auth/credential-store.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptd-cred-kc-test-"));
  process.env.PTD_CONFIG_DIR = tempDir;
  delete process.env.PTD_API_KEY;
  delete process.env.PTD_ACCESS_TOKEN;
  delete process.env.PTD_REFRESH_TOKEN;
  mockStore.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.PTD_CONFIG_DIR;
  delete process.env.PTD_API_KEY;
  delete process.env.PTD_ACCESS_TOKEN;
  delete process.env.PTD_REFRESH_TOKEN;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("credential-store with keychain available", () => {
  it("saves API key to keychain", async () => {
    await saveCredentials({ apiKey: "my-secret-key" });

    expect(mockKeychain.setPassword).toHaveBeenCalledWith(
      "api-key",
      "my-secret-key",
    );
    // Should NOT write file when keychain succeeds
    const credPath = path.join(tempDir, "credentials.json");
    expect(fs.existsSync(credPath)).toBe(false);
  });

  it("saves access token as JSON to keychain", async () => {
    await saveCredentials({
      accessToken: "jwt-token-123",
      expiresAt: 1700000000,
    });

    expect(mockKeychain.setPassword).toHaveBeenCalledWith(
      "access-token",
      JSON.stringify({ token: "jwt-token-123", expiresAt: 1700000000 }),
    );
  });

  it("saves refresh token as JSON to keychain", async () => {
    await saveCredentials({
      refreshToken: "refresh-abc",
      refreshTokenExpiresAt: 1800000000,
    });

    expect(mockKeychain.setPassword).toHaveBeenCalledWith(
      "refresh-token",
      JSON.stringify({ token: "refresh-abc", expiresAt: 1800000000 }),
    );
  });

  it("loads API key from keychain", async () => {
    mockStore.set("api-key", "stored-key");

    const creds = await loadCredentials();
    expect(creds.apiKey).toBe("stored-key");
    expect(mockKeychain.getPassword).toHaveBeenCalledWith("api-key");
  });

  it("loads and parses access token JSON from keychain", async () => {
    mockStore.set(
      "access-token",
      JSON.stringify({ token: "jwt-from-kc", expiresAt: 1700000000 }),
    );

    const creds = await loadCredentials();
    expect(creds.accessToken).toBe("jwt-from-kc");
    expect(creds.expiresAt).toBe(1700000000);
  });

  it("loads and parses refresh token JSON from keychain", async () => {
    mockStore.set(
      "access-token",
      JSON.stringify({ token: "at", expiresAt: 100 }),
    );
    mockStore.set(
      "refresh-token",
      JSON.stringify({ token: "rt-from-kc", expiresAt: 1800000000 }),
    );

    const creds = await loadCredentials();
    expect(creds.refreshToken).toBe("rt-from-kc");
    expect(creds.refreshTokenExpiresAt).toBe(1800000000);
  });

  it("env vars take priority over keychain", async () => {
    mockStore.set("api-key", "keychain-key");
    process.env.PTD_API_KEY = "env-key";

    const creds = await loadCredentials();
    expect(creds.apiKey).toBe("env-key");
  });

  it("clears keychain entries on clearCredentials", async () => {
    mockStore.set("api-key", "to-clear");
    mockStore.set("access-token", "to-clear-too");

    await clearCredentials();

    expect(mockKeychain.deletePassword).toHaveBeenCalledWith("api-key");
    expect(mockKeychain.deletePassword).toHaveBeenCalledWith("access-token");
    expect(mockKeychain.deletePassword).toHaveBeenCalledWith("refresh-token");
  });
});
