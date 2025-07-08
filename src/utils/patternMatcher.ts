/**
 * Pattern matching utilities for web scraping URL filtering
 * Supports both glob patterns, regular expressions, and JSON-based language patterns
 */

import { minimatch } from 'minimatch';
import { match, P } from 'ts-pattern';

export interface PatternMatchResult {
  matches: boolean;
  pattern: string | ScrapingPattern;
  type: 'glob' | 'regex' | 'plain' | 'json';
  error?: string;
}

// JSON Pattern types for AI-friendly pattern matching
export interface StringPattern {
  startsWith?: string;
  endsWith?: string;
  contains?: string;
  equals?: string;
  regex?: string;
}

export interface NumberPattern {
  number?: true;
  range?: {
    min?: number;
    max?: number;
  };
}

export interface PathPattern {
  path_segment?: StringPattern | string;
  path_segments?: (StringPattern | string)[];
  extension?: string | string[];
  filename?: StringPattern | string;
}

export interface VersionPattern {
  version?: {
    major?: number;
    minor?: number;
    patch?: number;
    prefix?: string; // e.g., "v", "api/v"
  };
  version_range?: {
    min?: string;
    max?: string;
    prefix?: string;
  };
}

export interface LogicalPattern {
  and?: ScrapingPattern[];
  or?: ScrapingPattern[];
  not?: ScrapingPattern;
}

export interface ConditionalPattern {
  if?: ScrapingPattern;
  then?: ScrapingPattern;
  else?: ScrapingPattern;
}

export interface SequencePattern {
  followed_by?: ScrapingPattern | string;
  preceded_by?: ScrapingPattern | string;
  between?: {
    start: ScrapingPattern | string;
    end: ScrapingPattern | string;
  };
}

// Main pattern type - union of all pattern types (renamed to avoid conflict with browser URLPattern)
export type ScrapingPattern = 
  | StringPattern
  | NumberPattern
  | PathPattern
  | VersionPattern
  | LogicalPattern
  | ConditionalPattern
  | SequencePattern;

// URL components for matching
export interface URLComponents {
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname: string;
  search?: string;
  hash?: string;
  segments: string[];
  filename?: string;
  extension?: string;
  full: string;
}

export class PatternMatcher {
  /**
   * Useful pattern templates for common use cases
   */
  private static commonPatterns: Record<string, string> = {
    'assets': '**/*.{js,css,png,jpg,jpeg,gif,svg,ico,mp4,webm,pdf,woff,woff2,ttf,eot}', // Static asset files
  };

  /**
   * Parse URL into components for pattern matching
   */
  private static parseURL(url: string): URLComponents {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';
      const lastDot = lastSegment.lastIndexOf('.');
      
      return {
        protocol: parsed.protocol.replace(':', ''),
        hostname: parsed.hostname,
        port: parsed.port,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
        segments,
        filename: lastDot > 0 ? lastSegment.substring(0, lastDot) : lastSegment,
        extension: lastDot > 0 ? lastSegment.substring(lastDot + 1) : undefined,
        full: url
      };
    } catch (error) {
      // If URL parsing fails, treat as path-only
      const segments = url.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';
      const lastDot = lastSegment.lastIndexOf('.');
      
      return {
        pathname: url,
        segments,
        filename: lastDot > 0 ? lastSegment.substring(0, lastDot) : lastSegment,
        extension: lastDot > 0 ? lastSegment.substring(lastDot + 1) : undefined,
        full: url
      };
    }
  }

  /**
   * Expand common pattern if it matches a template
   */
  private static expandCommonPattern(pattern: string): string {
    // Check if it's a common pattern (starts with @)
    if (pattern.startsWith('@')) {
      const templateName = pattern.slice(1);
      return this.commonPatterns[templateName] || pattern;
    }
    return pattern;
  }

  /**
   * Validate if a pattern is a valid glob, regex or plain pattern
   */
  static validatePattern(pattern: string): { 
    valid: boolean; 
    type: 'glob' | 'regex' | 'plain'; 
    error?: string; 
  } {
    // First expand common patterns (@assets, etc.)
    const expandedPattern = this.expandCommonPattern(pattern);
    
    // 1. Check if it's a glob pattern (contains glob characters)  
    if (expandedPattern.includes('*') || expandedPattern.includes('?') || expandedPattern.includes('[') || expandedPattern.includes('{')) {
      try {
        // Test the glob pattern with a dummy string
        minimatch('test', expandedPattern);
        return { valid: true, type: 'glob' };
      } catch (error) {
        return { 
          valid: false, 
          type: 'glob', 
          error: `Invalid glob pattern: ${error instanceof Error ? error.message : 'Unknown error'}` 
        };
      }
    }

    // 2. Check if it's a regex pattern (enclosed in forward slashes)
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      try {
        new RegExp(pattern.slice(1, -1));
        return { valid: true, type: 'regex' };
      } catch (error) {
        return { 
          valid: false, 
          type: 'regex', 
          error: `Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}` 
        };
      }
    }

    // 3. Otherwise treat as plain string
    return { valid: true, type: 'plain' };
  }

  /**
   * Test if a URL matches any of the given patterns
   */
  static matchesAny(url: string, patterns: (string | ScrapingPattern)[]): PatternMatchResult[] {
    return patterns.map(pattern => this.matchesPattern(url, pattern));
  }

  /**
   * Test if a URL matches a specific pattern (string or JSON)
   */
  static matchesPattern(url: string, pattern: string | ScrapingPattern): PatternMatchResult {
    // Handle JSON patterns
    if (typeof pattern === 'object') {
      return this.matchesJSONPattern(url, pattern);
    }
    
    // Handle string patterns
    const validation = this.validatePattern(pattern);
    
    if (!validation.valid) {
      return {
        matches: false,
        pattern,
        type: validation.type,
        error: validation.error
      };
    }

    try {
      let matches = false;

      switch (validation.type) {
        case 'regex':
          const regexPattern = new RegExp(pattern.slice(1, -1));
          matches = regexPattern.test(url);
          break;
        
        case 'glob':
          matches = minimatch(url, pattern);
          break;
        
        case 'plain':
          matches = url.includes(pattern);
          break;
      }

      return {
        matches,
        pattern,
        type: validation.type
      };
    } catch (error) {
      return {
        matches: false,
        pattern,
        type: validation.type,
        error: error instanceof Error ? error.message : 'Pattern matching failed'
      };
    }
  }

  /**
   * Check if a URL should be allowed based on allow/ignore patterns
   * Supports both string patterns (legacy) and JSON patterns (new)
   */
  static shouldAllowUrl(
    url: string, 
    allowPatterns: (string | ScrapingPattern)[] = [], 
    ignorePatterns: (string | ScrapingPattern)[] = []
  ): {
    allowed: boolean;
    reason: string;
    matchedPattern?: string | ScrapingPattern;
    patternType?: 'allow' | 'ignore';
  } {
    // Check ignore patterns first (they take precedence)
    if (ignorePatterns.length > 0) {
      const ignoreResults = this.matchesAny(url, ignorePatterns);
      const ignoredBy = ignoreResults.find(result => result.matches);
      
      if (ignoredBy) {
        return {
          allowed: false,
          reason: `URL blocked by ignore pattern: ${typeof ignoredBy.pattern === 'string' ? ignoredBy.pattern : JSON.stringify(ignoredBy.pattern)} (${ignoredBy.type})`,
          matchedPattern: ignoredBy.pattern,
          patternType: 'ignore'
        };
      }
    }

    // If no allow patterns specified, allow by default
    if (allowPatterns.length === 0) {
      return {
        allowed: true,
        reason: 'No allow patterns specified, allowing by default'
      };
    }

    // Check allow patterns
    const allowResults = this.matchesAny(url, allowPatterns);
    const allowedBy = allowResults.find(result => result.matches);
    
    if (allowedBy) {
      return {
        allowed: true,
        reason: `URL allowed by pattern: ${typeof allowedBy.pattern === 'string' ? allowedBy.pattern : JSON.stringify(allowedBy.pattern)} (${allowedBy.type})`,
        matchedPattern: allowedBy.pattern,
        patternType: 'allow'
      };
    }

    return {
      allowed: false,
      reason: 'URL does not match any allow patterns',
    };
  }

  /**
   * Convert string patterns to JSON patterns for easier migration
   */
  static convertStringToJSONPattern(pattern: string): ScrapingPattern {
    return this.convertStringToPattern(pattern);
  }

  /**
   * Test if a URL matches a JSON pattern
   */
  static matchesJSONPattern(url: string, pattern: ScrapingPattern): PatternMatchResult {
    try {
      const components = this.parseURL(url);
      
      const matches = match(pattern)
        .with({ and: P.select() }, (andPatterns) => 
          andPatterns.every(p => this.matchesPattern(url, p).matches)
        )
        .with({ or: P.select() }, (orPatterns) => 
          orPatterns.some(p => this.matchesPattern(url, p).matches)
        )
        .with({ not: P.select() }, (notPattern) => 
          !this.matchesPattern(url, notPattern).matches
        )
        .with({ if: P.select() }, (ifPattern) => {
          const conditionResult = this.matchesPattern(url, ifPattern);
          if (conditionResult.matches && 'then' in pattern && pattern.then) {
            return this.matchesPattern(url, pattern.then).matches;
          }
          if (!conditionResult.matches && 'else' in pattern && pattern.else) {
            return this.matchesPattern(url, pattern.else).matches;
          }
          return conditionResult.matches;
        })
        .when(
          (p): p is StringPattern => 
            'startsWith' in p || 'endsWith' in p || 'contains' in p || 'equals' in p || 'regex' in p,
          (p) => this.matchesStringPattern(url, p)
        )
        .when(
          (p): p is NumberPattern => 
            'number' in p || 'range' in p,
          (p) => this.matchesNumberPattern(url, p)
        )
        .when(
          (p): p is PathPattern => 
            'path_segment' in p || 'path_segments' in p || 'extension' in p || 'filename' in p,
          (p) => this.matchesPathPattern(components, p)
        )
        .when(
          (p): p is VersionPattern => 
            'version' in p || 'version_range' in p,
          (p) => this.matchesVersionPattern(components, p)
        )
        .when(
          (p): p is SequencePattern => 
            'followed_by' in p || 'preceded_by' in p || 'between' in p,
          (p) => this.matchesSequencePattern(components, p)
        )
        .otherwise(() => false);

      return {
        matches,
        pattern,
        type: 'json',
        error: undefined
      };
    } catch (error) {
      return {
        matches: false,
        pattern,
        type: 'json',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Convert simple string patterns to ScrapingPattern objects for easier migration
   */
  static convertStringToPattern(pattern: string): ScrapingPattern {
    // Handle regex patterns (enclosed in forward slashes)
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      return { regex: pattern.slice(1, -1) };
    }

    // Handle glob patterns
    if (pattern.includes('*')) {
      // Convert glob to regex
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/\./g, '\\.')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\+/g, '\\+')
        .replace(/\^/g, '\\^')
        .replace(/\$/g, '\\$');
      
      return { regex: regexPattern };
    }

    // Handle simple string patterns
    if (pattern.startsWith('*')) {
      return { endsWith: pattern.slice(1) };
    }
    if (pattern.endsWith('*')) {
      return { startsWith: pattern.slice(0, -1) };
    }

    // Default to contains
    return { contains: pattern };
  }

  /**
   * Check if a string matches a StringPattern
   */
  private static matchesStringPattern(text: string, pattern: StringPattern): boolean {
    return match(pattern)
      .with({ startsWith: P.string }, ({ startsWith }) => text.startsWith(startsWith))
      .with({ endsWith: P.string }, ({ endsWith }) => text.endsWith(endsWith))
      .with({ contains: P.string }, ({ contains }) => text.includes(contains))
      .with({ equals: P.string }, ({ equals }) => text === equals)
      .with({ regex: P.string }, ({ regex }) => {
        try {
          return new RegExp(regex).test(text);
        } catch {
          return false;
        }
      })
      .otherwise(() => false);
  }

  /**
   * Check if a string represents a number and matches NumberPattern
   */
  private static matchesNumberPattern(text: string, pattern: NumberPattern): boolean {
    const num = parseFloat(text);
    if (isNaN(num)) return false;

    return match(pattern)
      .with({ number: true }, () => true)
      .with({ range: P.select() }, (range: { min?: number; max?: number }) => {
        const { min = -Infinity, max = Infinity } = range;
        return num >= min && num <= max;
      })
      .otherwise(() => false);
  }

  /**
   * Check if URL components match a PathPattern
   */
  private static matchesPathPattern(components: URLComponents, pattern: PathPattern): boolean {
    return match(pattern)
      .with({ path_segment: P.select() }, (segment) => {
        if (typeof segment === 'string') {
          return components.segments.includes(segment);
        }
        return components.segments.some(s => this.matchesStringPattern(s, segment));
      })
      .with({ path_segments: P.select() }, (segments) => {
        return segments.every(segment => {
          if (typeof segment === 'string') {
            return components.segments.includes(segment);
          }
          return components.segments.some(s => this.matchesStringPattern(s, segment));
        });
      })
      .with({ extension: P.select() }, (ext) => {
        if (!components.extension) return false;
        if (typeof ext === 'string') {
          return components.extension === ext;
        }
        return ext.includes(components.extension);
      })
      .with({ filename: P.select() }, (filename) => {
        if (!components.filename) return false;
        if (typeof filename === 'string') {
          return components.filename === filename;
        }
        return this.matchesStringPattern(components.filename, filename);
      })
      .otherwise(() => false);
  }

  /**
   * Check if URL components match a VersionPattern
   */
  private static matchesVersionPattern(components: URLComponents, pattern: VersionPattern): boolean {
    return match(pattern)
      .with({ version: P.select() }, (version: { prefix?: string; major?: number; minor?: number; patch?: number }) => {
        const { prefix = 'v', major, minor, patch } = version;
        
        // Find segments that start with the version prefix
        const versionSegments = components.segments.filter(s => s.startsWith(prefix));
        
        return versionSegments.some(segment => {
          const versionPart = segment.substring(prefix.length);
          const versionMatch = versionPart.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
          
          if (!versionMatch) return false;
          
          const [, majorStr, minorStr, patchStr] = versionMatch;
          const actualMajor = parseInt(majorStr);
          const actualMinor = parseInt(minorStr || '0');
          const actualPatch = parseInt(patchStr || '0');
          
          if (major !== undefined && actualMajor !== major) return false;
          if (minor !== undefined && actualMinor !== minor) return false;
          if (patch !== undefined && actualPatch !== patch) return false;
          
          return true;
        });
      })
      .with({ version_range: P.select() }, (range: { prefix?: string; min?: string; max?: string }) => {
        const { prefix = 'v', min, max } = range;
        
        const versionSegments = components.segments.filter(s => s.startsWith(prefix));
        
        return versionSegments.some(segment => {
          const versionPart = segment.substring(prefix.length);
          const versionMatch = versionPart.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
          
          if (!versionMatch) return false;
          
          const version = versionMatch[0];
          
          if (min && this.compareVersions(version, min) < 0) return false;
          if (max && this.compareVersions(version, max) > 0) return false;
          
          return true;
        });
      })
      .otherwise(() => false);
  }

  /**
   * Compare two semantic version strings
   */
  private static compareVersions(a: string, b: string): number {
    const parseVersion = (v: string) => v.split('.').map(n => parseInt(n) || 0);
    const [aMajor, aMinor, aPatch] = parseVersion(a);
    const [bMajor, bMinor, bPatch] = parseVersion(b);
    
    if (aMajor !== bMajor) return aMajor - bMajor;
    if (aMinor !== bMinor) return aMinor - bMinor;
    return aPatch - bPatch;
  }

  /**
   * Check if URL components match a SequencePattern
   */
  private static matchesSequencePattern(components: URLComponents, pattern: SequencePattern): boolean {
    return match(pattern)
      .with({ followed_by: P.select() }, (followedBy) => {
        // This is a simplified implementation
        // In practice, you'd need to implement position-aware matching
        if (typeof followedBy === 'string') {
          return components.full.includes(followedBy);
        }
        return this.matchesPattern(components.full, followedBy).matches;
      })
      .with({ preceded_by: P.select() }, (precededBy) => {
        if (typeof precededBy === 'string') {
          return components.full.includes(precededBy);
        }
        return this.matchesPattern(components.full, precededBy).matches;
      })
      .with({ between: P.select() }, (between) => {
        const { start, end } = between;
        const startStr = typeof start === 'string' ? start : components.full;
        const endStr = typeof end === 'string' ? end : components.full;
        
        const startIdx = components.full.indexOf(startStr);
        const endIdx = components.full.indexOf(endStr);
        
        return startIdx !== -1 && endIdx !== -1 && startIdx < endIdx;
      })
      .otherwise(() => false);
  }

  /**
   * Generate documentation for pattern syntax
   */
  static getPatternDocumentation(): string {
    return `
Pattern Syntax Guide:

LEGACY STRING PATTERNS (still supported):
- GLOB PATTERNS: Use * for any characters: "*/docs/*" matches URLs containing /docs/
- REGEX PATTERNS: Enclose in forward slashes: "/api\/v[0-9]+\/.*"/
- PLAIN STRING: Simple substring matching: "documentation"

NEW JSON PATTERNS (recommended for AI):
STRING PATTERNS:
- {"startsWith": "https://docs"} - URL starts with "https://docs"
- {"endsWith": ".pdf"} - URL ends with ".pdf"
- {"contains": "/api/"} - URL contains "/api/"
- {"equals": "exact-match"} - URL exactly matches "exact-match"
- {"regex": "api\/v[0-9]+\/.*"} - URL matches regex pattern

PATH PATTERNS:
- {"path_segment": "docs"} - URL has a path segment "docs"
- {"path_segment": {"startsWith": "v"}} - URL has a path segment starting with "v"
- {"path_segments": ["docs", "api"]} - URL has both "docs" and "api" segments
- {"extension": "html"} - URL has .html extension
- {"extension": ["html", "htm"]} - URL has .html or .htm extension
- {"filename": "index"} - URL filename is "index"

VERSION PATTERNS:
- {"version": {"prefix": "v", "major": 1}} - URL has version v1.x.x
- {"version": {"prefix": "api/v"}} - URL has version with prefix "api/v"
- {"version_range": {"min": "1.0", "max": "2.0"}} - URL has version between 1.0 and 2.0

LOGICAL PATTERNS:
- {"and": [pattern1, pattern2]} - URL matches both patterns
- {"or": [pattern1, pattern2]} - URL matches either pattern
- {"not": pattern} - URL does not match pattern

COMPLEX EXAMPLES:
Block version URLs:
{
  "or": [
    {"path_segment": {"regex": "^v\\d+"}},
    {"version": {"prefix": "v"}},
    {"contains": "/docs/v", "followed_by": {"regex": "[0-9]+"}}
  ]
}

Allow only docs, block assets:
{
  "and": [
    {"path_segment": "docs"},
    {"not": {"extension": ["js", "css", "png", "jpg", "gif", "svg", "ico"]}}
  ]
}

MIGRATION EXAMPLES:
String Pattern → JSON Pattern:
- "*/docs/*" → {"path_segment": "docs"}
- "*.pdf" → {"extension": "pdf"}
- "/api\/v[0-9]+\/.*" → {"version": {"prefix": "api/v"}}
- "private" → {"contains": "private"}
- "**/v1/**" → {"version": {"prefix": "v", "major": 1}}
`;
  }
}