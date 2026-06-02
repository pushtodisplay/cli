import { Command } from "commander";
import {
  loadConfig,
  saveEnvironment,
  removeEnvironment,
  listEnvironments,
  type EnvironmentUrls,
} from "./config.js";
import { PtdClient } from "./api/client.js";
import { createAuthManager } from "./auth/auth-manager.js";
import { createAuthCommand } from "./commands/auth.js";
import { createSendCommand } from "./commands/send.js";
import { createBoardsCommand } from "./commands/boards.js";
import { createDevicesCommand } from "./commands/devices.js";

declare const __PKG_VERSION__: string;

// Resolve environment name early (before commander parses) so we can
// initialise config, auth, and client at module level.
function resolveEnvName(): string | undefined {
  const idx = process.argv.indexOf("--env");
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return process.env.PTD_ENV ?? undefined;
}

const envName = resolveEnvName();
const config = loadConfig(envName);
const authManager = createAuthManager(config);

const client = new PtdClient({
  apiUrl: config.apiUrl,
  serviceUrl: config.serviceUrl,
  idpUrl: config.idpUrl,
  onTokenRefresh: () => authManager.refreshAuth(),
});

// Set auth on client before each command
async function initClient() {
  const auth = await authManager.getAuth();
  client.setAuth(auth);
}

const program = new Command();
let jsonOutput = false;

program
  .name("pushtodisplay")
  .description("PushToDisplay CLI — send updates and manage boards")
  .version(__PKG_VERSION__)
  .option("--json", "Output in JSON format")
  .option("--verbose", "Enable verbose output")
  .option("--env <name>", "Target environment (default: production)")
  .hook("preAction", async (thisCommand, actionCommand) => {
    jsonOutput = thisCommand.opts().json ?? false;
    const commandName = actionCommand.name();
    // Skip auth init for auth and mcp commands
    if (commandName !== "auth" && commandName !== "mcp") {
      await initClient();
    }
  });

const isJson = () => jsonOutput;

program.addCommand(createAuthCommand(authManager, config));
program.addCommand(createSendCommand(client, isJson));
program.addCommand(createBoardsCommand(client, isJson));
program.addCommand(createDevicesCommand(client, isJson));

const configCmd = new Command("config").description(
  "Manage configuration and environments",
);

configCmd
  .command("show")
  .description("Show current configuration")
  .action(() => {
    if (isJson()) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log("Configuration:");
      if (config.environment) {
        console.log(`  Environment: ${config.environment}`);
      }
      console.log(`  API URL:     ${config.apiUrl}`);
      console.log(`  Service URL: ${config.serviceUrl}`);
      console.log(`  IdP URL:     ${config.idpUrl}`);
    }
  });

configCmd
  .command("set-env <name>")
  .description("Configure a named environment")
  .requiredOption("--api-url <url>", "API base URL")
  .requiredOption("--service-url <url>", "Service base URL")
  .requiredOption("--idp-url <url>", "IdP base URL")
  .action(
    (
      name: string,
      opts: { apiUrl: string; serviceUrl: string; idpUrl: string },
    ) => {
      if (name === "production") {
        console.error(
          'Cannot override "production". Use top-level config or env vars instead.',
        );
        process.exitCode = 1;
        return;
      }
      const urls: EnvironmentUrls = {
        apiUrl: opts.apiUrl,
        serviceUrl: opts.serviceUrl,
        idpUrl: opts.idpUrl,
      };
      saveEnvironment(name, urls);
      console.log(`Environment "${name}" saved.`);
    },
  );

configCmd
  .command("remove-env <name>")
  .description("Remove a named environment")
  .action((name: string) => {
    if (removeEnvironment(name)) {
      console.log(`Environment "${name}" removed.`);
    } else {
      console.error(`Environment "${name}" not found.`);
      process.exitCode = 1;
    }
  });

configCmd
  .command("envs")
  .description("List configured environments")
  .action(() => {
    const envs = listEnvironments();
    if (isJson()) {
      console.log(JSON.stringify(envs));
    } else if (envs.length === 0) {
      console.log(
        "No custom environments configured. Use `pushtodisplay config set-env` to add one.",
      );
    } else {
      console.log("Configured environments:");
      for (const e of envs) {
        console.log(`  - ${e}`);
      }
    }
  });

// Default action: show config when no subcommand is given
configCmd.action(() => {
  if (isJson()) {
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log("Configuration:");
    if (config.environment) {
      console.log(`  Environment: ${config.environment}`);
    }
    console.log(`  API URL:     ${config.apiUrl}`);
    console.log(`  Service URL: ${config.serviceUrl}`);
    console.log(`  IdP URL:     ${config.idpUrl}`);
  }
});

program.addCommand(configCmd);

program
  .command("mcp")
  .description("Start MCP server for AI agent integration")
  .action(async () => {
    const { startMcpServer } = await import("./mcp-server.js");
    await startMcpServer(client, authManager);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
