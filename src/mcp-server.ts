import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PtdClient } from "./api/client.js";
import type { AuthManager } from "./auth/auth-manager.js";
import type {
  MessageRequest,
  CreateBoardRequest,
  UpdateBoardRequest,
} from "./api/types.js";

export async function startMcpServer(
  client: PtdClient,
  authManager: AuthManager,
): Promise<void> {
  const server = new McpServer({
    name: "pushtodisplay",
    version: "0.1.0",
  });

  // Resolve auth lazily — must happen AFTER transport connects so the MCP
  // initialize handshake completes without blocking on keychain access.
  let authResolved = false;
  async function ensureAuth(): Promise<void> {
    if (authResolved) return;
    authResolved = true;
    const auth = await authManager.getAuth();
    if (auth) {
      client.setAuth(auth);
    }
  }

  // --- pushtodisplay_send_update ---
  server.tool(
    "pushtodisplay_send_update",
    "Send a display update to a PushToDisplay board. Publishes text content to all devices connected to the specified board.",
    {
      boardId: z
        .string()
        .optional()
        .describe(
          "The board ID to send the update to. If omitted, the user's default board is used.",
        ),
      blocks: z
        .array(
          z.object({
            text: z.string().describe("Text content to display"),
            size: z
              .enum(["small", "medium", "large"])
              .optional()
              .describe("Text size"),
            weight: z
              .enum(["regular", "semibold", "bold"])
              .optional()
              .describe("Font weight"),
            color: z
              .string()
              .optional()
              .describe("Text color as hex (e.g. #FF0000)"),
            background: z
              .string()
              .optional()
              .describe("Block background color as hex"),
          }),
        )
        .min(1)
        .describe("Text blocks to display"),
      panelId: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe("Panel ID (1-4)"),
      fullPanel: z.boolean().optional().describe("Use full panel mode"),
      density: z
        .enum(["compact", "standard", "spacious"])
        .optional()
        .describe("Line density"),
      alignX: z
        .enum(["start", "center", "end"])
        .optional()
        .describe("Horizontal alignment"),
      alignY: z
        .enum(["start", "center", "end"])
        .optional()
        .describe("Vertical alignment"),
      background: z
        .string()
        .optional()
        .describe("Overall background color as hex"),
    },
    async (params) => {
      await ensureAuth();
      const request: MessageRequest = {
        boardId: params.boardId,
        blocks: params.blocks,
        panelId: params.panelId,
        fullPanel: params.fullPanel,
        density: params.density,
        alignX: params.alignX,
        alignY: params.alignY,
        background: params.background,
      };

      const result = await client.sendUpdate(request);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_list_boards ---
  server.tool(
    "pushtodisplay_list_boards",
    "List all boards owned by the authenticated user.",
    {},
    async () => {
      await ensureAuth();
      const boards = await client.listBoards();
      return {
        content: [{ type: "text", text: JSON.stringify(boards, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_get_board ---
  server.tool(
    "pushtodisplay_get_board",
    "Get details of a specific board by ID.",
    {
      boardId: z.string().describe("The board ID to retrieve"),
    },
    async (params) => {
      await ensureAuth();
      const board = await client.getBoard(params.boardId);
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_list_devices ---
  server.tool(
    "pushtodisplay_list_devices",
    "List active device-board stream connections.",
    {},
    async () => {
      await ensureAuth();
      const streams = await client.listActiveStreams();
      return {
        content: [{ type: "text", text: JSON.stringify(streams, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_create_board ---
  server.tool(
    "pushtodisplay_create_board",
    "Create a new board.",
    {
      name: z.string().describe("Board name"),
      description: z.string().optional().describe("Board description"),
      layoutId: z.number().int().optional().describe("Layout ID for the board"),
    },
    async (params) => {
      await ensureAuth();
      const request: CreateBoardRequest = {
        name: params.name,
        description: params.description,
        layoutId: params.layoutId,
      };
      const board = await client.createBoard(request);
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_update_board ---
  server.tool(
    "pushtodisplay_update_board",
    "Update an existing board's name, description, or layout.",
    {
      boardId: z.string().describe("The board ID to update"),
      name: z.string().optional().describe("New board name"),
      description: z.string().optional().describe("New board description"),
      layoutId: z
        .number()
        .int()
        .optional()
        .describe("New layout ID for the board"),
    },
    async (params) => {
      await ensureAuth();
      const request: UpdateBoardRequest = {
        name: params.name,
        description: params.description,
        layoutId: params.layoutId,
      };
      const board = await client.updateBoard(params.boardId, request);
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_set_default_board ---
  server.tool(
    "pushtodisplay_set_default_board",
    "Set a board as the user's default board. The default board is used when no board ID is specified in send_update.",
    {
      boardId: z.string().describe("The board ID to set as default"),
    },
    async (params) => {
      await ensureAuth();
      const board = await client.setDefaultBoard(params.boardId);
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },
  );

  // --- pushtodisplay_delete_board ---
  server.tool(
    "pushtodisplay_delete_board",
    "Permanently delete a board and all its data. This action cannot be undone.",
    {
      boardId: z.string().describe("The board ID to delete"),
    },
    { destructiveHint: true },
    async (params) => {
      await ensureAuth();
      await client.deleteBoard(params.boardId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              deleted: true,
              boardId: params.boardId,
            }),
          },
        ],
      };
    },
  );

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
