"""FastMCP message handler implementation with logging and progress support."""

import asyncio
from datetime import datetime

import structlog
from mcp.types import Notification, ToolListChangedNotification, ProgressNotification
from fastmcp import MessageHandler, Context

logger = structlog.get_logger("message_handler")


class ClaudeMcpMessageHandler(MessageHandler):
    """Enhanced message handler with structured logging and progress tracking."""
    
    def __init__(self):
        super().__init__()
        self.active_operations: dict[str, dict[str, str | int | float | datetime]] = {}
        self.operation_counter: int = 0
    
    async def on_message(self, message) -> None:
        """Handle all incoming messages for debugging."""
        if hasattr(message, 'root') and hasattr(message.root, 'method'):
            method = message.root.method
            await logger.adebug(f"Received message: {method}")
    
    async def on_request(self, request) -> None:
        """Handle request messages that need responses."""
        method = getattr(request, 'method', 'unknown')
        await logger.ainfo(f"Processing request: {method}")
    
    async def on_notification(self, notification: Notification) -> None:
        """Handle notification messages."""
        # Get notification type
        notification_type = type(notification).__name__
        await logger.ainfo(f"Received notification: {notification_type}")
    
    async def on_tool_list_changed(
        self, notification: ToolListChangedNotification
    ) -> None:
        """Handle tool list updates."""
        await logger.ainfo("Tool list changed - refreshing available tools")
        # Could trigger tool registry refresh here if needed
    
    async def on_progress(self, notification: ProgressNotification) -> None:
        """Handle progress updates from long-running operations."""
        try:
            # Extract progress information
            progress_data = getattr(notification, 'progress', None)
            if progress_data:
                progress_id = getattr(progress_data, 'progressToken', 'unknown')
                current = getattr(progress_data, 'progress', 0)
                total = getattr(progress_data, 'total', 100)
                
                # Update active operations tracking
                if progress_id in self.active_operations:
                    self.active_operations[progress_id].update({
                        'current': current,
                        'total': total,
                        'last_update': datetime.now(),
                        'percentage': (current / total * 100) if total > 0 else 0
                    })
                
                await logger.ainfo(
                    f"Progress update: {progress_id}",
                    current=current,
                    total=total,
                    percentage=f"{(current / total * 100):.1f}%" if total > 0 else "0%"
                )
            
        except Exception as e:
            await logger.aerror(f"Error processing progress notification: {e}")
    
    async def on_logging_message(self, notification) -> None:
        """Handle server log messages with enhanced formatting."""
        try:
            level = getattr(notification, 'level', 'info').upper()
            message_data = getattr(notification, 'data', 'No message data')
            logger_name = getattr(notification, 'logger', 'server')
            
            # Format timestamp
            timestamp = datetime.now().isoformat()
            
            # Create structured log entry
            log_entry = {
                'timestamp': timestamp,
                'level': level,
                'logger': logger_name,
                'message': message_data
            }
            
            # Route to appropriate logger with emoji indicators
            if level in ['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY']:
                await logger.aerror("🔴 Server log", **log_entry)
            elif level == 'WARNING':
                await logger.awarn("🟡 Server log", **log_entry)
            elif level in ['INFO', 'NOTICE']:
                await logger.ainfo("🔵 Server log", **log_entry)
            else:  # DEBUG
                await logger.adebug("⚪ Server log", **log_entry)
                
        except Exception as e:
            await logger.aerror(f"Error processing log message: {e}")


# Custom log handler function for client-side logging
async def enhanced_log_handler(message) -> None:
    """Enhanced log handler with structured formatting."""
    try:
        level = message.level.upper()
        logger_name = message.logger or 'mcp-server'
        data = message.data
        
        # Create timestamp
        timestamp = datetime.now().isoformat()
        
        # Structure the log data
        log_data = {
            'timestamp': timestamp,
            'level': level,
            'logger': logger_name,
            'data': data
        }
        
        # Route to appropriate logger with visual indicators
        if level in ['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY']:
            await logger.aerror("🔴 MCP Server", **log_data)
        elif level == 'WARNING':
            await logger.awarn("🟡 MCP Server", **log_data)
        elif level in ['INFO', 'NOTICE']:
            await logger.ainfo("🔵 MCP Server", **log_data)
        else:  # DEBUG
            await logger.adebug("⚪ MCP Server", **log_data)
            
    except Exception as e:
        # Fallback logging if structured logging fails
        print(f"Log handler error: {e}")
        print(f"Original message: {message}")


class ProgressTracker:
    """Utility class for tracking operation progress."""
    
    def __init__(self):
        self.operations: dict[str, dict[str, str | int | datetime]] = {}
        self._counter: int = 0
    
    def start_operation(self, name: str, total: int = 100) -> str:
        """Start tracking a new operation."""
        self._counter += 1
        operation_id = f"op_{self._counter}_{name.replace(' ', '_')}"
        
        self.operations[operation_id] = {
            'name': name,
            'total': total,
            'current': 0,
            'started': datetime.now(),
            'last_update': datetime.now(),
            'status': 'running'
        }
        
        return operation_id
    
    async def update_progress(
        self, 
        operation_id: str, 
        current: int, 
        message: str | None = None,
        ctx: Context | None = None
    ) -> None:
        """Update progress for an operation."""
        if operation_id not in self.operations:
            return
        
        op = self.operations[operation_id]
        op['current'] = current
        op['last_update'] = datetime.now()
        
        if message:
            op['last_message'] = message
        
        total_val = op['total']
        percentage = (current / total_val * 100) if isinstance(total_val, int) and total_val > 0 else 0
        
        # Log progress
        await logger.ainfo(
            f"Progress: {op['name']}",
            operation_id=operation_id,
            current=current,
            total=str(op['total']),
            percentage=f"{percentage:.1f}%",
            message=message
        )
        
        # Send progress via context if available
        if ctx:
            try:
                await ctx.info(f"{op['name']}: {percentage:.1f}% ({current}/{op['total']})")
                if message:
                    await ctx.debug(f"Progress detail: {message}")
            except Exception as e:
                await logger.awarn(f"Failed to send progress via context: {e}")
    
    async def complete_operation(self, operation_id: str, ctx: Context | None = None) -> None:
        """Mark an operation as completed."""
        if operation_id not in self.operations:
            return
        
        op = self.operations[operation_id]
        op['status'] = 'completed'
        completed_time = datetime.now()
        op['completed'] = completed_time
        op['current'] = op['total']
        
        started_time = op['started']
        duration = completed_time - started_time if isinstance(started_time, datetime) else "unknown"
        
        await logger.ainfo(
            f"Operation completed: {op['name']}",
            operation_id=operation_id,
            duration=str(duration),
            total_items=str(op['total'])
        )
        
        if ctx:
            try:
                await ctx.info(f"✅ {op['name']} completed in {duration}")
            except Exception as e:
                await logger.awarn(f"Failed to send completion via context: {e}")
    
    async def fail_operation(self, operation_id: str, error: str, ctx: Context | None = None) -> None:
        """Mark an operation as failed."""
        if operation_id not in self.operations:
            return
        
        op = self.operations[operation_id]
        op['status'] = 'failed'
        op['error'] = error
        op['failed'] = datetime.now()
        
        await logger.aerror(
            f"Operation failed: {op['name']}",
            operation_id=operation_id,
            error=error,
            progress=f"{op['current']}/{op['total']}"
        )
        
        if ctx:
            try:
                await ctx.error(f"❌ {op['name']} failed: {error}")
            except Exception as e:
                await logger.awarn(f"Failed to send error via context: {e}")


# Global progress tracker instance
progress_tracker = ProgressTracker()


# Utility functions for easy progress tracking in tools
async def start_progress(name: str, total: int = 100, ctx: Context | None = None) -> str:
    """Start tracking progress for a tool operation."""
    operation_id = progress_tracker.start_operation(name, total)
    
    if ctx:
        try:
            await ctx.info(f"🚀 Starting: {name}")
        except Exception as e:
            await logger.awarn(f"Failed to send start message via context: {e}")
    
    return operation_id


async def update_progress(
    operation_id: str, 
    current: int, 
    message: str | None = None, 
    ctx: Context | None = None
) -> None:
    """Update progress for a tool operation."""
    await progress_tracker.update_progress(operation_id, current, message, ctx)


async def complete_progress(operation_id: str, ctx: Context | None = None) -> None:
    """Complete a tool operation."""
    await progress_tracker.complete_operation(operation_id, ctx)


async def fail_progress(operation_id: str, error: str, ctx: Context | None = None) -> None:
    """Fail a tool operation."""
    await progress_tracker.fail_operation(operation_id, error, ctx)