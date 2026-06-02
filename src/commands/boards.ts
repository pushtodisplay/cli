import { Command } from "commander";
import type { PtdClient } from "../api/client.js";

export function createBoardsCommand(
  client: PtdClient,
  isJson: () => boolean,
): Command {
  const boards = new Command("boards").description("Manage boards");

  boards
    .command("list")
    .description("List all boards")
    .action(async () => {
      try {
        const boards = await client.listBoards();

        if (isJson()) {
          console.log(JSON.stringify(boards, null, 2));
          return;
        }

        if (boards.length === 0) {
          console.log("No boards found.");
          return;
        }

        console.log("Boards:");
        for (const s of boards) {
          const defaultMarker = s.isDefault ? " (default)" : "";
          console.log(
            `  ${s.boardId}  ${s.name}${defaultMarker}  ${s.description || ""}`,
          );
        }
      } catch (err) {
        handleError(err, isJson());
      }
    });

  boards
    .command("get")
    .description("Get board details")
    .argument("<id>", "Board ID")
    .action(async (id: string) => {
      try {
        const board = await client.getBoard(id);

        if (isJson()) {
          console.log(JSON.stringify(board, null, 2));
        } else {
          console.log(`Board: ${board.name}`);
          console.log(`  ID: ${board.boardId}`);
          console.log(`  Default: ${board.isDefault ? "Yes" : "No"}`);
          console.log(`  Description: ${board.description || "(none)"}`);
          console.log(`  Layout: ${board.layoutId || "(default)"}`);
          console.log(`  Created: ${board.createdAt}`);
        }
      } catch (err) {
        handleError(err, isJson());
      }
    });

  boards
    .command("create")
    .description("Create a new board")
    .requiredOption("-n, --name <name>", "Board name")
    .option("-d, --description <desc>", "Board description")
    .option("-l, --layout <layoutId>", "Layout ID")
    .action(
      async (opts: { name: string; description?: string; layout?: string }) => {
        try {
          const board = await client.createBoard({
            name: opts.name,
            description: opts.description,
            layoutId: opts.layout ? Number(opts.layout) : undefined,
          });

          if (isJson()) {
            console.log(JSON.stringify(board, null, 2));
          } else {
            console.log(`Board created: ${board.name} (${board.boardId})`);
          }
        } catch (err) {
          handleError(err, isJson());
        }
      },
    );

  boards
    .command("delete")
    .description("Delete a board")
    .argument("<id>", "Board ID")
    .action(async (id: string) => {
      try {
        await client.deleteBoard(id);

        if (isJson()) {
          console.log(JSON.stringify({ deleted: true, id }));
        } else {
          console.log(`Board ${id} deleted.`);
        }
      } catch (err) {
        handleError(err, isJson());
      }
    });

  return boards;
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
