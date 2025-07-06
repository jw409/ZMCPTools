"""Shared FastMCP app instance for all tools."""

from fastmcp import FastMCP

# Global app instance that all tool modules can import
# Removed stateless_http parameter due to FastMCP compatibility issues
app = FastMCP("ClaudeMcpTools Orchestration Server")

__all__ = ["app"]
