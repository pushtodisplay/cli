import { PtdClient, PtdApiError } from "../../api/client.js";
import type {
  MessageRequest,
  MessagePostAcceptedResponse,
  BoardResponse,
  ActiveStreamResponse,
} from "../../api/types.js";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function createClient(auth?: { type: "api-key" | "bearer"; token: string }) {
  return new PtdClient({
    apiUrl: "https://api.test.com",
    serviceUrl: "https://service.test.com",
    idpUrl: "https://id.test.com",
    auth,
  });
}

function mockResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("PtdClient", () => {
  describe("sendUpdate", () => {
    it("sends POST to api URL with X-Api-Key header", async () => {
      const client = createClient({ type: "api-key", token: "test-key-123" });
      const result: MessagePostAcceptedResponse = {
        messageId: "msg-1",
        enqueuedAtUtc: "2026-04-22T00:00:00Z",
        userId: "user-1",
      };
      mockFetch.mockResolvedValueOnce(mockResponse(202, result));

      const request: MessageRequest = {
        boardId: "board-1",
        blocks: [{ text: "Hello" }],
      };
      const response = await client.sendUpdate(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/v1/updates",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Api-Key": "test-key-123",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(request),
        }),
      );
      expect(response.messageId).toBe("msg-1");
    });

    it("sends POST with Bearer auth", async () => {
      const client = createClient({ type: "bearer", token: "jwt-token" });
      const result: MessagePostAcceptedResponse = {
        messageId: "msg-2",
        enqueuedAtUtc: "2026-04-22T00:00:00Z",
        userId: "user-1",
      };
      mockFetch.mockResolvedValueOnce(mockResponse(202, result));

      await client.sendUpdate({
        boardId: "board-1",
        blocks: [{ text: "Hi" }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer jwt-token",
          }),
        }),
      );
    });

    it("throws PtdApiError on failure", async () => {
      const client = createClient({ type: "api-key", token: "key" });
      mockFetch.mockResolvedValueOnce(
        mockResponse(400, {
          status: 400,
          title: "Bad Request",
          detail: "Invalid boardId",
        }),
      );

      await expect(
        client.sendUpdate({ boardId: "", blocks: [{ text: "x" }] }),
      ).rejects.toThrow(PtdApiError);
    });
  });

  describe("listBoards", () => {
    it("sends GET to service URL", async () => {
      const client = createClient({ type: "bearer", token: "jwt" });
      const boards: BoardResponse[] = [
        {
          boardId: "s-1",
          name: "Test Board",
          description: "",
          layoutId: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          isDefault: false,
        },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse(200, boards));

      const result = await client.listBoards();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://service.test.com/v1/boards",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Board");
    });
  });

  describe("listActiveStreams", () => {
    it("returns active streams", async () => {
      const client = createClient({ type: "bearer", token: "jwt" });
      const streams: ActiveStreamResponse[] = [
        {
          boardId: "s-1",
          deviceId: "d-1",
        },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse(200, streams));

      const result = await client.listActiveStreams();
      expect(result).toHaveLength(1);
      expect(result[0].deviceId).toBe("d-1");
    });
  });

  describe("onTokenRefresh", () => {
    it("calls onTokenRefresh when no auth is set", async () => {
      const refreshFn = jest.fn().mockResolvedValue({
        type: "bearer" as const,
        token: "refreshed-jwt",
      });
      const client = new PtdClient({
        apiUrl: "https://api.test.com",
        serviceUrl: "https://service.test.com",
        idpUrl: "https://id.test.com",
        onTokenRefresh: refreshFn,
      });

      mockFetch.mockResolvedValueOnce(mockResponse(200, []));
      await client.listBoards();

      expect(refreshFn).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer refreshed-jwt",
          }),
        }),
      );
    });
  });

  describe("401 retry", () => {
    it("retries with refreshed token on 401", async () => {
      const refreshFn = jest.fn().mockResolvedValue({
        type: "bearer" as const,
        token: "new-jwt",
      });
      const client = new PtdClient({
        apiUrl: "https://api.test.com",
        serviceUrl: "https://service.test.com",
        idpUrl: "https://id.test.com",
        auth: { type: "bearer", token: "expired-jwt" },
        onTokenRefresh: refreshFn,
      });

      mockFetch
        .mockResolvedValueOnce(
          mockResponse(401, { status: 401, title: "Unauthorized" }),
        )
        .mockResolvedValueOnce(mockResponse(200, []));

      const result = await client.listBoards();

      expect(refreshFn).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call uses refreshed token
      expect(mockFetch.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer new-jwt",
          }),
        }),
      );
      expect(result).toEqual([]);
    });

    it("does not retry on non-401 errors", async () => {
      const refreshFn = jest.fn();
      const client = new PtdClient({
        apiUrl: "https://api.test.com",
        serviceUrl: "https://service.test.com",
        idpUrl: "https://id.test.com",
        auth: { type: "bearer", token: "jwt" },
        onTokenRefresh: refreshFn,
      });

      mockFetch.mockResolvedValueOnce(
        mockResponse(403, { status: 403, title: "Forbidden" }),
      );

      await expect(client.listBoards()).rejects.toThrow(PtdApiError);
      expect(refreshFn).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry when onTokenRefresh is not set", async () => {
      const client = createClient({ type: "bearer", token: "expired-jwt" });

      mockFetch.mockResolvedValueOnce(
        mockResponse(401, { status: 401, title: "Unauthorized" }),
      );

      await expect(client.listBoards()).rejects.toThrow(PtdApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws when refresh returns undefined", async () => {
      const refreshFn = jest.fn().mockResolvedValue(undefined);
      const client = new PtdClient({
        apiUrl: "https://api.test.com",
        serviceUrl: "https://service.test.com",
        idpUrl: "https://id.test.com",
        auth: { type: "bearer", token: "expired-jwt" },
        onTokenRefresh: refreshFn,
      });

      mockFetch.mockResolvedValueOnce(
        mockResponse(401, { status: 401, title: "Unauthorized" }),
      );

      await expect(client.listBoards()).rejects.toThrow(PtdApiError);
      expect(refreshFn).toHaveBeenCalledTimes(1);
      // Should not retry when refresh returns undefined
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry more than once", async () => {
      const refreshFn = jest.fn().mockResolvedValue({
        type: "bearer" as const,
        token: "still-bad-jwt",
      });
      const client = new PtdClient({
        apiUrl: "https://api.test.com",
        serviceUrl: "https://service.test.com",
        idpUrl: "https://id.test.com",
        auth: { type: "bearer", token: "expired-jwt" },
        onTokenRefresh: refreshFn,
      });

      mockFetch
        .mockResolvedValueOnce(
          mockResponse(401, { status: 401, title: "Unauthorized" }),
        )
        .mockResolvedValueOnce(
          mockResponse(401, { status: 401, title: "Unauthorized" }),
        );

      await expect(client.listBoards()).rejects.toThrow(PtdApiError);
      expect(refreshFn).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
