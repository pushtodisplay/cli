import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "../config.js";
import {
  createNativeKeychain,
  type NativeKeychain,
} from "./native-keychain.js";

const ACCOUNT_API_KEY = "api-key";
const ACCOUNT_ACCESS_TOKEN = "access-token";
const ACCOUNT_REFRESH_TOKEN = "refresh-token";

function scopedAccount(base: string, envName?: string): string {
  if (!envName || envName === "production") return base;
  return `${envName}:${base}`;
}

function getCredentialsPath(envName?: string): string {
  const suffix = envName && envName !== "production" ? `-${envName}` : "";
  return path.join(getConfigDir(), `credentials${suffix}.json`);
}

export interface StoredCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
}

let keychainInstance: NativeKeychain | null | undefined;

function getKeychain(): NativeKeychain | null {
  if (keychainInstance !== undefined) return keychainInstance;
  keychainInstance = createNativeKeychain();
  return keychainInstance;
}

function readFileCredentials(envName?: string): StoredCredentials {
  const credPath = getCredentialsPath(envName);
  if (!fs.existsSync(credPath)) return {};
  try {
    const raw = fs.readFileSync(credPath, "utf-8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return {};
  }
}

function writeFileCredentials(
  creds: StoredCredentials,
  envName?: string,
): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const credPath = getCredentialsPath(envName);
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function loadCredentials(
  envName?: string,
): Promise<StoredCredentials> {
  // Priority 1: Environment variables
  const envCreds: StoredCredentials = {};
  if (process.env.PTD_API_KEY) envCreds.apiKey = process.env.PTD_API_KEY;
  if (process.env.PTD_ACCESS_TOKEN)
    envCreds.accessToken = process.env.PTD_ACCESS_TOKEN;
  if (process.env.PTD_REFRESH_TOKEN)
    envCreds.refreshToken = process.env.PTD_REFRESH_TOKEN;

  if (envCreds.apiKey || envCreds.accessToken) {
    return envCreds;
  }

  // Priority 2: System keychain (OS-native, no native modules required)
  const keychain = getKeychain();
  if (keychain) {
    try {
      const [apiKey, accessToken, refreshToken] = await Promise.all([
        keychain.getPassword(scopedAccount(ACCOUNT_API_KEY, envName)),
        keychain.getPassword(scopedAccount(ACCOUNT_ACCESS_TOKEN, envName)),
        keychain.getPassword(scopedAccount(ACCOUNT_REFRESH_TOKEN, envName)),
      ]);

      if (apiKey || accessToken) {
        const keychainCreds: StoredCredentials = {};
        if (apiKey) keychainCreds.apiKey = apiKey;
        if (accessToken) {
          // Parse the stored JSON payload for access token metadata
          try {
            const parsed = JSON.parse(accessToken) as {
              token: string;
              expiresAt: number;
            };
            keychainCreds.accessToken = parsed.token;
            keychainCreds.expiresAt = parsed.expiresAt;
          } catch {
            keychainCreds.accessToken = accessToken;
          }
        }
        if (refreshToken) {
          try {
            const parsed = JSON.parse(refreshToken) as {
              token: string;
              expiresAt: number;
            };
            keychainCreds.refreshToken = parsed.token;
            keychainCreds.refreshTokenExpiresAt = parsed.expiresAt;
          } catch {
            keychainCreds.refreshToken = refreshToken;
          }
        }
        return keychainCreds;
      }
    } catch {
      // Keychain access failed — fall through to file
    }
  }

  // Priority 3: Config file
  return readFileCredentials(envName);
}

export async function saveCredentials(
  creds: StoredCredentials,
  envName?: string,
): Promise<void> {
  const keychain = getKeychain();

  if (keychain) {
    try {
      if (creds.apiKey) {
        await keychain.setPassword(
          scopedAccount(ACCOUNT_API_KEY, envName),
          creds.apiKey,
        );
      }
      if (creds.accessToken) {
        await keychain.setPassword(
          scopedAccount(ACCOUNT_ACCESS_TOKEN, envName),
          JSON.stringify({
            token: creds.accessToken,
            expiresAt: creds.expiresAt,
          }),
        );
      }
      if (creds.refreshToken) {
        await keychain.setPassword(
          scopedAccount(ACCOUNT_REFRESH_TOKEN, envName),
          JSON.stringify({
            token: creds.refreshToken,
            expiresAt: creds.refreshTokenExpiresAt,
          }),
        );
      }
      return;
    } catch {
      // Keychain write failed — fall through to file
    }
  }

  // Fallback to file
  process.stderr.write(
    "Warning: System keychain unavailable. Credentials stored in plaintext at " +
      getCredentialsPath(envName) +
      "\n",
  );
  const existing = readFileCredentials(envName);
  writeFileCredentials({ ...existing, ...creds }, envName);
}

export async function clearCredentials(envName?: string): Promise<void> {
  const keychain = getKeychain();

  if (keychain) {
    try {
      await Promise.all([
        keychain.deletePassword(scopedAccount(ACCOUNT_API_KEY, envName)),
        keychain.deletePassword(scopedAccount(ACCOUNT_ACCESS_TOKEN, envName)),
        keychain.deletePassword(scopedAccount(ACCOUNT_REFRESH_TOKEN, envName)),
      ]);
    } catch {
      // Ignore keychain errors
    }
  }

  // Also clear file credentials
  const credPath = getCredentialsPath(envName);
  if (fs.existsSync(credPath)) {
    fs.unlinkSync(credPath);
  }
}
