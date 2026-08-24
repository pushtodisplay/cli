import { Command } from "commander";
import { createAuthCommand } from "../../commands/auth.js";
import type { AuthManager } from "../../auth/auth-manager.js";
import type { PtdConfig } from "../../config.js";

const config: PtdConfig = {
  apiUrl: "https://api.test.com",
  serviceUrl: "https://service.test.com",
  idpUrl: "https://idp.test.com",
};

const HOUR = 3600;
const past = Math.floor(Date.now() / 1000) - HOUR;
const future = Math.floor(Date.now() / 1000) + HOUR;

function createHarness(
  auth: Partial<AuthManager>,
  opts: { json?: boolean } = {},
) {
  const mockAuth = {
    getCredentials: jest.fn(),
    getAuth: jest.fn(),
    ...auth,
  } as unknown as AuthManager;

  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  program.addCommand(createAuthCommand(mockAuth, config, () => opts.json ?? false));

  const lines: string[] = [];
  const logSpy = jest
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });

  return {
    run: (args: string[]) =>
      program.parseAsync(["node", "test", "auth", ...args]),
    output: () => lines.join("\n"),
    restore: () => logSpy.mockRestore(),
  };
}

beforeEach(() => {
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
});

describe("auth status", () => {
  it("reports not authenticated when no credentials exist (exit 1)", async () => {
    const h = createHarness({
      getCredentials: jest.fn().mockResolvedValue({}),
      getAuth: jest.fn().mockResolvedValue(undefined),
    });
    try {
      await h.run(["status"]);
      expect(h.output()).toContain("Not authenticated");
      expect(process.exitCode).toBe(1);
    } finally {
      h.restore();
    }
  });

  it("outputs structured JSON when not authenticated with --json (exit 1)", async () => {
    const h = createHarness(
      {
        getCredentials: jest.fn().mockResolvedValue({}),
        getAuth: jest.fn().mockResolvedValue(undefined),
      },
      { json: true },
    );
    try {
      await h.run(["status"]);
      expect(JSON.parse(h.output()).authenticated).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      h.restore();
    }
  });

  it("reports an API key as authenticated (exit 0)", async () => {
    const h = createHarness({
      getCredentials: jest.fn().mockResolvedValue({ apiKey: "k-12345678" }),
      getAuth: jest.fn().mockResolvedValue({ type: "api-key", token: "k-12345678" }),
    });
    try {
      await h.run(["status"]);
      expect(h.output()).toContain("Authenticated: Yes");
      expect(h.output()).toContain("API Key (k-123456...)");
      expect(process.exitCode).toBe(0);
    } finally {
      h.restore();
    }
  });

  it("reports a valid OAuth access token as authenticated (exit 0)", async () => {
    const h = createHarness({
      getCredentials: jest.fn().mockResolvedValue({
        accessToken: "jwt",
        refreshToken: "rt",
        expiresAt: future,
        refreshTokenExpiresAt: future + HOUR * 24,
      }),
      getAuth: jest.fn().mockResolvedValue({ type: "bearer", token: "jwt" }),
    });
    try {
      await h.run(["status"]);
      expect(h.output()).toContain("Authenticated: Yes");
      expect(h.output()).toContain("All commands available");
      expect(process.exitCode).toBe(0);
    } finally {
      h.restore();
    }
  });

  it("treats an expired access token with a valid refresh token as authenticated with auto-refresh (exit 0)", async () => {
    const h = createHarness({
      getCredentials: jest.fn().mockResolvedValue({
        accessToken: "jwt",
        refreshToken: "rt",
        expiresAt: past,
        refreshTokenExpiresAt: future,
      }),
      getAuth: jest.fn().mockResolvedValue({ type: "bearer", token: "jwt" }),
    });
    try {
      await h.run(["status"]);
      expect(h.output()).toContain("Authenticated: Yes");
      expect(h.output()).toContain("Access token: expired (will refresh automatically)");
      expect(h.output()).toContain("All commands available");
      expect(process.exitCode).toBe(0);
    } finally {
      h.restore();
    }
  });

  it("reports not authenticated when the refresh token is also dead (exit 1)", async () => {
    const h = createHarness({
      getCredentials: jest.fn().mockResolvedValue({
        accessToken: "jwt",
        refreshToken: "rt",
        expiresAt: past,
        refreshTokenExpiresAt: past,
      }),
      getAuth: jest.fn().mockResolvedValue({ type: "bearer", token: "jwt" }),
    });
    try {
      await h.run(["status"]);
      expect(h.output()).toContain("Not authenticated");
      expect(process.exitCode).toBe(1);
    } finally {
      h.restore();
    }
  });

  it("reports not authenticated when there is no refresh token to recover an expired access token (exit 1)", async () => {
    const h = createHarness({
      getCredentials: jest.fn().mockResolvedValue({
        accessToken: "jwt",
        expiresAt: past,
      }),
      getAuth: jest.fn().mockResolvedValue({ type: "bearer", token: "jwt" }),
    });
    try {
      await h.run(["status"]);
      expect(h.output()).toContain("Not authenticated");
      expect(process.exitCode).toBe(1);
    } finally {
      h.restore();
    }
  });

  it("exposes granular state in JSON for agents", async () => {
    const h = createHarness(
      {
        getCredentials: jest.fn().mockResolvedValue({
          accessToken: "jwt",
          refreshToken: "rt",
          expiresAt: past,
          refreshTokenExpiresAt: future,
        }),
        getAuth: jest.fn().mockResolvedValue({ type: "bearer", token: "jwt" }),
      },
      { json: true },
    );
    try {
      await h.run(["status"]);
      const parsed = JSON.parse(h.output());
      expect(parsed.authenticated).toBe(true);
      expect(parsed.method).toBe("oauth");
      expect(parsed.accessTokenExpired).toBe(true);
      expect(parsed.canRefresh).toBe(true);
      expect(parsed.accessTokenExpiresAt).toBeDefined();
      expect(parsed.sessionExpiresAt).toBeDefined();
      expect(process.exitCode).toBe(0);
    } finally {
      h.restore();
    }
  });
});