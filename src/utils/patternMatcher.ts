/**
 * Pattern matching utilities for web scraping URL filtering
 * Supports both glob patterns and regular expressions
 */

import { minimatch } from 'minimatch';

export interface PatternMatchResult {
  matches: boolean;
  pattern: string;
  type: 'glob' | 'regex' | 'plain';
  error?: string;
}

export class PatternMatcher {
  /**
   * Validate if a pattern is a valid glob or regex pattern
   */
  static validatePattern(pattern: string): { 
    valid: boolean; 
    type: 'glob' | 'regex' | 'plain'; 
    error?: string; 
  } {
    // Check if it's a regex pattern (enclosed in forward slashes)
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

    // Check if it's a glob pattern (contains glob characters)
    if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[') || pattern.includes('{')) {
      try {
        // Test the glob pattern with a dummy string
        minimatch('test', pattern);
        return { valid: true, type: 'glob' };
      } catch (error) {
        return { 
          valid: false, 
          type: 'glob', 
          error: `Invalid glob pattern: ${error instanceof Error ? error.message : 'Unknown error'}` 
        };
      }
    }

    // Otherwise treat as plain string
    return { valid: true, type: 'plain' };
  }

  /**
   * Test if a URL matches any of the given patterns
   */
  static matchesAny(url: string, patterns: string[]): PatternMatchResult[] {
    return patterns.map(pattern => this.matchesPattern(url, pattern));
  }

  /**
   * Test if a URL matches a specific pattern
   */
  static matchesPattern(url: string, pattern: string): PatternMatchResult {
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
   */
  static shouldAllowUrl(
    url: string, 
    allowPatterns: string[] = [], 
    ignorePatterns: string[] = []
  ): {
    allowed: boolean;
    reason: string;
    matchedPattern?: string;
    patternType?: 'allow' | 'ignore';
  } {
    // Check ignore patterns first (they take precedence)
    const ignoreResults = this.matchesAny(url, ignorePatterns);
    const ignoredBy = ignoreResults.find(result => result.matches);
    
    if (ignoredBy) {
      return {
        allowed: false,
        reason: `URL blocked by ignore pattern: ${ignoredBy.pattern} (${ignoredBy.type})`,
        matchedPattern: ignoredBy.pattern,
        patternType: 'ignore'
      };
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
        reason: `URL allowed by pattern: ${allowedBy.pattern} (${allowedBy.type})`,
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
   * Generate documentation for pattern syntax
   */
  static getPatternDocumentation(): string {
    return `
Pattern Syntax Guide:

GLOB PATTERNS (recommended):
- Use * for any characters: "*/docs/*" matches URLs containing /docs/
- Use ? for single character: "page?.html" matches page1.html, page2.html
- Use [abc] for character sets: "page[123].html" matches page1.html, page2.html, page3.html
- Use {a,b,c} for alternatives: "*.{html,htm}" matches any .html or .htm file

REGEX PATTERNS:
- Enclose in forward slashes: "/api\\/v[0-9]+\\/.*/"
- Full JavaScript regex syntax supported
- More powerful but harder to read

PLAIN STRING PATTERNS:
- Simple substring matching: "documentation" matches any URL containing "documentation"
- Case-sensitive matching

EXAMPLES:
Allow patterns:
- "*/docs/*" - Allow any URL with /docs/ in the path
- "*.html" - Allow any HTML file
- "/api\\/v[0-9]+\\/.*/" - Allow versioned API URLs (regex)
- "documentation" - Allow URLs containing "documentation"

Ignore patterns:
- "*/private/*" - Ignore private sections
- "*.pdf" - Ignore PDF files
- "/login|admin|auth/" - Ignore auth-related pages (regex)
- "example.com" - Ignore any URL containing "example.com"
`;
  }
}