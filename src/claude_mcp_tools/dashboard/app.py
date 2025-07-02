"""FastAPI web dashboard for ClaudeMcpTools management."""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
import uvicorn
from fastapi import FastAPI, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

logger = structlog.get_logger()

# Initialize FastAPI app
app = FastAPI(
    title="ClaudeMcpTools Dashboard",
    description="Web dashboard for managing ClaudeMcpTools orchestration",
    version="0.2.0",
)

# Setup templates and static files
dashboard_dir = Path(__file__).parent
templates = Jinja2Templates(directory=str(dashboard_dir / "templates"))
app.mount("/static", StaticFiles(directory=str(dashboard_dir / "static")), name="static")

# WebSocket connections for real-time updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # Remove dead connections
                self.active_connections.remove(connection)

manager = ConnectionManager()


# Helper functions to interact with ClaudeMcpTools services
async def get_system_status() -> dict[str, Any]:
    """Get system status from orchestration services."""
    try:
        from ..services.agent_service import AgentService
        from ..services.cleanup_service import CleanupService
        from ..services.task_service import TaskService

        # Get storage info
        storage_info = await CleanupService.analyze_storage_usage()

        # Get agent and task counts
        agents = await AgentService.list_agents()
        tasks = await TaskService.list_tasks(limit=100)

        active_agents = len([a for a in agents.get("agents", []) if a.get("status") == "active"])
        pending_tasks = len([t for t in tasks.get("tasks", []) if t.get("status") == "pending"])
        completed_tasks = len([t for t in tasks.get("tasks", []) if t.get("status") == "completed"])

        return {
            "system_health": "healthy",
            "storage": storage_info,
            "agents": {
                "active": active_agents,
                "total": len(agents.get("agents", [])),
            },
            "tasks": {
                "pending": pending_tasks,
                "completed": completed_tasks,
                "total": len(tasks.get("tasks", [])),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error("Error getting system status", error=str(e))
        return {"error": str(e)}


async def get_active_agents() -> list[dict[str, Any]]:
    """Get list of active agents."""
    try:
        from ..services.agent_service import AgentService
        agents = await AgentService.list_agents()
        return agents.get("agents", [])
    except Exception as e:
        logger.error("Error getting agents", error=str(e))
        return []


async def get_documentation_sources() -> list[dict[str, Any]]:
    """Get documentation sources."""
    try:
        # This would need to be implemented in the documentation service
        # For now, return empty list
        return []
    except Exception as e:
        logger.error("Error getting documentation sources", error=str(e))
        return []


# Routes
@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Main dashboard page."""
    system_status = await get_system_status()
    return templates.TemplateResponse("index.html", {
        "request": request,
        "system_status": system_status,
        "page_title": "Dashboard",
    })


@app.get("/agents", response_class=HTMLResponse)
async def agents_page(request: Request):
    """Agent management page."""
    agents = await get_active_agents()
    return templates.TemplateResponse("agents.html", {
        "request": request,
        "agents": agents,
        "page_title": "Agents",
    })


@app.get("/documentation", response_class=HTMLResponse)
async def documentation_page(request: Request):
    """Documentation management page."""
    sources = await get_documentation_sources()
    return templates.TemplateResponse("documentation.html", {
        "request": request,
        "sources": sources,
        "page_title": "Documentation",
    })


@app.get("/cleanup", response_class=HTMLResponse)
async def cleanup_page(request: Request):
    """Cleanup interface page."""
    try:
        from ..services.cleanup_service import CleanupService
        storage_info = await CleanupService.analyze_storage_usage()
        orphaned = await CleanupService.find_orphaned_projects()
        stale_info = await CleanupService.find_stale_data()

        return templates.TemplateResponse("cleanup.html", {
            "request": request,
            "storage_info": storage_info,
            "orphaned_projects": orphaned,
            "stale_info": stale_info,
            "page_title": "Cleanup",
        })
    except Exception as e:
        logger.error("Error loading cleanup page", error=str(e))
        return templates.TemplateResponse("cleanup.html", {
            "request": request,
            "error": str(e),
            "page_title": "Cleanup",
        })


@app.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    """Settings page."""
    return templates.TemplateResponse("settings.html", {
        "request": request,
        "page_title": "Settings",
    })


# API Routes
@app.get("/api/status")
async def api_status():
    """API endpoint for system status."""
    return await get_system_status()


@app.get("/api/agents")
async def api_agents():
    """API endpoint for agents list."""
    agents = await get_active_agents()
    return {"agents": agents}


@app.post("/api/agents/spawn")
async def api_spawn_agent(
    agent_type: str = Form(...),
    task_description: str = Form(...),
    repository_path: str = Form(...),
):
    """API endpoint to spawn a new agent."""
    try:
        from ..services.agent_service import AgentService
        result = await AgentService.spawn_agent(
            agent_type=agent_type,
            repository_path=repository_path,
            task_description=task_description,
            capabilities=["development"],  # Default capabilities
            auto_execute=True,
        )

        # Broadcast agent spawn to WebSocket clients
        await manager.broadcast({
            "type": "agent_spawned",
            "data": result,
        })

        return result
    except Exception as e:
        logger.error("Error spawning agent", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agents/{agent_id}/terminate")
async def api_terminate_agent(agent_id: str):
    """API endpoint to terminate an agent."""
    try:
        from ..services.agent_service import AgentService
        result = await AgentService.terminate_agent(agent_id)

        # Broadcast agent termination to WebSocket clients
        await manager.broadcast({
            "type": "agent_terminated",
            "data": {"agent_id": agent_id, "result": result},
        })

        return result
    except Exception as e:
        logger.error("Error terminating agent", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cleanup/orphaned")
async def api_cleanup_orphaned(dry_run: bool = Form(True)):
    """API endpoint for orphaned project cleanup."""
    try:
        from ..services.cleanup_service import CleanupService
        orphaned = await CleanupService.find_orphaned_projects()
        repository_paths = [p["repository_path"] for p in orphaned]

        result = await CleanupService.cleanup_orphaned_projects(repository_paths, dry_run)

        # Broadcast cleanup result to WebSocket clients
        await manager.broadcast({
            "type": "cleanup_completed",
            "data": {"operation": "orphaned", "result": result},
        })

        return result
    except Exception as e:
        logger.error("Error cleaning orphaned projects", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cleanup/vacuum")
async def api_vacuum_database():
    """API endpoint for database vacuum."""
    try:
        from ..services.cleanup_service import CleanupService
        result = await CleanupService.vacuum_database()

        # Broadcast vacuum result to WebSocket clients
        await manager.broadcast({
            "type": "cleanup_completed",
            "data": {"operation": "vacuum", "result": result},
        })

        return result
    except Exception as e:
        logger.error("Error vacuuming database", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await manager.connect(websocket)
    try:
        while True:
            # Send periodic status updates
            await asyncio.sleep(30)  # Update every 30 seconds
            status = await get_system_status()
            await websocket.send_text(json.dumps({
                "type": "status_update",
                "data": status,
            }))
    except WebSocketDisconnect:
        manager.disconnect(websocket)


def main():
    """Main entry point for the dashboard server."""
    import argparse

    parser = argparse.ArgumentParser(description="ClaudeMcpTools Web Dashboard")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8080, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")

    args = parser.parse_args()

    print(f"🎛️ Starting ClaudeMcpTools Dashboard on http://{args.host}:{args.port}")
    print("📊 Dashboard features:")
    print("   • Real-time system monitoring")
    print("   • Agent management and spawning")
    print("   • Documentation browsing")
    print("   • Interactive cleanup tools")
    print("\n🛑 Press Ctrl+C to stop the server")

    uvicorn.run(
        "claude_mcp_tools.dashboard.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
