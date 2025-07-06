"""Shared FastMCP app instance for all tools."""

from fastmcp import FastMCP

# Global app instance that all tool modules can import
app = FastMCP(
    name="ClaudeMcpTools Orchestration Server",
)

__all__ = ["app"]
