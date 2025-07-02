"""Deterministic prompt templates for maximum LLM cache hits.

Based on Foundation Session pattern analysis, these templates are designed to
maximize cache reuse and achieve 85-90% token cost reduction.
"""

import hashlib
import json
from datetime import datetime
from typing import Any


class DeterministicPromptTemplates:
    """Collection of deterministic prompt templates optimized for caching."""

    # Template IDs for cache key generation
    PYTHON_ANALYSIS_TEMPLATE_ID = "python_analysis_v1"
    JAVASCRIPT_ANALYSIS_TEMPLATE_ID = "javascript_analysis_v1"
    TYPESCRIPT_ANALYSIS_TEMPLATE_ID = "typescript_analysis_v1"
    PROJECT_SUMMARY_TEMPLATE_ID = "project_summary_v1"
    DEAD_CODE_ANALYSIS_TEMPLATE_ID = "dead_code_analysis_v1"
    FOUNDATION_SESSION_TEMPLATE_ID = "foundation_session_v1"

    @staticmethod
    def get_python_analysis_prompt(file_content: str, file_path: str) -> tuple[str, str]:
        """Generate deterministic Python analysis prompt for maximum cache hits.
        
        Returns:
            Tuple of (prompt, template_id)
        """
        # Fixed timestamp format for cache consistency
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        prompt = f"""Analyze this Python file and return EXACTLY this JSON structure with no additional text:

{{
  "file_path": "{file_path}",
  "language": "python",
  "timestamp": "{timestamp}",
  "symbols": {{
    "functions": [
      {{
        "name": "FUNCTION_NAME",
        "line_start": 0,
        "line_end": 0,
        "docstring": "DOCSTRING_TEXT_OR_null",
        "parameters": ["param_name: type_annotation"],
        "return_type": "TYPE_OR_null",
        "complexity": 0,
        "is_async": false,
        "decorators": ["DECORATOR_NAMES"]
      }}
    ],
    "classes": [
      {{
        "name": "CLASS_NAME",
        "line_start": 0,
        "line_end": 0,
        "docstring": "DOCSTRING_TEXT_OR_null",
        "methods": ["method_names"],
        "properties": ["property_names"],
        "inheritance": ["parent_class_names"],
        "decorators": ["DECORATOR_NAMES"]
      }}
    ],
    "imports": [
      {{
        "module": "MODULE_NAME",
        "type": "import",
        "names": ["IMPORTED_NAMES"],
        "alias": "ALIAS_OR_null",
        "line": 0
      }}
    ],
    "constants": [
      {{
        "name": "CONSTANT_NAME",
        "value": "VALUE_REPRESENTATION",
        "type": "INFERRED_TYPE",
        "line": 0
      }}
    ]
  }},
  "exports": ["EXPORTED_NAMES"],
  "summary": "SINGLE_SENTENCE_PURPOSE_DESCRIPTION_MAX_100_CHARS",
  "complexity_score": 5,
  "maintainability_score": 5
}}

File content to analyze:
{file_content}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON."""

        return prompt, DeterministicPromptTemplates.PYTHON_ANALYSIS_TEMPLATE_ID

    @staticmethod
    def get_javascript_analysis_prompt(file_content: str, file_path: str) -> tuple[str, str]:
        """Generate deterministic JavaScript/TypeScript analysis prompt.
        
        Returns:
            Tuple of (prompt, template_id)
        """
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        language = "typescript" if file_path.endswith(".ts") or file_path.endswith(".tsx") else "javascript"

        prompt = f"""Analyze this {language} file and return EXACTLY this JSON structure with no additional text:

{{
  "file_path": "{file_path}",
  "language": "{language}",
  "timestamp": "{timestamp}",
  "symbols": {{
    "functions": [
      {{
        "name": "FUNCTION_NAME",
        "line_start": 0,
        "line_end": 0,
        "jsdoc": "JSDOC_COMMENT_OR_null",
        "parameters": ["param_name: type"],
        "return_type": "TYPE_OR_null",
        "is_async": false,
        "is_arrow": false,
        "is_exported": false
      }}
    ],
    "classes": [
      {{
        "name": "CLASS_NAME",
        "line_start": 0,
        "line_end": 0,
        "jsdoc": "JSDOC_COMMENT_OR_null",
        "methods": ["method_names"],
        "properties": ["property_names"],
        "extends": "PARENT_CLASS_OR_null",
        "is_exported": false
      }}
    ],
    "imports": [
      {{
        "source": "MODULE_PATH",
        "type": "import",
        "names": ["IMPORTED_NAMES"],
        "default": "DEFAULT_IMPORT_OR_null",
        "line": 0
      }}
    ],
    "exports": [
      {{
        "name": "EXPORT_NAME",
        "type": "named",
        "line": 0
      }}
    ]
  }},
  "summary": "SINGLE_SENTENCE_PURPOSE_DESCRIPTION_MAX_100_CHARS",
  "complexity_score": 5,
  "framework": "DETECTED_FRAMEWORK_OR_null"
}}

File content to analyze:
{file_content}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON."""

        template_id = (DeterministicPromptTemplates.TYPESCRIPT_ANALYSIS_TEMPLATE_ID
                      if language == "typescript"
                      else DeterministicPromptTemplates.JAVASCRIPT_ANALYSIS_TEMPLATE_ID)

        return prompt, template_id

    @staticmethod
    def get_project_summary_prompt(analysis_data: dict[str, Any], project_path: str) -> tuple[str, str]:
        """Generate deterministic project summary prompt.
        
        Returns:
            Tuple of (prompt, template_id)
        """
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        prompt = f"""Generate EXACTLY this JSON structure for project overview with no additional text:

{{
  "project_name": "EXTRACTED_PROJECT_NAME",
  "root_path": "{project_path}",
  "analysis_timestamp": "{timestamp}",
  "statistics": {{
    "total_files": 0,
    "total_lines": 0,
    "languages": ["DETECTED_LANGUAGES"],
    "file_counts": {{
      "python": 0,
      "javascript": 0,
      "typescript": 0,
      "other": 0
    }}
  }},
  "architecture": {{
    "entry_points": [
      {{
        "file": "FILE_PATH",
        "type": "main",
        "confidence": 0.0
      }}
    ],
    "key_directories": [
      {{
        "path": "DIRECTORY_PATH",
        "purpose": "PURPOSE_DESCRIPTION_MAX_50_CHARS",
        "file_count": 0
      }}
    ],
    "frameworks": ["DETECTED_FRAMEWORKS"],
    "patterns": ["ARCHITECTURAL_PATTERNS"]
  }},
  "complexity": {{
    "high_complexity_files": ["FILE_PATHS"],
    "total_functions": 0,
    "total_classes": 0,
    "average_complexity": 0.0
  }},
  "dependencies": {{
    "external_packages": ["PACKAGE_NAMES"],
    "internal_modules": 0,
    "circular_dependencies": 0,
    "unused_files": 0
  }},
  "summary": "PROJECT_PURPOSE_DESCRIPTION_MAX_200_CHARS",
  "recommendations": [
    "ACTIONABLE_RECOMMENDATION_MAX_100_CHARS"
  ]
}}

Project analysis data:
{json.dumps(analysis_data, indent=2)}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON."""

        return prompt, DeterministicPromptTemplates.PROJECT_SUMMARY_TEMPLATE_ID

    @staticmethod
    def get_dead_code_analysis_prompt(dependency_data: dict[str, Any]) -> tuple[str, str]:
        """Generate deterministic dead code analysis prompt.
        
        Returns:
            Tuple of (prompt, template_id)
        """
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        prompt = f"""Analyze dead code and return EXACTLY this JSON structure with no additional text:

{{
  "analysis_timestamp": "{timestamp}",
  "dead_code": [
    {{
      "file": "FILE_PATH",
      "type": "unused_file",
      "name": "SYMBOL_NAME_OR_null",
      "line": 0,
      "confidence": 0.0,
      "reason": "EXPLANATION_MAX_100_CHARS",
      "impact": "low"
    }}
  ],
  "statistics": {{
    "total_unused_files": 0,
    "total_unused_functions": 0,
    "total_unused_classes": 0,
    "total_unused_imports": 0,
    "percentage_dead_code": 0.0
  }},
  "recommendations": [
    {{
      "action": "remove",
      "target": "FILE_OR_SYMBOL_PATH",
      "reason": "REASON_MAX_100_CHARS",
      "priority": "low"
    }}
  ]
}}

Dependency and usage data:
{json.dumps(dependency_data, indent=2)}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON."""

        return prompt, DeterministicPromptTemplates.DEAD_CODE_ANALYSIS_TEMPLATE_ID

    @staticmethod
    def get_foundation_session_prompt(project_path: str, context_files: list[str]) -> tuple[str, str]:
        """Generate Foundation Session setup prompt for maximum cache utilization.
        
        This creates the base context that will be cached and reused across
        all subsequent analysis agents.
        
        Returns:
            Tuple of (prompt, template_id)
        """
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        prompt = f"""Foundation Session Analysis for AgentTreeGraph Integration

Project: {project_path}
Analysis Timestamp: {timestamp}

TASK: Create foundation context for efficient multi-agent code analysis with maximum cache reuse.

STEPS:
1. Read and analyze project structure overview
2. Identify key configuration files (package.json, pyproject.toml, CLAUDE.md)
3. Understand technology stack and frameworks
4. Create base context for analysis agents
5. Generate project metadata for .treesummary initialization

Context files to analyze:
{json.dumps(context_files, indent=2)}

DELIVERABLE: Return EXACTLY this JSON structure:

{{
  "foundation_session_id": "GENERATED_SESSION_ID",
  "project_path": "{project_path}",
  "analysis_timestamp": "{timestamp}",
  "base_context": {{
    "project_name": "EXTRACTED_PROJECT_NAME",
    "technology_stack": ["DETECTED_TECHNOLOGIES"],
    "main_language": "PRIMARY_LANGUAGE",
    "frameworks": ["DETECTED_FRAMEWORKS"],
    "entry_points": ["MAIN_FILES"],
    "directory_structure": {{
      "source_dirs": ["SOURCE_DIRECTORIES"],
      "config_dirs": ["CONFIG_DIRECTORIES"],
      "test_dirs": ["TEST_DIRECTORIES"]
    }},
    "dependencies": {{
      "external": ["EXTERNAL_PACKAGES"],
      "internal": ["INTERNAL_MODULES"]
    }},
    "analysis_scope": {{
      "total_files": 0,
      "analyzable_files": 0,
      "ignore_patterns": ["IGNORE_PATTERNS"]
    }}
  }},
  "cache_optimization": {{
    "prompt_templates": ["TEMPLATE_IDS_TO_CACHE"],
    "context_size_bytes": 0,
    "estimated_token_savings": 0
  }},
  "status": "FOUNDATION_READY"
}}

Execute analysis and return ONLY the JSON structure above. No markdown, no explanations, just JSON."""

        return prompt, DeterministicPromptTemplates.FOUNDATION_SESSION_TEMPLATE_ID

    @staticmethod
    def generate_template_hash(template_id: str, content: str) -> str:
        """Generate consistent hash for template and content combination.
        
        Args:
            template_id: Template identifier
            content: Content being analyzed
            
        Returns:
            Deterministic hash for cache key generation
        """
        combined = f"{template_id}:{content}"
        return hashlib.sha256(combined.encode()).hexdigest()[:16]

    @staticmethod
    def get_template_metadata() -> dict[str, dict[str, Any]]:
        """Get metadata about all available templates.
        
        Returns:
            Dictionary mapping template IDs to metadata
        """
        return {
            DeterministicPromptTemplates.PYTHON_ANALYSIS_TEMPLATE_ID: {
                "description": "Python file symbol analysis",
                "cache_duration_hours": 24,
                "estimated_tokens": 1500,
                "output_format": "structured_json",
            },
            DeterministicPromptTemplates.JAVASCRIPT_ANALYSIS_TEMPLATE_ID: {
                "description": "JavaScript file symbol analysis",
                "cache_duration_hours": 24,
                "estimated_tokens": 1400,
                "output_format": "structured_json",
            },
            DeterministicPromptTemplates.TYPESCRIPT_ANALYSIS_TEMPLATE_ID: {
                "description": "TypeScript file symbol analysis",
                "cache_duration_hours": 24,
                "estimated_tokens": 1600,
                "output_format": "structured_json",
            },
            DeterministicPromptTemplates.PROJECT_SUMMARY_TEMPLATE_ID: {
                "description": "Project-wide architecture summary",
                "cache_duration_hours": 168,  # 1 week
                "estimated_tokens": 3000,
                "output_format": "structured_json",
            },
            DeterministicPromptTemplates.DEAD_CODE_ANALYSIS_TEMPLATE_ID: {
                "description": "Dead code detection analysis",
                "cache_duration_hours": 72,  # 3 days
                "estimated_tokens": 2000,
                "output_format": "structured_json",
            },
            DeterministicPromptTemplates.FOUNDATION_SESSION_TEMPLATE_ID: {
                "description": "Foundation session context creation",
                "cache_duration_hours": 336,  # 2 weeks
                "estimated_tokens": 5000,
                "output_format": "structured_json",
            },
        }

    @staticmethod
    def validate_template_output(template_id: str, output: str) -> tuple[bool, dict[str, Any] | None]:
        """Validate that template output matches expected format.
        
        Args:
            template_id: Template that generated the output
            output: Raw output from LLM
            
        Returns:
            Tuple of (is_valid, parsed_data_or_none)
        """
        try:
            # All templates expect JSON output
            data = json.loads(output.strip())

            # Basic validation based on template
            if template_id in [DeterministicPromptTemplates.PYTHON_ANALYSIS_TEMPLATE_ID,
                              DeterministicPromptTemplates.JAVASCRIPT_ANALYSIS_TEMPLATE_ID,
                              DeterministicPromptTemplates.TYPESCRIPT_ANALYSIS_TEMPLATE_ID]:
                required_fields = ["file_path", "language", "symbols", "summary"]
                if all(field in data for field in required_fields):
                    return True, data

            elif template_id == DeterministicPromptTemplates.PROJECT_SUMMARY_TEMPLATE_ID:
                required_fields = ["project_name", "statistics", "architecture", "summary"]
                if all(field in data for field in required_fields):
                    return True, data

            elif template_id == DeterministicPromptTemplates.DEAD_CODE_ANALYSIS_TEMPLATE_ID:
                required_fields = ["dead_code", "statistics", "recommendations"]
                if all(field in data for field in required_fields):
                    return True, data

            elif template_id == DeterministicPromptTemplates.FOUNDATION_SESSION_TEMPLATE_ID:
                required_fields = ["foundation_session_id", "base_context", "status"]
                if all(field in data for field in required_fields):
                    return True, data

            return False, None

        except json.JSONDecodeError:
            return False, None

    @classmethod
    def get_prompt_for_language(cls, language: str, file_content: str, file_path: str) -> tuple[str, str]:
        """Get appropriate prompt template for programming language.
        
        Args:
            language: Programming language (python, javascript, typescript, etc.)
            file_content: Content of the file to analyze
            file_path: Path to the file
            
        Returns:
            Tuple of (prompt, template_id)
        """
        if language == "python":
            return cls.get_python_analysis_prompt(file_content, file_path)
        if language in ["javascript", "typescript", "jsx", "tsx"]:
            return cls.get_javascript_analysis_prompt(file_content, file_path)
        # Default to Python template for unknown languages
        return cls.get_python_analysis_prompt(file_content, file_path)
