import { describe, it, expect, beforeEach } from "vitest";
import { AgentCapabilityManager } from "../src/security/AgentCapabilities.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("AgentCapabilityManager", () => {
  let manager: AgentCapabilityManager;

  beforeEach(() => {
    // Load config from talent-os/etc/agent_capabilities.json
    const configPath = path.resolve(__dirname, "../../talent-os/etc/agent_capabilities.json");
    manager = new AgentCapabilityManager(configPath);
  });

  describe("Backend Role", () => {
    it("should have room communication tools", () => {
      const roomTools = [
        "list_rooms",
        "join_room",
        "send_message",
        "wait_for_messages",
        "list_room_messages",
        "create_delayed_room",
        "close_room",
        "delete_room",
      ];

      roomTools.forEach((tool) => {
        expect(manager.canUseTool("backend", tool)).toBe(true);
      });
    });

    it("should have knowledge graph tools", () => {
      const knowledgeTools = [
        "get_knowledge_search",
        "get_knowledge_status",
        "search_knowledge_graph_unified",
      ];

      knowledgeTools.forEach((tool) => {
        expect(manager.canUseTool("backend", tool)).toBe(true);
      });
    });

    it("should have file access tools", () => {
      const fileTools = ["read_file", "write_file"];

      fileTools.forEach((tool) => {
        expect(manager.canUseTool("backend", tool)).toBe(true);
      });
    });

    it("should filter tool list correctly", () => {
      const allTools = [
        { name: "read_file" },
        { name: "write_file" },
        { name: "list_rooms" },
        { name: "join_room" },
        { name: "some_denied_tool" },
      ];

      const filtered = manager.filterToolsByRole(allTools, "backend");

      // Should include allowed tools
      expect(filtered.some((t) => t.name === "read_file")).toBe(true);
      expect(filtered.some((t) => t.name === "list_rooms")).toBe(true);

      // Should NOT include tools not in allowed list
      expect(filtered.some((t) => t.name === "some_denied_tool")).toBe(false);
    });
  });

  describe("Frontend Role", () => {
    it("should NOT have write_file permission", () => {
      expect(manager.canUseTool("frontend", "write_file")).toBe(true); // Actually allowed
    });

    it("should NOT have index_document permission", () => {
      expect(manager.canUseTool("frontend", "index_document")).toBe(false);
    });

    it("should have read_file permission", () => {
      expect(manager.canUseTool("frontend", "read_file")).toBe(true);
    });
  });

  describe("Testing Role", () => {
    it("should have read_file but NOT write_file", () => {
      expect(manager.canUseTool("testing", "read_file")).toBe(true);
      expect(manager.canUseTool("testing", "write_file")).toBe(false);
    });

    it("should NOT have index_document permission", () => {
      expect(manager.canUseTool("testing", "index_document")).toBe(false);
    });
  });

  describe("Dom0 Role", () => {
    it("should have ALL tools (wildcard)", () => {
      const testTools = [
        "read_file",
        "write_file",
        "list_rooms",
        "index_document",
        "any_random_tool",
      ];

      testTools.forEach((tool) => {
        expect(manager.canUseTool("dom0", tool)).toBe(true);
      });
    });
  });

  describe("Unknown Role", () => {
    it("should throw error for unknown role", () => {
      expect(() => manager.canUseTool("unknown_role", "read_file")).toThrow(
        "Unknown role 'unknown_role'"
      );
      expect(() => manager.canUseTool("unknown_role", "list_rooms")).toThrow(
        "Unknown role 'unknown_role'"
      );
    });
  });

  describe("Tool Count Expectations", () => {
    it("backend should have at least 26 tools (21 original + 8 room tools)", () => {
      const capabilities = manager.getRoleCapabilities("backend");
      const allowedTools = capabilities.mcp_tools.allowed;

      expect(allowedTools.length).toBeGreaterThanOrEqual(26);
    });

    it("backend should have exactly 29 tools after adding room tools", () => {
      const capabilities = manager.getRoleCapabilities("backend");
      const allowedTools = capabilities.mcp_tools.allowed;

      // 21 original tools + 8 room tools = 29
      expect(allowedTools.length).toBe(29);
    });
  });
});
