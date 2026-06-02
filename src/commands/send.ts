import { Command } from "commander";
import type { PtdClient } from "../api/client.js";
import type { MessageRequest, DisplayMessageBlock } from "../api/types.js";

export function createSendCommand(
  client: PtdClient,
  isJson: () => boolean,
): Command {
  const send = new Command("send")
    .description("Send a display update to a board")
    .argument("[text...]", "Text blocks to display")
    .option("-b, --board <boardId>", "Board ID")
    .option("-p, --panel <number>", "Panel ID (1-4)", parseInt)
    .option("--full-panel", "Use full panel mode")
    .option("-s, --size <size>", "Text size: small, medium, large")
    .option("-w, --weight <weight>", "Font weight: regular, semibold, bold")
    .option("-c, --color <hex>", "Text color (hex, e.g. #FF0000)")
    .option("--background <hex>", "Background color (hex)")
    .option("--density <density>", "Line density: compact, standard, spacious")
    .option("--align-x <align>", "Horizontal alignment: start, center, end")
    .option("--align-y <align>", "Vertical alignment: start, center, end")
    .option(
      "--block <json>",
      "Styled block as JSON (repeatable)",
      collectBlock,
      [],
    )
    .option("--stdin", "Read JSON request from stdin")
    .action(async (textArgs: string[], opts) => {
      try {
        let request: MessageRequest;

        if (opts.stdin) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          const input = Buffer.concat(chunks).toString("utf-8");
          request = JSON.parse(input) as MessageRequest;
        } else if ((opts.block as DisplayMessageBlock[]).length > 0) {
          request = { blocks: opts.block as DisplayMessageBlock[] };
          if (opts.board) request.boardId = opts.board;
          if (opts.panel !== undefined) request.panelId = opts.panel;
          if (opts.fullPanel) request.fullPanel = true;
          if (opts.density) request.density = opts.density;
          if (opts.alignX) request.alignX = opts.alignX;
          if (opts.alignY) request.alignY = opts.alignY;
          if (opts.background) request.background = opts.background;
        } else {
          if (textArgs.length === 0) {
            console.error(
              "Error: Provide text arguments, --block, or use --stdin for JSON input.",
            );
            process.exitCode = 1;
            return;
          }

          const blocks: DisplayMessageBlock[] = textArgs.map((text) => {
            const block: DisplayMessageBlock = { text };
            if (opts.size) block.size = opts.size;
            if (opts.weight) block.weight = opts.weight;
            if (opts.color) block.color = opts.color;
            return block;
          });

          request = { blocks } as MessageRequest;
          if (opts.board) request.boardId = opts.board;
          if (opts.panel !== undefined) request.panelId = opts.panel;
          if (opts.fullPanel) request.fullPanel = true;
          if (opts.density) request.density = opts.density;
          if (opts.alignX) request.alignX = opts.alignX;
          if (opts.alignY) request.alignY = opts.alignY;
          if (opts.background) request.background = opts.background;
        }

        const result = await client.sendUpdate(request);

        if (isJson()) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Message sent (${result.messageId})`);
        }
      } catch (err) {
        handleError(err, isJson());
      }
    });

  return send;
}

function collectBlock(
  value: string,
  previous: DisplayMessageBlock[],
): DisplayMessageBlock[] {
  try {
    const parsed = JSON.parse(value) as DisplayMessageBlock;
    if (!parsed.text || typeof parsed.text !== "string") {
      throw new Error('Each --block must include a "text" field.');
    }
    return [...previous, parsed];
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in --block: ${value}`);
    }
    throw err;
  }
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
