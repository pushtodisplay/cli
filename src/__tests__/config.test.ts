import {
  loadConfig,
  saveConfig,
  getConfigPath,
  saveEnvironment,
  removeEnvironment,
  listEnvironments,
} from "../config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptd-test-"));
  process.env.PTD_CONFIG_DIR = tempDir;
  // Clear env vars used by loadConfig
  delete process.env.PTD_API_URL;
  delete process.env.PTD_SERVICE_URL;
  delete process.env.PTD_IDP_URL;
});

afterEach(() => {
  delete process.env.PTD_CONFIG_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config file or env vars", () => {
    const config = loadConfig();

    expect(config.apiUrl).toBe("https://api.pushtodisplay.com");
    expect(config.serviceUrl).toBe("https://services.pushtodisplay.com");
    expect(config.idpUrl).toBe("https://idp.pushtodisplay.com");
  });

  it("reads from config file", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        apiUrl: "https://custom.api.com",
      }),
    );

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://custom.api.com");
  });

  it("env vars override config file", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({ apiUrl: "https://from-file.com" }),
    );

    process.env.PTD_API_URL = "https://from-env.com";
    const config = loadConfig();
    expect(config.apiUrl).toBe("https://from-env.com");
  });

  it("returns production config when envName is undefined", () => {
    const config = loadConfig();
    expect(config.environment).toBeUndefined();
    expect(config.apiUrl).toBe("https://api.pushtodisplay.com");
  });

  it("returns production config when envName is 'production'", () => {
    const config = loadConfig("production");
    expect(config.environment).toBeUndefined();
  });

  it("loads named environment from config file", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        environments: {
          staging: {
            apiUrl: "https://api.staging.example.com",
            serviceUrl: "https://svc.staging.example.com",
            idpUrl: "https://idp.staging.example.com",
          },
        },
      }),
    );

    const config = loadConfig("staging");
    expect(config.environment).toBe("staging");
    expect(config.apiUrl).toBe("https://api.staging.example.com");
    expect(config.serviceUrl).toBe("https://svc.staging.example.com");
    expect(config.idpUrl).toBe("https://idp.staging.example.com");
  });

  it("env vars override named environment URLs", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        environments: {
          staging: {
            apiUrl: "https://api.staging.example.com",
            serviceUrl: "https://svc.staging.example.com",
            idpUrl: "https://idp.staging.example.com",
          },
        },
      }),
    );

    process.env.PTD_API_URL = "https://override.example.com";
    const config = loadConfig("staging");
    expect(config.apiUrl).toBe("https://override.example.com");
    expect(config.serviceUrl).toBe("https://svc.staging.example.com");
  });

  it("throws for unknown environment name", () => {
    expect(() => loadConfig("nonexistent")).toThrow(
      'Unknown environment "nonexistent"',
    );
  });

  it("does not leak environments key into top-level config", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        apiUrl: "https://custom.api.com",
        environments: {
          staging: {
            apiUrl: "https://api.staging.example.com",
            serviceUrl: "https://svc.staging.example.com",
            idpUrl: "https://idp.staging.example.com",
          },
        },
      }),
    );

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://custom.api.com");
    expect(
      (config as unknown as Record<string, unknown>).environments,
    ).toBeUndefined();
  });
});

describe("saveConfig", () => {
  it("creates config file with correct permissions", () => {
    saveConfig({ apiUrl: "https://saved.com" });

    const configPath = getConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(saved.apiUrl).toBe("https://saved.com");
  });

  it("merges with existing config", () => {
    saveConfig({ apiUrl: "https://first.com" });
    saveConfig({ serviceUrl: "https://second.com" });

    const configPath = getConfigPath();
    const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(saved.apiUrl).toBe("https://first.com");
    expect(saved.serviceUrl).toBe("https://second.com");
  });

  it("preserves environments key when saving top-level config", () => {
    saveEnvironment("staging", {
      apiUrl: "https://api.stg.com",
      serviceUrl: "https://svc.stg.com",
      idpUrl: "https://idp.stg.com",
    });

    saveConfig({ apiUrl: "https://custom.com" });

    const configPath = getConfigPath();
    const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(saved.apiUrl).toBe("https://custom.com");
    expect(saved.environments.staging.apiUrl).toBe("https://api.stg.com");
  });
});

describe("saveEnvironment", () => {
  it("adds an environment to the config file", () => {
    saveEnvironment("staging", {
      apiUrl: "https://api.stg.com",
      serviceUrl: "https://svc.stg.com",
      idpUrl: "https://idp.stg.com",
    });

    const saved = JSON.parse(
      fs.readFileSync(path.join(tempDir, "config.json"), "utf-8"),
    );
    expect(saved.environments.staging).toEqual({
      apiUrl: "https://api.stg.com",
      serviceUrl: "https://svc.stg.com",
      idpUrl: "https://idp.stg.com",
    });
  });

  it("overwrites an existing environment", () => {
    saveEnvironment("staging", {
      apiUrl: "https://old.com",
      serviceUrl: "https://old.com",
      idpUrl: "https://old.com",
    });
    saveEnvironment("staging", {
      apiUrl: "https://new.com",
      serviceUrl: "https://new.com",
      idpUrl: "https://new.com",
    });

    const saved = JSON.parse(
      fs.readFileSync(path.join(tempDir, "config.json"), "utf-8"),
    );
    expect(saved.environments.staging.apiUrl).toBe("https://new.com");
  });
});

describe("removeEnvironment", () => {
  it("removes an existing environment", () => {
    saveEnvironment("staging", {
      apiUrl: "https://a.com",
      serviceUrl: "https://b.com",
      idpUrl: "https://c.com",
    });

    const result = removeEnvironment("staging");
    expect(result).toBe(true);

    const saved = JSON.parse(
      fs.readFileSync(path.join(tempDir, "config.json"), "utf-8"),
    );
    expect(saved.environments).toBeUndefined();
  });

  it("returns false for nonexistent environment", () => {
    expect(removeEnvironment("nope")).toBe(false);
  });
});

describe("listEnvironments", () => {
  it("returns empty array when no environments configured", () => {
    expect(listEnvironments()).toEqual([]);
  });

  it("returns names of configured environments", () => {
    saveEnvironment("staging", {
      apiUrl: "https://a.com",
      serviceUrl: "https://b.com",
      idpUrl: "https://c.com",
    });
    saveEnvironment("dev", {
      apiUrl: "https://d.com",
      serviceUrl: "https://e.com",
      idpUrl: "https://f.com",
    });

    expect(listEnvironments()).toEqual(["staging", "dev"]);
  });
});
