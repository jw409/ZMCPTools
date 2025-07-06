"""JSON parsing utilities for MCP tools."""

import json
from typing import Any


def parse_json_list(param_value: str | list[str] | None, param_name: str) -> Any:
    """Parse a parameter that can be either a JSON string (array) or a native list.
    
    Args:
        param_value: The parameter value to parse
        param_name: Name of the parameter for error messages
        
    Returns:
        Parsed list or None, or error dict if invalid
    """
    if param_value is None or isinstance(param_value, list):
        return param_value
    
    if isinstance(param_value, str) and "[" in param_value:
        try:
            json_parsed = json.loads(param_value)
            if isinstance(json_parsed, list):
                return json_parsed
            else:
                return {"error": {"code": f"INVALID_{param_name.upper()}", "message": f"{param_name} must be a JSON array when provided as string"}}
        except json.JSONDecodeError as e:
            return {"error": {"code": "INVALID_JSON", "message": f"Invalid JSON in {param_name} parameter: {e}"}}
    
    # If it's a string without [ bracket, just return as-is
    return param_value


def parse_json_dict(param_value: str | dict[str, Any] | None, param_name: str) -> Any:
    """Parse a parameter that can be either a JSON string (object) or a native dict.
    
    Args:
        param_value: The parameter value to parse
        param_name: Name of the parameter for error messages
        
    Returns:
        Parsed dict or None, or error dict if invalid
    """
    if param_value is None or isinstance(param_value, dict):
        return param_value
    
    if isinstance(param_value, str) and "{" in param_value:
        try:
            json_parsed = json.loads(param_value)
            if isinstance(json_parsed, dict):
                return json_parsed
            else:
                return {"error": {"code": f"INVALID_{param_name.upper()}", "message": f"{param_name} must be a JSON object when provided as string"}}
        except json.JSONDecodeError as e:
            return {"error": {"code": "INVALID_JSON", "message": f"Invalid JSON in {param_name} parameter: {e}"}}
    
    # If it's a string without { bracket, just return as-is  
    return param_value


def check_parsing_error(parsed_value: Any) -> bool:
    """Check if a parsed value contains an error.
    
    Args:
        parsed_value: The parsed value to check
        
    Returns:
        True if the value contains an error, False otherwise
    """
    return isinstance(parsed_value, dict) and "error" in parsed_value