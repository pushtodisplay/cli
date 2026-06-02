import { Command } from "commander";
import type { AuthManager } from "../auth/auth-manager.js";
import { browserOAuthLogin, deviceCodeLogin } from "../auth/oauth.js";
import type { PtdConfig } from "../config.js";
import { PtdClient } from "../api/client.js";

export function createAuthCommand(
  authManager: AuthManager,
  config: PtdConfig,
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

      if (!authResult) {
        console.log(
          "Not authenticated. Run `pushtodisplay auth login` to log in.",
        );
        return;
      }

      if (authResult.type === "api-key") {
        const preview = authResult.token.slice(0, 8) + "...";
        console.log(`Auth method: API Key (${preview})`);
        console.log("Note: API key auth only supports the `send` command.");
      } else {
        console.log("Auth method: OAuth (JWT)");
        if (creds.expiresAt) {
          const expiresDate = new Date(creds.expiresAt * 1000);
          const isExpired = Date.now() > creds.expiresAt * 1000;
          console.log(
            `Access token expires: ${expiresDate.toISOString()}${isExpired ? " (expired)" : ""}`,
          );
        }
        console.log("All commands available (send, boards, devices).");
      }
    });

  return auth;
}
