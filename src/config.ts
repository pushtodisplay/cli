import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface PtdConfig {
  apiUrl: string;
  serviceUrl: string;
  idpUrl: string;
  environment?: string;
}

export interface EnvironmentUrls {
  apiUrl: string;
  serviceUrl: string;
  idpUrl: string;
}

interface ConfigFile {
  apiUrl?: string;
  serviceUrl?: string;
  idpUrl?: string;
  environments?: Record<string, EnvironmentUrls>;
}

const DEFAULT_CONFIG: PtdConfig = {
  apiUrl: "https://api.pushtodisplay.com",
  serviceUrl: "https://services.pushtodisplay.com",
  idpUrl: "https://idp.pushtodisplay.com",
};

export function getConfigDir(): string {
  if (process.env.PTD_CONFIG_DIR) return process.env.PTD_CONFIG_DIR;
  return path.join(os.homedir(), ".config", "pushtodisplay");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function readConfigFile(): ConfigFile {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return {};
  }
}

function writeConfigFile(data: ConfigFile): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function loadConfig(envName?: string): PtdConfig {
  const envConfig: Partial<PtdConfig> = {};
  if (process.env.PTD_API_URL) envConfig.apiUrl = process.env.PTD_API_URL;
  if (process.env.PTD_SERVICE_URL)
    envConfig.serviceUrl = process.env.PTD_SERVICE_URL;
  if (process.env.PTD_IDP_URL) envConfig.idpUrl = process.env.PTD_IDP_URL;

  const fileData = readConfigFile();

  if (envName && envName !== "production") {
    const envUrls = fileData.environments?.[envName];
    if (!envUrls) {
      throw new Error(
        `Unknown environment "${envName}". Run \`pushtodisplay config envs\` to list available environments.`,
      );
    }
    return {
      ...DEFAULT_CONFIG,
      ...envUrls,
      ...envConfig,
      environment: envName,
    };
  }

  // Production (default) — use top-level file config for backward compat
  const { environments: _, ...topLevelConfig } = fileData;
  return {
    ...DEFAULT_CONFIG,
    ...topLevelConfig,
    ...envConfig,
  };
}

export function saveConfig(config: Partial<PtdConfig>): void {
  const fileData = readConfigFile();
  const { environment: _, ...configWithoutEnv } = config;
  const { environments, ...existingTopLevel } = fileData;

  const merged: ConfigFile = {
    ...existingTopLevel,
    ...configWithoutEnv,
  };
  if (environments) merged.environments = environments;

  writeConfigFile(merged);
}

export function saveEnvironment(name: string, urls: EnvironmentUrls): void {
  const fileData = readConfigFile();
  fileData.environments = fileData.environments ?? {};
  fileData.environments[name] = urls;
  writeConfigFile(fileData);
}

export function removeEnvironment(name: string): boolean {
  const fileData = readConfigFile();
  if (!fileData.environments?.[name]) return false;
  delete fileData.environments[name];
  if (Object.keys(fileData.environments).length === 0) {
    delete fileData.environments;
  }
  writeConfigFile(fileData);
  return true;
}

export function listEnvironments(): string[] {
  const fileData = readConfigFile();
  return Object.keys(fileData.environments ?? {});
}
