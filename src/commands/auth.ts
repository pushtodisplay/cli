import { Command } from "commander";
import type { AuthManager } from "../auth/auth-manager.js";
import { browserOAuthLogin, deviceCodeLogin } from "../auth/oauth.js";
import type { PtdConfig } from "../config.js";
import { PtdClient } from "../api/client.js";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createAuthCommand(
  authManager: AuthManager,
  config: PtdConfig,
  isJson: () => boolean,
): Command {
  const auth = new Command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Authenticate with PushToDisplay")
    .option("--api-key <key>", "Authenticate using an API key")
    .option("--device-code", "Use device code flow (for headless environments)")
    .action(async (opts: { apiKey?: string; deviceCode?: boolean }) => {
      if (opts.apiKey) {
        await authManager.loginWithApiKey(opts.apiKey);
        console.log("API key saved successfully.");
        return;
      }

      if (opts.deviceCode) {
        const client = new PtdClient({
          apiUrl: config.apiUrl,
          serviceUrl: config.serviceUrl,
          idpUrl: config.idpUrl,
        });

        try {
          const result = await deviceCodeLogin(client);
          await authManager.loginWithTokens(
            result.accessToken,
            result.refreshToken,
            result.expiresIn,
          );
          console.log("Login successful.");
        } catch (err) {
          console.error(
            "Login failed:",
            err instanceof Error ? err.message : String(err),
          );
          process.exitCode = 1;
        }
        return;
      }

      // Browser OAuth flow
      console.log("Opening browser for authentication...");
      const client = new PtdClient({
        apiUrl: config.apiUrl,
        serviceUrl: config.serviceUrl,
        idpUrl: config.idpUrl,
      });

      try {
        const open = await import("open");
        const result = await browserOAuthLogin(client, config.idpUrl, (url) =>
          open.default(url).then(() => {}),
        );
        await authManager.loginWithTokens(
          result.accessToken,
          result.refreshToken,
          result.expiresIn,
        );
        console.log("Login successful.");
      } catch (err) {
        console.error(
          "Login failed:",
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  auth
    .command("logout")
    .description("Remove stored credentials")
    .action(async () => {
      await authManager.logout();
      console.log("Logged out.");
    });

  auth
    .command("status")
    .description("Show current authentication status")
    .action(async () => {
      const creds = await authManager.getCredentials();
      const authResult = await authManager.getAuth();

      const printNotAuthenticated = (method: "oauth" | null) => {
        process.exitCode = 1;
        if (isJson()) {
          console.log(
            JSON.stringify(
              {
                authenticated: false,
                method,
                accessTokenExpired: false,
                canRefresh: false,
                accessTokenExpiresAt: null,
                sessionExpiresAt: null,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(
            "Not authenticated. Run `pushtodisplay auth login` to log in.",
          );
        }
      };

      // No credentials stored at all.
      if (!authResult) {
        printNotAuthenticated(null);
        return;
      }

      // API key auth.
      if (authResult.type === "api-key") {
        if (isJson()) {
          console.log(
            JSON.stringify(
              {
                authenticated: true,
                method: "api-key",
                accessTokenExpired: false,
                canRefresh: false,
                accessTokenExpiresAt: null,
                sessionExpiresAt: null,
              },
              null,
              2,
            ),
          );
        } else {
          const preview = authResult.token.slice(0, 8) + "...";
          console.log("Authenticated: Yes");
          console.log(`Auth method: API Key (${preview})`);
          console.log("Note: API key auth only supports the `send` command.");
        }
        return;
      }

      // OAuth (JWT). A stale access token is still a recoverable, effective
      // auth state as long as the refresh token can transparently renew it.
      const now = nowSeconds();
      const accessTokenExpired = creds.expiresAt
        ? now > creds.expiresAt
        : false;
      const refreshTokenExpired =
        !!creds.refreshToken &&
        !!creds.refreshTokenExpiresAt &&
        now > creds.refreshTokenExpiresAt;
      const canRefresh = !!creds.refreshToken && !refreshTokenExpired;
      const authenticated = !accessTokenExpired || canRefresh;
      const accessTokenExpiresAt = creds.expiresAt
        ? new Date(creds.expiresAt * 1000).toISOString()
        : null;
      const sessionExpiresAt = creds.refreshTokenExpiresAt
        ? new Date(creds.refreshTokenExpiresAt * 1000).toISOString()
        : null;

      if (!authenticated) {
        process.exitCode = 1;
      }

      if (isJson()) {
        console.log(
          JSON.stringify(
            {
              authenticated,
              method: "oauth",
              accessTokenExpired,
              canRefresh,
              accessTokenExpiresAt,
              sessionExpiresAt,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (!authenticated) {
        console.log(
          "Not authenticated. Session expired. Run `pushtodisplay auth login` to log in.",
        );
        return;
      }

      console.log("Authenticated: Yes");
      console.log("Auth method: OAuth (JWT)");
      if (accessTokenExpired) {
        console.log("Access token: expired (will refresh automatically)");
      } else if (accessTokenExpiresAt) {
        console.log(`Access token expires: ${accessTokenExpiresAt}`);
      }
      if (sessionExpiresAt) {
        console.log(`Session expires: ${sessionExpiresAt}`);
      }
      console.log("All commands available (send, boards, devices).");
    });

  return auth;
}
