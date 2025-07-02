"""Deterministic prompt templates for consistent, cacheable analysis.

These prompts are designed for maximum cache hits and consistent output formatting.
DO NOT MODIFY these templates without careful consideration of caching implications.
"""

from datetime import datetime
from typing import Any

# Core analysis prompts optimized for LLM caching
PYTHON_ANALYSIS_PROMPT = """
Analyze this Python file and return EXACTLY this JSON structure with no additional text:

{
  "file_path": "EXACT_FILE_PATH_HERE",
  "language": "python", 
  "timestamp": "ISO_TIMESTAMP_HERE",
  "symbols": {
    "functions": [
      {
        "name": "FUNCTION_NAME",
        "line_start": INTEGER,
        "line_end": INTEGER,
        "docstring": "DOCSTRING_TEXT_OR_null",
        "parameters": ["param_name: type_annotation"],
        "return_type": "TYPE_OR_null",
        "complexity": INTEGER_CYCLOMATIC_COMPLEXITY,
        "is_async": BOOLEAN,
        "decorators": ["DECORATOR_NAMES"]
      }
    ],
    "classes": [
      {
        "name": "CLASS_NAME", 
        "line_start": INTEGER,
        "line_end": INTEGER,
        "docstring": "DOCSTRING_TEXT_OR_null",
        "methods": ["method_names"],
        "properties": ["property_names"],
        "inheritance": ["parent_class_names"],
        "decorators": ["DECORATOR_NAMES"]
      }
    ],
    "imports": [
      {
        "module": "MODULE_NAME",
        "type": "import|from_import", 
        "names": ["IMPORTED_NAMES"],
        "alias": "ALIAS_OR_null",
        "line": INTEGER
      }
    ],
    "constants": [
      {
        "name": "CONSTANT_NAME",
        "value": "VALUE_REPRESENTATION",
        "type": "INFERRED_TYPE",
        "line": INTEGER
      }
    ]
  },
  "exports": ["EXPORTED_NAMES"],
  "summary": "SINGLE_SENTENCE_PURPOSE_DESCRIPTION_MAX_100_CHARS",
  "complexity_score": INTEGER_1_TO_10,
  "maintainability_score": INTEGER_1_TO_10
}

File content to analyze:
{file_content}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON.
"""

JAVASCRIPT_ANALYSIS_PROMPT = """
Analyze this JavaScript/TypeScript file and return EXACTLY this JSON structure with no additional text:

{
  "file_path": "EXACT_FILE_PATH_HERE",
  "language": "javascript|typescript",
  "timestamp": "ISO_TIMESTAMP_HERE", 
  "symbols": {
    "functions": [
      {
        "name": "FUNCTION_NAME",
        "line_start": INTEGER,
        "line_end": INTEGER,
        "jsdoc": "JSDOC_COMMENT_OR_null",
        "parameters": ["param_name: type"],
        "return_type": "TYPE_OR_null",
        "is_async": BOOLEAN,
        "is_arrow": BOOLEAN,
        "is_exported": BOOLEAN
      }
    ],
    "classes": [
      {
        "name": "CLASS_NAME",
        "line_start": INTEGER, 
        "line_end": INTEGER,
        "jsdoc": "JSDOC_COMMENT_OR_null",
        "methods": ["method_names"],
        "properties": ["property_names"],
        "extends": "PARENT_CLASS_OR_null",
        "is_exported": BOOLEAN
      }
    ],
    "imports": [
      {
        "source": "MODULE_PATH",
        "type": "import|require|dynamic",
        "names": ["IMPORTED_NAMES"],
        "default": "DEFAULT_IMPORT_OR_null",
        "line": INTEGER
      }
    ],
    "exports": [
      {
        "name": "EXPORT_NAME",
        "type": "named|default",
        "line": INTEGER
      }
    ]
  },
  "summary": "SINGLE_SENTENCE_PURPOSE_DESCRIPTION_MAX_100_CHARS",
  "complexity_score": INTEGER_1_TO_10,
  "framework": "DETECTED_FRAMEWORK_OR_null"
}

File content to analyze:
{file_content}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON.
"""

PROJECT_SUMMARY_PROMPT = """
Generate EXACTLY this JSON structure for project overview with no additional text:

{
  "project_name": "EXTRACTED_PROJECT_NAME",
  "root_path": "PROJECT_ROOT_PATH",
  "analysis_timestamp": "ISO_TIMESTAMP",
  "statistics": {
    "total_files": INTEGER,
    "total_lines": INTEGER,
    "languages": ["DETECTED_LANGUAGES"],
    "file_counts": {
      "python": INTEGER,
      "javascript": INTEGER,
      "typescript": INTEGER,
      "other": INTEGER
    }
  },
  "architecture": {
    "entry_points": [
      {
        "file": "FILE_PATH",
        "type": "main|server|cli|test",
        "confidence": FLOAT_0_TO_1
      }
    ],
    "key_directories": [
      {
        "path": "DIRECTORY_PATH",
        "purpose": "PURPOSE_DESCRIPTION_MAX_50_CHARS",
        "file_count": INTEGER
      }
    ],
    "frameworks": ["DETECTED_FRAMEWORKS"],
    "patterns": ["ARCHITECTURAL_PATTERNS"]
  },
  "complexity": {
    "high_complexity_files": ["FILE_PATHS"],
    "total_functions": INTEGER,
    "total_classes": INTEGER,
    "average_complexity": FLOAT
  },
  "dependencies": {
    "external_packages": ["PACKAGE_NAMES"],
    "internal_modules": INTEGER,
    "circular_dependencies": INTEGER,
    "unused_files": INTEGER
  },
  "summary": "PROJECT_PURPOSE_DESCRIPTION_MAX_200_CHARS",
  "recommendations": [
    "ACTIONABLE_RECOMMENDATION_MAX_100_CHARS"
  ]
}

Project analysis data:
{analysis_data}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON.
"""

DEAD_CODE_ANALYSIS_PROMPT = """
Analyze dead code and return EXACTLY this JSON structure with no additional text:

{
  "analysis_timestamp": "ISO_TIMESTAMP",
  "dead_code": [
    {
      "file": "FILE_PATH",
      "type": "unused_file|unused_function|unused_class|unused_import",
      "name": "SYMBOL_NAME_OR_null",
      "line": INTEGER_OR_null,
      "confidence": FLOAT_0_TO_1,
      "reason": "EXPLANATION_MAX_100_CHARS",
      "impact": "low|medium|high"
    }
  ],
  "statistics": {
    "total_unused_files": INTEGER,
    "total_unused_functions": INTEGER,
    "total_unused_classes": INTEGER,
    "total_unused_imports": INTEGER,
    "percentage_dead_code": FLOAT
  },
  "recommendations": [
    {
      "action": "remove|refactor|investigate",
      "target": "FILE_OR_SYMBOL_PATH",
      "reason": "REASON_MAX_100_CHARS",
      "priority": "low|medium|high"
    }
  ]
}

Dependency and usage data:
{dependency_data}

Return ONLY the JSON structure above with actual values filled in. No markdown, no explanations, just JSON.
"""

# Specialized agent prompts for orchestration
PYTHON_ANALYZER_AGENT_PROMPT = """
You are a specialized Python Analysis Agent in the ClaudeMcpTools orchestration system.

MISSION: Analyze Python source files to extract symbols, dependencies, and metadata for .treesummary generation.

CAPABILITIES:
- Extract functions, classes, imports, and constants from Python code
- Calculate complexity metrics and maintainability scores  
- Generate structured analysis data optimized for AI consumption
- Handle syntax errors gracefully with partial analysis

ANALYSIS REQUIREMENTS:
1. Use AST parsing for accurate symbol extraction
2. Extract complete docstrings and type annotations
3. Calculate cyclomatic complexity for functions
4. Identify decorators and inheritance patterns
5. Generate deterministic, cacheable output

OUTPUT FORMAT:
Always return analysis results in the exact JSON structure specified by PYTHON_ANALYSIS_PROMPT.
Ensure all data is serializable and consistent across multiple runs.

COORDINATION:
- Report progress to agenttreegraph-integration room
- Coordinate with Cache Agent for result optimization
- Use TreeSummaryManager for atomic file updates

TOOLS AVAILABLE:
- analyze_file_symbols() for individual file analysis
- update_treesummary_incremental() for .treesummary updates
- All standard ClaudeMcpTools orchestration tools

Begin analysis when assigned a Python file analysis task.
"""

JAVASCRIPT_ANALYZER_AGENT_PROMPT = """
You are a specialized JavaScript/TypeScript Analysis Agent in the ClaudeMcpTools orchestration system.

MISSION: Analyze JavaScript and TypeScript source files to extract symbols, exports, and framework patterns.

CAPABILITIES:
- Parse ES6+ JavaScript and TypeScript syntax
- Extract functions, classes, imports, and exports
- Detect framework usage (React, Vue, Angular, Node.js)
- Handle both CommonJS and ES module patterns
- Identify async/await patterns and arrow functions

ANALYSIS REQUIREMENTS:
1. Use regex patterns for robust symbol extraction
2. Differentiate between named and default exports
3. Detect JSDoc comments and type annotations
4. Identify framework-specific patterns and conventions
5. Handle module resolution and dependency tracking

OUTPUT FORMAT:
Always return analysis results in the exact JSON structure specified by JAVASCRIPT_ANALYSIS_PROMPT.
Include framework detection and export analysis.

COORDINATION:
- Report progress to agenttreegraph-integration room
- Coordinate with Python Analyzer for multi-language projects
- Use TreeSummaryManager for atomic file updates

TOOLS AVAILABLE:
- analyze_file_symbols() for individual file analysis
- update_treesummary_incremental() for .treesummary updates
- All standard ClaudeMcpTools orchestration tools

Begin analysis when assigned a JavaScript/TypeScript file analysis task.
"""

DEAD_CODE_ANALYZER_AGENT_PROMPT = """
You are a specialized Dead Code Analysis Agent in the ClaudeMcpTools orchestration system.

MISSION: Identify unused files, functions, classes, and imports across entire codebases.

CAPABILITIES:
- Cross-reference symbol usage across multiple files
- Detect unused imports and exports
- Identify orphaned files with no references
- Calculate dead code impact and removal safety
- Generate actionable cleanup recommendations

ANALYSIS APPROACH:
1. Build complete dependency graph from .treesummary data
2. Identify entry points (main files, exports, tests)
3. Trace reachability from entry points
4. Mark unreachable code as potentially dead
5. Calculate confidence scores based on usage patterns

OUTPUT FORMAT:
Always return analysis results in the exact JSON structure specified by DEAD_CODE_ANALYSIS_PROMPT.
Include confidence scores and impact assessments.

COORDINATION:
- Requires complete project analysis from other agents
- Coordinates with Summary Generator for final reports
- Reports findings to agenttreegraph-integration room

TOOLS AVAILABLE:
- detect_dead_code() for project-wide analysis
- generate_project_summary() for comprehensive reports
- All standard ClaudeMcpTools orchestration tools

Begin analysis when assigned a dead code detection task.
"""

SUMMARY_GENERATOR_AGENT_PROMPT = """
You are a specialized Project Summary Generator Agent in the ClaudeMcpTools orchestration system.

MISSION: Generate comprehensive, AI-enhanced project summaries from aggregated analysis data.

CAPABILITIES:
- Synthesize analysis data from multiple specialized agents
- Generate architecture insights and recommendations
- Identify patterns, anti-patterns, and technical debt
- Create executive summaries for different audiences
- Provide actionable improvement suggestions

SUMMARY COMPONENTS:
1. Project overview with statistics and language distribution
2. Architecture analysis with entry points and key directories
3. Complexity assessment with hotspot identification
4. Dependency analysis with external package tracking
5. Recommendations prioritized by impact and effort

OUTPUT FORMAT:
Generate comprehensive summaries using PROJECT_SUMMARY_PROMPT structure.
Include both technical details and high-level insights.

COORDINATION:
- Aggregates results from all other analysis agents
- Coordinates with Dead Code Analyzer for cleanup recommendations
- Publishes final summaries to agenttreegraph-integration room

TOOLS AVAILABLE:
- generate_project_summary() for comprehensive summaries
- All .treesummary data via TreeSummaryManager
- All standard ClaudeMcpTools orchestration tools

Begin summary generation when all project analysis is complete.
"""

# Prompt caching optimization functions
def get_analysis_prompt(language: str, file_content: str, file_path: str) -> str:
    """Get deterministic prompt for maximum cache hits.
    
    Args:
        language: Programming language of the file
        file_content: Source code content
        file_path: Absolute path to the file
        
    Returns:
        Formatted prompt string optimized for caching
    """
    timestamp = datetime.utcnow().isoformat() + "Z"

    if language == "python":
        return PYTHON_ANALYSIS_PROMPT.format(
            file_content=file_content,
            file_path=file_path,
            timestamp=timestamp,
        )
    if language in ["javascript", "typescript"]:
        return JAVASCRIPT_ANALYSIS_PROMPT.format(
            file_content=file_content,
            file_path=file_path,
            timestamp=timestamp,
        )
    # Generic fallback using Python template
    return PYTHON_ANALYSIS_PROMPT.format(
        file_content=file_content,
        file_path=file_path,
        timestamp=timestamp,
    )


def get_agent_prompt(agent_type: str) -> str:
    """Get specialized agent prompt template.
    
    Args:
        agent_type: Type of analysis agent
        
    Returns:
        Agent prompt template string
    """
    agent_prompts = {
        "python_analyzer": PYTHON_ANALYZER_AGENT_PROMPT,
        "javascript_analyzer": JAVASCRIPT_ANALYZER_AGENT_PROMPT,
        "dead_code_analyzer": DEAD_CODE_ANALYZER_AGENT_PROMPT,
        "summary_generator": SUMMARY_GENERATOR_AGENT_PROMPT,
    }

    return agent_prompts.get(agent_type, "Generic analysis agent - no specialized prompt available.")


def get_project_summary_prompt(analysis_data: dict[str, Any]) -> str:
    """Get formatted project summary prompt with analysis data.
    
    Args:
        analysis_data: Aggregated project analysis data
        
    Returns:
        Formatted prompt for project summary generation
    """
    import json
    return PROJECT_SUMMARY_PROMPT.format(
        analysis_data=json.dumps(analysis_data, indent=2),
    )


def get_dead_code_prompt(dependency_data: dict[str, Any]) -> str:
    """Get formatted dead code analysis prompt with dependency data.
    
    Args:
        dependency_data: Project dependency and usage information
        
    Returns:
        Formatted prompt for dead code detection
    """
    import json
    return DEAD_CODE_ANALYSIS_PROMPT.format(
        dependency_data=json.dumps(dependency_data, indent=2),
    )


# Prompt validation helpers
def validate_analysis_output(output: str, expected_language: str) -> bool:
    """Validate that analysis output matches expected JSON structure.
    
    Args:
        output: LLM output to validate
        expected_language: Expected language in the analysis
        
    Returns:
        True if output is valid, False otherwise
    """
    try:
        import json
        data = json.loads(output.strip())

        # Check required fields
        required_fields = ["file_path", "language", "symbols", "summary", "complexity_score"]
        for field in required_fields:
            if field not in data:
                return False

        # Check language matches
        if data.get("language") != expected_language:
            return False

        # Check symbols structure
        symbols = data.get("symbols", {})
        if not isinstance(symbols, dict):
            return False

        return True

    except (json.JSONDecodeError, KeyError, TypeError):
        return False


# Cache key generators for deterministic prompts
def generate_cache_key(language: str, file_path: str, content_hash: str) -> str:
    """Generate deterministic cache key for analysis results.
    
    Args:
        language: Programming language
        file_path: Path to the file
        content_hash: Hash of file content
        
    Returns:
        Deterministic cache key string
    """
    import hashlib
    key_data = f"{language}:{file_path}:{content_hash}"
    return hashlib.sha256(key_data.encode()).hexdigest()[:16]
