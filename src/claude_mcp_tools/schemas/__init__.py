"""Pydantic schemas for MCP tool parameter validation."""

import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator


def parse_ai_json(value: str | dict[str, Any] | None) -> dict[str, Any] | None:
    """Parse JSON from AI assistants that might format it in various ways.
    
    Handles common AI patterns:
    - JSON strings: '{"key": "value"}'
    - Markdown code blocks: ```json{"key": "value"}```
    - Extra whitespace/newlines
    - Already-parsed dictionaries (pass-through)
    
    Args:
        value: The value to parse (string, dict, or None)
        
    Returns:
        Parsed dictionary or None if parsing fails
        
    Raises:
        ValueError: If parsing fails with details about the error
    """
    if value is None:
        return None

    # Already a dictionary - pass through
    if isinstance(value, dict):
        return value

    # Must be a string to parse
    if not isinstance(value, str):
        raise ValueError(f"Expected string or dict, got {type(value).__name__}")

    # Clean the string of common AI formatting patterns
    cleaned = value.strip()

    # Remove markdown code blocks (```json...``` or ```...```)
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.MULTILINE)

    # Remove surrounding quotes if they wrap the entire JSON
    if cleaned.startswith('"') and cleaned.endswith('"') and cleaned.count('"') >= 2:
        # Check if quotes are just wrapping the JSON
        try:
            inner = cleaned[1:-1]
            # Try parsing the inner content
            json.loads(inner)
            cleaned = inner
        except (json.JSONDecodeError, ValueError):
            # Not wrapped JSON, keep original
            pass

    # Handle escaped quotes that AI might generate
    if '""' in cleaned:
        cleaned = cleaned.replace('""', '"')

    # Remove leading/trailing whitespace again
    cleaned = cleaned.strip()

    # Try to parse as JSON
    try:
        result = json.loads(cleaned)
        if not isinstance(result, dict):
            raise ValueError(f"JSON parsed to {type(result).__name__}, expected dict")
        return result
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON format: {e}. Input was: {cleaned[:100]}...")


class BaseToolSchema(BaseModel):
    """Base schema for MCP tools with AI JSON validation."""
    
    model_config = ConfigDict(
        extra="forbid",  # Prevent extra fields
        str_strip_whitespace=True,  # Strip whitespace from strings
        validate_default=True,  # Validate default values
    )
    
    @field_validator('*', mode='before')
    @classmethod
    def validate_json_fields(cls, v: Any, info) -> Any:
        """Pre-validator for fields that might be AI-formatted JSON."""
        # Only process string values that might be JSON
        if not isinstance(v, str):
            return v
            
        # Get field info
        field_name = info.field_name
        field_info = cls.model_fields.get(field_name)
        
        if not field_info:
            return v
            
        # Convert annotation to string for easier checking
        annotation_str = str(field_info.annotation)
        
        # Check if this field accepts dict types (includes Union types like dict | None)
        if 'dict' in annotation_str:
            try:
                return parse_ai_json(v)
            except ValueError:
                # If JSON parsing fails, return original value
                # Let Pydantic handle the validation error
                return v
        
        return v


__all__ = [
    "BaseToolSchema",
    "parse_ai_json",
]