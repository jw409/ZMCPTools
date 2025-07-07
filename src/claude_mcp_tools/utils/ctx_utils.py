"""
Context utilities for handling FastMCP resource errors.

This module provides safe wrappers for FastMCP context operations to handle
client disconnections gracefully without crashing the server.
"""

import logging
from typing import Any, Callable, TypeVar, ParamSpec
from anyio import ClosedResourceError, BrokenResourceError

logger = logging.getLogger(__name__)

P = ParamSpec('P')
T = TypeVar('T')


async def safe_ctx_call(
    ctx_method: Callable[P, T],
    *args: P.args,
    **kwargs: P.kwargs
) -> T | None:
    """
    Safely call a FastMCP context method, handling client disconnection errors.
    
    This function wraps FastMCP context operations to catch and handle
    ClosedResourceError and BrokenResourceError exceptions that occur when
    a client disconnects unexpectedly. This prevents the server from crashing
    due to these common network-related exceptions.
    
    Args:
        ctx_method: The context method to call (e.g., ctx.request_sampling)
        *args: Positional arguments to pass to the context method
        **kwargs: Keyword arguments to pass to the context method
        
    Returns:
        The result of the context method call, or None if the client disconnected
        
    Raises:
        Any exceptions other than ClosedResourceError and BrokenResourceError
        are re-raised after being logged as warnings.
        
    Example:
        ```python
        result = await safe_ctx_call(
            ctx.request_sampling,
            CreateMessageRequest(
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=100
            )
        )
        if result is None:
            # Client disconnected, handle gracefully
            return
        ```
    """
    try:
        return await ctx_method(*args, **kwargs)
    except (ClosedResourceError, BrokenResourceError) as e:
        # Client disconnected - this is expected and shouldn't crash the server
        logger.debug(f"Client disconnected during context operation: {type(e).__name__}")
        return None
    except Exception as e:
        # Log other exceptions as warnings but still re-raise them
        logger.warning(f"Unexpected error in context operation: {type(e).__name__}: {e}")
        raise