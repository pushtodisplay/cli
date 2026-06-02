import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from "../../auth/credential-store.js";

// Mock native-keychain to avoid OS keychain dependency in tests
jest.mock("../../auth/native-keychain.js", () => ({
  createNativeKeychain: jest.fn().mockReturnValue(null),
  isKeychainSupported: jest.fn().mockReturnValue(false),
}));

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptd-cred-test-"));
  process.env.PTD_CONFIG_DIR = tempDir;
  // Clear env vars
  delete process.env.PTD_API_KEY;
  delete process.env.PTD_ACCESS_TOKEN;
  delete process.env.PTD_REFRESH_TOKEN;
});

afterEach(() => {
  delete process.env.PTD_CONFIG_DIR;
  delete process.env.PTD_API_KEY;
  delete process.env.PTD_ACCESS_TOKEN;
  delete process.env.PTD_REFRESH_TOKEN;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("loadCredentials", () => {
  it("returns empty credentials when nothing is set", async () => {
    const creds = await loadCredentials();
    expect(creds).toEqual({});
  });

  it("reads from PTD_API_KEY env var", async () => {
    process.env.PTD_API_KEY = "test-key-123";
    const creds = await loadCredentials();
    expect(creds.apiKey).toBe("test-key-123");
  });

  it("reads from PTD_ACCESS_TOKEN env var", async () => {
    process.env.PTD_ACCESS_TOKEN = "my-jwt";
    const creds = await loadCredentials();
    expect(creds.accessToken).toBe("my-jwt");
  });

  it("reads from credentials file when no env vars", async () => {
    const credPath = path.join(tempDir, "credentials.json");
    fs.writeFileSync(
      credPath,
      JSON.stringify({ apiKey: "from-file", accessToken: "token-from-file" }),
    );

    const creds = await loadCredentials();
    expect(creds.apiKey).toBe("from-file");
    expect(creds.accessToken).toBe("token-from-file");
  });

  it("env vars override file credentials", async () => {
    const credPath = path.join(tempDir, "credentials.json");
    fs.writeFileSync(credPath, JSON.stringify({ apiKey: "from-file" }));

    process.env.PTD_API_KEY = "from-env";
    const creds = await loadCredentials();
    expect(creds.apiKey).toBe("from-env");
  });
});

describe("saveCredentials", () => {
  it("saves API key to file when keychain unavailable", async () => {
    // Suppress the warning to stderr
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "saved-key" });

    const credPath = path.join(tempDir, "credentials.json");
    expect(fs.existsSync(credPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    expect(saved.apiKey).toBe("saved-key");

    stderrSpy.mockRestore();
  });

  it("saves access and refresh tokens to file", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({
      accessToken: "my-access",
      refreshToken: "my-refresh",
      expiresAt: 1234567890,
    });

    const credPath = path.join(tempDir, "credentials.json");
    const saved = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    expect(saved.accessToken).toBe("my-access");
    expect(saved.refreshToken).toBe("my-refresh");
    expect(saved.expiresAt).toBe(1234567890);

    stderrSpy.mockRestore();
  });

  it("merges with existing file credentials", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "key-1" });
    await saveCredentials({ accessToken: "token-1" });

    const credPath = path.join(tempDir, "credentials.json");
    const saved = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    expect(saved.apiKey).toBe("key-1");
    expect(saved.accessToken).toBe("token-1");

    stderrSpy.mockRestore();
  });
});

describe("clearCredentials", () => {
  it("removes credentials file", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "to-clear" });
    const credPath = path.join(tempDir, "credentials.json");
    expect(fs.existsSync(credPath)).toBe(true);

    await clearCredentials();
    expect(fs.existsSync(credPath)).toBe(false);

    stderrSpy.mockRestore();
  });

  it("does not throw when credentials file does not exist", async () => {
    await expect(clearCredentials()).resolves.not.toThrow();
  });
});

describe("environment-scoped credentials", () => {
  it("saves and loads credentials for a named environment", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "staging-key" }, "staging");

    const stagingCreds = await loadCredentials("staging");
    expect(stagingCreds.apiKey).toBe("staging-key");

    // Production credentials should be empty
    const prodCreds = await loadCredentials();
    expect(prodCreds).toEqual({});

    stderrSpy.mockRestore();
  });

  it("uses separate files for different environments", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "prod-key" });
    await saveCredentials({ apiKey: "staging-key" }, "staging");

    expect(fs.existsSync(path.join(tempDir, "credentials.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "credentials-staging.json"))).toBe(
      true,
    );

    stderrSpy.mockRestore();
  });

  it("clears only the targeted environment credentials", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "prod-key" });
    await saveCredentials({ apiKey: "staging-key" }, "staging");

    await clearCredentials("staging");

    expect(fs.existsSync(path.join(tempDir, "credentials-staging.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tempDir, "credentials.json"))).toBe(true);

    stderrSpy.mockRestore();
  });

  it("treats 'production' envName the same as undefined", async () => {
    const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

    await saveCredentials({ apiKey: "prod-key" }, "production");

    const creds = await loadCredentials();
    expect(creds.apiKey).toBe("prod-key");

    stderrSpy.mockRestore();
  });
});
