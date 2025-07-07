"""Unit tests for ClosedResourceError handling in safe_ctx_call.

This test verifies that the ClosedResourceError fix is working properly by ensuring
safe_ctx_call catches client disconnection errors and returns None instead of crashing.
"""

import pytest
from unittest.mock import AsyncMock, Mock
from anyio import ClosedResourceError, BrokenResourceError

from claude_mcp_tools.utils.ctx_utils import safe_ctx_call


class TestClosedResourceErrorHandling:
    """Test cases for ClosedResourceError handling in safe_ctx_call."""

    @pytest.mark.asyncio
    async def test_safe_ctx_call_handles_closed_resource_error(self):
        """Test that safe_ctx_call returns None when ClosedResourceError is raised."""
        # Create a mock context method that raises ClosedResourceError
        mock_ctx_method = AsyncMock(side_effect=ClosedResourceError("Client disconnected"))
        
        # Call safe_ctx_call and verify it returns None
        result = await safe_ctx_call(mock_ctx_method, "test message")
        
        # Verify the method was called
        mock_ctx_method.assert_called_once_with("test message")
        
        # Verify None is returned instead of raising the exception
        assert result is None

    @pytest.mark.asyncio
    async def test_safe_ctx_call_handles_broken_resource_error(self):
        """Test that safe_ctx_call returns None when BrokenResourceError is raised."""
        # Create a mock context method that raises BrokenResourceError
        mock_ctx_method = AsyncMock(side_effect=BrokenResourceError("Connection broken"))
        
        # Call safe_ctx_call and verify it returns None
        result = await safe_ctx_call(mock_ctx_method, "test message")
        
        # Verify the method was called
        mock_ctx_method.assert_called_once_with("test message")
        
        # Verify None is returned instead of raising the exception
        assert result is None

    @pytest.mark.asyncio
    async def test_safe_ctx_call_returns_result_on_success(self):
        """Test that safe_ctx_call returns the actual result when no error occurs."""
        expected_result = {"status": "success", "data": "test"}
        
        # Create a mock context method that returns a result
        mock_ctx_method = AsyncMock(return_value=expected_result)
        
        # Call safe_ctx_call and verify it returns the actual result
        result = await safe_ctx_call(mock_ctx_method, "test message", param="value")
        
        # Verify the method was called with correct arguments
        mock_ctx_method.assert_called_once_with("test message", param="value")
        
        # Verify the actual result is returned
        assert result == expected_result

    @pytest.mark.asyncio
    async def test_safe_ctx_call_reraises_other_exceptions(self):
        """Test that safe_ctx_call re-raises exceptions other than resource errors."""
        # Create a mock context method that raises a different exception
        mock_ctx_method = AsyncMock(side_effect=ValueError("Invalid parameter"))
        
        # Verify that the exception is re-raised
        with pytest.raises(ValueError, match="Invalid parameter"):
            await safe_ctx_call(mock_ctx_method, "test message")
        
        # Verify the method was called
        mock_ctx_method.assert_called_once_with("test message")

    @pytest.mark.asyncio
    async def test_safe_ctx_call_with_ctx_info_pattern(self):
        """Test safe_ctx_call with the common ctx.info usage pattern."""
        # Mock a context object with an info method
        mock_ctx = Mock()
        mock_ctx.info = AsyncMock(side_effect=ClosedResourceError("Client gone"))
        
        # Test the common usage pattern: await safe_ctx_call(ctx.info, message)
        result = await safe_ctx_call(mock_ctx.info, "🚀 Spawning test agent")
        
        # Verify the call was made and None returned
        mock_ctx.info.assert_called_once_with("🚀 Spawning test agent")
        assert result is None

    @pytest.mark.asyncio
    async def test_safe_ctx_call_with_ctx_error_pattern(self):
        """Test safe_ctx_call with the common ctx.error usage pattern."""
        # Mock a context object with an error method
        mock_ctx = Mock()
        mock_ctx.error = AsyncMock(side_effect=BrokenResourceError("Connection lost"))
        
        # Test the common usage pattern: await safe_ctx_call(ctx.error, message)
        result = await safe_ctx_call(mock_ctx.error, "💥 Failed to spawn test agent")
        
        # Verify the call was made and None returned
        mock_ctx.error.assert_called_once_with("💥 Failed to spawn test agent")
        assert result is None

    @pytest.mark.asyncio
    async def test_safe_ctx_call_preserves_arguments(self):
        """Test that safe_ctx_call correctly passes all arguments to the wrapped method."""
        mock_ctx_method = AsyncMock(return_value="success")
        
        # Call with various argument types
        result = await safe_ctx_call(
            mock_ctx_method,
            "positional_arg",
            keyword_arg="keyword_value",
            another_kwarg=42
        )
        
        # Verify all arguments were passed correctly
        mock_ctx_method.assert_called_once_with(
            "positional_arg",
            keyword_arg="keyword_value",
            another_kwarg=42
        )
        assert result == "success"