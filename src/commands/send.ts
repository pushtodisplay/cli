import { Command } from "commander";
import type { PtdClient } from "../api/client.js";
import type { MessageRequest, DisplayMessageBlock } from "../api/types.js";

export function createSendCommand(
  client: PtdClient,
  isJson: () => boolean,
): Command {
  const send = new Command("send")
    .description("Send one text message to a board panel")
    .argument("[text...]", "Inline text runs of the message (rendered in order on one line)")
    .option("-b, --board <boardId>", "Board ID")
    .option("-p, --panel <number>", "Panel ID (1-4)", parseInt)
    .option(
      "--full-panel",
      "Enlarge this message to the whole board (shows only the newest message)",
    )
    .option("-s, --size <size>", "Text size: small, medium, large")
    .option("-w, --weight <weight>", "Font weight: regular, semibold, bold")
    .option("-c, --color <hex>", "Text color (hex, e.g. #FF0000)")
    .option("--background <hex>", "Background color (hex)")
    .option(
      "--density <density>",
      "Line height when the text wraps: compact, standard, spacious",
    )
    .option("--align-x <align>", "Horizontal alignment: start, center, end")
    .option("--align-y <align>", "Vertical alignment: start, center, end")
    .option(
      "--block <json>",
      "Inline styled text run as JSON (repeatable)",
      collectBlock,
      [],
    )
    .option("--stdin", "Read JSON request from stdin")
    .addHelpText(
      "after",
      `
How text renders:
  blocks are inline runs (like <span>), not lines (like <p>). They flow onto
  one line in order and wrap like a paragraph. --size/--weight/--color style
  a run; the flags apply to every run generated from positional arguments.

  To put content on separate lines, send separate messages: each message is
  its own entry in the panel history. Newlines inside one message are not a
  layout mechanism.

  --density sets the line height used when that paragraph wraps.
`,
    )
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
