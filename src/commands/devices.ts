import { Command } from "commander";
import type { PtdClient } from "../api/client.js";

export function createDevicesCommand(
  client: PtdClient,
  isJson: () => boolean,
): Command {
  const devices = new Command("devices").description(
    "Manage active device streams",
  );

  devices
    .command("list")
    .description("List active device-board streams")
    .action(async () => {
      try {
        const streams = await client.listActiveStreams();

        if (isJson()) {
          console.log(JSON.stringify(streams, null, 2));
          return;
        }

        if (streams.length === 0) {
          console.log("No active device streams.");
          return;
        }

        console.log("Active streams:");
        for (const s of streams) {
          console.log(`  Device: ${s.deviceId}  Board: ${s.boardId}`);
        }
      } catch (err) {
        handleError(err, isJson());
      }
    });

  return devices;
}

function handleError(err: unknown, json: boolean): void {
  if (json) {
    const errorObj =
      err instanceof Error
        ? {
            error: err.message,
            ...(err as Error & { body?: Record<string, unknown> }).body,
          }
        : { error: String(err) };
    console.error(JSON.stringify(errorObj, null, 2));
  } else {
    console.error("Error:", err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
