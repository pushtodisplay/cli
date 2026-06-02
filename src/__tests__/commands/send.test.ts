import { Command } from "commander";
import { createSendCommand } from "../../commands/send.js";
import type { PtdClient } from "../../api/client.js";
import type { MessageRequest } from "../../api/types.js";

function createTestHarness() {
  let capturedRequest: MessageRequest | undefined;
  const mockClient = {
    sendUpdate: jest.fn(async (req: MessageRequest) => {
      capturedRequest = req;
      return { messageId: "msg-1", enqueuedAtUtc: "now", userId: "u1" };
    }),
  } as unknown as PtdClient;

  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  program.addCommand(createSendCommand(mockClient, () => false));

  return {
    run: (args: string[]) =>
      program.parseAsync(["node", "test", "send", ...args]),
    getRequest: () => capturedRequest,
    mockClient,
  };
}

describe("send --block", () => {
  it("sends a single block from --block JSON", async () => {
    const { run, getRequest } = createTestHarness();

    await run(["--block", '{"text":"Hello","size":"large"}']);

    const req = getRequest();
    expect(req).toBeDefined();
    expect(req!.blocks).toEqual([{ text: "Hello", size: "large" }]);
    expect(req!.boardId).toBeUndefined();
  });

  it("sends multiple blocks from repeated --block flags", async () => {
    const { run, getRequest } = createTestHarness();

    await run([
      "--block",
      '{"text":"Title","size":"large","weight":"bold"}',
      "--block",
      '{"text":"Body","size":"small"}',
    ]);

    const req = getRequest();
    expect(req!.blocks).toHaveLength(2);
    expect(req!.blocks[0]).toEqual({
      text: "Title",
      size: "large",
      weight: "bold",
    });
    expect(req!.blocks[1]).toEqual({ text: "Body", size: "small" });
  });

  it("applies request-level options alongside --block", async () => {
    const { run, getRequest } = createTestHarness();

    await run([
      "--block",
      '{"text":"Hi"}',
      "--board",
      "custom-board",
      "--panel",
      "2",
      "--density",
      "compact",
    ]);

    const req = getRequest();
    expect(req!.boardId).toBe("custom-board");
    expect(req!.panelId).toBe(2);
    expect(req!.density).toBe("compact");
  });

  it("rejects --block with invalid JSON", async () => {
    const { run } = createTestHarness();

    await expect(run(["--block", "not-json"])).rejects.toThrow(
      "Invalid JSON in --block",
    );
  });

  it("rejects --block without text field", async () => {
    const { run } = createTestHarness();

    await expect(run(["--block", '{"size":"large"}'])).rejects.toThrow(
      'must include a "text" field',
    );
  });
});

describe("send text args", () => {
  it("creates blocks from positional text arguments", async () => {
    const { run, getRequest } = createTestHarness();

    await run(["Hello", "World", "--size", "large"]);

    const req = getRequest();
    expect(req!.blocks).toHaveLength(2);
    expect(req!.blocks[0]).toEqual({ text: "Hello", size: "large" });
    expect(req!.blocks[1]).toEqual({ text: "World", size: "large" });
  });
});
