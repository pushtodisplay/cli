import * as crypto from "node:crypto";
import * as http from "node:http";
import { PtdApiError, PtdClient } from "../api/client.js";
import type { OAuthTokenResponse, OAuthErrorResponse } from "../api/types.js";

const CLI_CLIENT_ID = "pushtodisplay-cli";
const SCOPES = "openid push management";

interface BrowserOAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Opens a browser for OAuth authorization code flow with PKCE.
 * Starts a temporary localhost HTTP server to receive the callback.
 */
export async function browserOAuthLogin(
  client: PtdClient,
  idpUrl: string,
  openBrowser: (url: string) => Promise<void>,
): Promise<BrowserOAuthResult> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();

  return new Promise<BrowserOAuthResult>((resolve, reject) => {
    const server = http.createServer();
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out. Please try again."));
    }, 120_000);

    server.on("request", async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost`);

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = url.searchParams.get("error");
        if (error) {
          const desc = url.searchParams.get("error_description") ?? error;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h2>Login failed</h2><p>${escapeHtml(desc)}</p><p>You can close this window.</p></body></html>`,
          );
          clearTimeout(timeout);
          server.close();
          reject(new Error(`OAuth error: ${desc}`));
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Invalid response</h2><p>You can close this window.</p></body></html>",
          );
          clearTimeout(timeout);
          server.close();
          reject(new Error("Invalid OAuth callback"));
          return;
        }

        // Exchange code for tokens
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const tokenResponse: OAuthTokenResponse =
          await client.exchangeOAuthToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: CLI_CLIENT_ID,
            code_verifier: verifier,
          });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Login successful!</h2><p>You can close this window and return to the terminal.</p></body></html>",
        );

        clearTimeout(timeout);
        server.close();

        resolve({
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresIn: tokenResponse.expires_in,
        });
      } catch (err) {
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const authorizeUrl = new URL(`${idpUrl}/oauth/v1.0/authorize`);
      authorizeUrl.searchParams.set("client_id", CLI_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", SCOPES);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");

      try {
        await openBrowser(authorizeUrl.toString());
      } catch {
        clearTimeout(timeout);
        server.close();
        reject(
          new Error(
            `Could not open browser. Visit this URL manually:\n${authorizeUrl.toString()}`,
          ),
        );
      }
    });
  });
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  client: PtdClient,
  refreshToken: string,
): Promise<BrowserOAuthResult> {
  const tokenResponse = await client.exchangeOAuthToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLI_CLIENT_ID,
  });

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresIn: tokenResponse.expires_in,
  };
}

interface DeviceCodeLoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Device code flow (RFC 8628) for headless / SSH / CI environments.
 * Displays a user code and polls the token endpoint until the user
 * approves or the code expires.
 */
export async function deviceCodeLogin(
  client: PtdClient,
  log: (msg: string) => void = console.error,
): Promise<DeviceCodeLoginResult> {
  const deviceAuth = await client.requestDeviceAuthorization(
    CLI_CLIENT_ID,
    SCOPES,
  );

  log("");
  log("To sign in, open this URL in a browser:");
  log(`  ${deviceAuth.verification_uri}`);
  log("");
  log(`Then enter the code: ${deviceAuth.user_code}`);
  if (deviceAuth.verification_uri_complete) {
    log("");
    log("Or open this link directly:");
    log(`  ${deviceAuth.verification_uri_complete}`);
  }
  log("");

  const intervalMs = (deviceAuth.interval || 5) * 1000;
  const deadline = Date.now() + deviceAuth.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    try {
      const tokenResponse = await client.exchangeOAuthToken({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceAuth.device_code,
        client_id: CLI_CLIENT_ID,
      });

      return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresIn: tokenResponse.expires_in,
      };
    } catch (err) {
      if (err instanceof PtdApiError) {
        const body = err.body as unknown as OAuthErrorResponse;
        const oauthError = body?.error;

        if (oauthError === "authorization_pending") {
          continue; // Keep polling
        }
        if (oauthError === "slow_down") {
          await sleep(5000); // Back off extra 5s
          continue;
        }
        if (oauthError === "access_denied") {
          throw new Error("Login denied. The user rejected the request.");
        }
        if (oauthError === "expired_token") {
          throw new Error(
            "Device code expired. Please run the login command again.",
          );
        }
      }
      throw err;
    }
  }

  throw new Error("Device code expired. Please run the login command again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
