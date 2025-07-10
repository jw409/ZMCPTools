/**
 * Scraping Parameter Optimizer
 * Uses MCP sampling to analyze target URLs and suggest optimized scraping parameters
 */

import type { ScrapingPattern } from './patternMatcher.js';

export interface ScrapingOptimizationRequest {
  url: string;
  name?: string;
  sourceType?: 'api' | 'guide' | 'reference' | 'tutorial';
  userProvidedParams?: {
    maxPages?: number;
    selectors?: string;
    allowPatterns?: (string | ScrapingPattern)[];
    ignorePatterns?: (string | ScrapingPattern)[];
    includeSubdomains?: boolean;
  };
}

export interface OptimizedScrapingParameters {
  maxPages: number;
  selectors?: string;
  allowPatterns: (string | ScrapingPattern)[];
  ignorePatterns: (string | ScrapingPattern)[];
  includeSubdomains: boolean;
  confidence: number; // 0-1 scale of how confident we are in the optimization
  reasoning: string; // Why these parameters were chosen
}

export class ScrapingOptimizer {
  private workingDirectory: string;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  /**
   * Optimize scraping parameters using MCP sampling
   */
  async optimizeParameters(
    request: ScrapingOptimizationRequest, 
    timeoutMs: number = 30000
  ): Promise<OptimizedScrapingParameters> {
    try {
      // Build the sampling request
      const samplingRequest = this.buildSamplingRequest(request);
      
      // Try to make a sampling request to MCP
      const result = await this.makeSamplingRequest(samplingRequest, timeoutMs);
      
      // Validate and return the result
      if (this.validateOptimizationResult(result)) {
        return result;
      } else {
        throw new Error('Invalid optimization result structure');
      }
    } catch (error) {
      throw new Error(`Scraping optimization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build MCP sampling request
   */
  private buildSamplingRequest(request: ScrapingOptimizationRequest): any {
    const domain = new URL(request.url).hostname;
    const path = new URL(request.url).pathname;
    
    const prompt = `You are a web scraping expert. Analyze this documentation scraping request and suggest optimized parameters.

**Target URL:** ${request.url}
**Domain:** ${domain}
**Path:** ${path}
**Source Type:** ${request.sourceType || 'guide'}
**User-provided params:** ${JSON.stringify(request.userProvidedParams || {}, null, 2)}

**Your task:** Suggest optimized scraping parameters based on the domain, URL structure, and common patterns for this type of documentation site.

**Analysis framework:**
1. **Domain Recognition**: Identify if this is a known documentation platform (GitBook, Docusaurus, VitePress, etc.)
2. **URL Structure Analysis**: Examine the URL pattern to understand the site structure
3. **Common Patterns**: Apply knowledge of typical documentation site patterns
4. **Version Handling**: Suggest patterns to handle or exclude version paths
5. **Asset Filtering**: Recommend excluding static assets and non-content pages

**Domain-specific optimizations:**
${this.getDomainSpecificGuidance(domain)}

**Response format:** Return ONLY a JSON object with the following structure:
\`\`\`json
{
  "maxPages": 200,
  "selectors": {
    "title": "h1, .title",
    "content": "article, .content, main"
  },
  "allowPatterns": [
    {"path_segment": "docs"},
    {"extension": ["html", "htm"]}
  ],
  "ignorePatterns": [
    {"extension": ["js", "css", "png", "jpg", "svg", "ico", "pdf"]},
    {"path_segment": "api"},
    {"contains": "/v1/"},
    {"contains": "/v2/"}
  ],
  "includeSubdomains": false,
  "confidence": 0.9,
  "reasoning": "This appears to be a Docusaurus site. Recommended depth 3 for typical docs structure. Excluded version paths v1/v2 and static assets. Focused on main content areas."
}
\`\`\`

**Important:**
- ONLY return the JSON object, no additional text
- Ensure patterns are valid JSON objects or strings
- Set confidence based on how certain you are about the optimization
- Provide clear reasoning for your choices
- Consider the user's existing parameters and enhance rather than replace them completely`;

    return {
      method: "sampling/createMessage",
      params: {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt
            }
          }
        ],
        systemPrompt: "You are an expert web scraping assistant. Analyze documentation sites and suggest optimal scraping parameters. Focus on excluding version URLs (/v2/, /v3/), static assets (.js, .css, .png), and using appropriate content selectors. Return only valid JSON.",
        includeContext: "thisServer",
        maxTokens: 1000,
        temperature: 0.1
      }
    };
  }

  /**
   * Make a sampling request to MCP
   */
  private async makeSamplingRequest(samplingRequest: any, timeoutMs: number): Promise<OptimizedScrapingParameters> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MCP sampling request timed out'));
      }, timeoutMs);

      try {
        // Try different methods to access MCP sampling
        this.attemptMcpSampling(samplingRequest, timeout, resolve, reject);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Attempt to use MCP sampling with various fallback methods
   */
  private async attemptMcpSampling(
    samplingRequest: any,
    timeout: NodeJS.Timeout,
    resolve: (value: OptimizedScrapingParameters) => void,
    reject: (reason?: any) => void
  ): Promise<void> {
    try {
      // Method 1: Try to access MCP server instance via globalThis
      if (typeof (globalThis as any).mcpServer !== 'undefined') {
        const mcpServer = (globalThis as any).mcpServer;
        
        // Use the server's sampling capability to request from client
        const response = await mcpServer.requestSampling(samplingRequest);
        clearTimeout(timeout);
        
        const content = response.content?.[0]?.text || response.text || '';
        const result = this.parseOptimizationResponse(content);
        resolve(result);
        return;
      }

      // Method 2: Try to access via process.env or other globals
      if (typeof (process as any).mcpSampling !== 'undefined') {
        const mcpSampling = (process as any).mcpSampling;
        const response = await mcpSampling.createMessage(samplingRequest.params);
        clearTimeout(timeout);
        
        const content = response.content?.[0]?.text || response.text || '';
        const result = this.parseOptimizationResponse(content);
        resolve(result);
        return;
      }

      // Method 3: Try to use Claude Code's MCP client directly
      if (typeof (globalThis as any).mcpClient !== 'undefined') {
        const mcpClient = (globalThis as any).mcpClient;
        const response = await mcpClient.request(samplingRequest);
        clearTimeout(timeout);
        
        const content = response.content?.[0]?.text || response.text || '';
        const result = this.parseOptimizationResponse(content);
        resolve(result);
        return;
      }

      // Method 4: Fall back to intelligent rule-based optimization
      clearTimeout(timeout);
      const result = this.generateIntelligentOptimization(samplingRequest);
      resolve(result);
      
    } catch (error) {
      clearTimeout(timeout);
      reject(new Error(`MCP sampling failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  /**
   * Parse the optimization response from MCP sampling
   */
  private parseOptimizationResponse(content: string): OptimizedScrapingParameters {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        if (this.validateOptimizationResult(result)) {
          return result;
        }
      } catch (parseError) {
        // Fall through to error
      }
    }
    
    throw new Error('Failed to parse optimization response');
  }

  /**
   * Generate intelligent optimization when MCP sampling is not available
   */
  private generateIntelligentOptimization(samplingRequest: any): OptimizedScrapingParameters {
    // Extract URL from the sampling request
    const prompt = samplingRequest.params.messages[0].content.text;
    const urlMatch = prompt.match(/\*\*Target URL:\*\* (https?:\/\/[^\s\n]+)/);
    
    if (!urlMatch) {
      throw new Error('Could not extract URL from sampling request');
    }
    
    const url = urlMatch[1];
    const domain = new URL(url).hostname;
    const path = new URL(url).pathname;
    
    // Apply intelligent rules based on domain analysis
    const optimization = this.applyIntelligentRules(domain, path);
    
    return {
      maxPages: optimization.maxPages || 200,
      selectors: optimization.selectors || 'article, .content, .main-content, main',
      allowPatterns: optimization.allowPatterns || [],
      ignorePatterns: optimization.ignorePatterns || [],
      includeSubdomains: optimization.includeSubdomains || false,
      confidence: 0.7, // Medium confidence for rule-based optimization
      reasoning: `Rule-based optimization applied. Domain: ${domain}. ${optimization.reasoning}`
    };
  }

  /**
   * Apply intelligent rules based on domain and path analysis
   */
  private applyIntelligentRules(domain: string, path: string): Partial<OptimizedScrapingParameters> {
    const allowPatterns: (string | ScrapingPattern)[] = [];
    const ignorePatterns: (string | ScrapingPattern)[] = [];
    let maxPages = 200;
    let selectors: string | undefined = undefined;
    let includeSubdomains = false;
    let reasoning = 'Generic documentation site patterns applied.';

    // Basic exclusions for all sites
    ignorePatterns.push(
      { extension: ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot'] },
      { extension: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] },
      { path_segment: 'admin' },
      { path_segment: 'login' },
      { path_segment: 'auth' },
      { contains: '/api/' },
      { contains: '/graphql' }
    );

    // Basic inclusions
    allowPatterns.push(
      { extension: ['html', 'htm'] }
    );

    // Domain-specific optimizations
    if (domain.includes('docs.') || domain.includes('documentation')) {
      allowPatterns.push(
        { path_segment: 'docs' },
        { path_segment: 'documentation' }
      );
      ignorePatterns.push(
        { contains: '/v1/' },
        { contains: '/v2/' },
        { contains: '/v3/' },
        { contains: '/v4/' },
        { contains: '/v5/' }
      );
      selectors = 'article, .content, .main-content, main';
      reasoning = 'Documentation site detected. Excluded version paths and static assets.';
    }

    // Specific platform optimizations
    if (domain.includes('gitbook')) {
      selectors = '.page-content, .book-body';
      ignorePatterns.push({ contains: '/s/' });
      maxPages = 150;
      reasoning = 'GitBook platform detected. Used platform-specific selectors.';
    }

    if (domain.includes('notion')) {
      selectors = '.notion-page-content';
      ignorePatterns.push(
        { contains: '/share/' },
        { contains: '/embed/' }
      );
      maxPages = 150;
      reasoning = 'Notion platform detected. Excluded share/embed URLs.';
    }

    if (domain.includes('stenciljs')) {
      ignorePatterns.push(
        { contains: '/v2/' },
        { contains: '/v3/' }
      );
      selectors = 'article, .content';
      reasoning = 'StencilJS docs detected. Excluded version paths.';
    }

    if (domain.includes('reactjs') || domain.includes('react.dev')) {
      selectors = 'main, .main-content';
      ignorePatterns.push(
        { contains: '/versions/' },
        { contains: '/blog/' }
      );
      reasoning = 'React documentation detected. Excluded version and blog paths.';
    }

    if (domain.includes('vuejs')) {
      selectors = '.content, .page-content';
      ignorePatterns.push({ contains: '/v2/' });
      reasoning = 'Vue.js docs detected. Excluded version paths.';
    }

    if (domain.includes('angular')) {
      selectors = '.docs-content, .content';
      ignorePatterns.push({ contains: '/versions/' });
      reasoning = 'Angular docs detected. Excluded version paths.';
    }

    if (domain.includes('nextjs')) {
      selectors = 'main, .content';
      ignorePatterns.push(
        { contains: '/blog/' },
        { contains: '/showcase/' }
      );
      reasoning = 'Next.js docs detected. Excluded blog and showcase paths.';
    }

    if (domain.includes('developer.mozilla.org')) {
      selectors = '.main-page-content, .content';
      ignorePatterns.push(
        { contains: '/docs/Web/API/' },
        { contains: '/en-US/docs/Web/API/' }
      );
      maxPages = 300;
      reasoning = 'MDN detected. Excluded API docs, increased depth.';
    }

    return {
      maxPages,
      selectors,
      allowPatterns,
      ignorePatterns,
      includeSubdomains,
      reasoning
    };
  }


  private getDomainSpecificGuidance(domain: string): string {
    const domainPatterns = [
      {
        pattern: /^(.*\.)?docs\..*$/,
        guidance: 'Standard docs subdomain - likely modern documentation platform. Use depth 3-4, exclude admin/api paths.'
      },
      {
        pattern: /^(.*\.)?gitbook\..*$/,
        guidance: 'GitBook platform - use selectors for .page-content, exclude /s/ paths, depth 2-3 recommended.'
      },
      {
        pattern: /^(.*\.)?notion\..*$/,
        guidance: 'Notion pages - use depth 2, focus on main content blocks, exclude share/embed URLs.'
      },
      {
        pattern: /^(.*\.)?stenciljs\..*$/,
        guidance: 'StencilJS docs - exclude /v2/, /v3/ version paths, use article selectors, depth 3.'
      },
      {
        pattern: /^(.*\.)?reactjs\..*$/,
        guidance: 'React documentation - exclude version paths, use main content selectors, depth 3.'
      },
      {
        pattern: /^(.*\.)?vuejs\..*$/,
        guidance: 'Vue.js docs - exclude version paths, use .content selectors, depth 3.'
      },
      {
        pattern: /^(.*\.)?angular\..*$/,
        guidance: 'Angular docs - exclude version paths, use .docs-content selectors, depth 3.'
      },
      {
        pattern: /^(.*\.)?nextjs\..*$/,
        guidance: 'Next.js docs - exclude version paths, use main content selectors, depth 3.'
      },
      {
        pattern: /^(.*\.)?vercel\..*$/,
        guidance: 'Vercel docs - modern platform, use standard content selectors, depth 3.'
      },
      {
        pattern: /^(.*\.)?github\..*$/,
        guidance: 'GitHub - if docs, use readme/wiki selectors, if pages exclude non-content paths.'
      },
      {
        pattern: /^(.*\.)?developer\.mozilla\..*$/,
        guidance: 'MDN - use .main-page-content selectors, exclude /docs/Web/API versions, depth 4.'
      }
    ];

    const matchedPattern = domainPatterns.find(p => p.pattern.test(domain));
    return matchedPattern ? matchedPattern.guidance : 'Unknown domain - use generic documentation patterns with conservative depth 3.';
  }


  private validateOptimizationResult(result: any): result is OptimizedScrapingParameters {
    return (
      typeof result === 'object' &&
      typeof result.maxPages === 'number' &&
      Array.isArray(result.allowPatterns) &&
      Array.isArray(result.ignorePatterns) &&
      typeof result.includeSubdomains === 'boolean' &&
      typeof result.confidence === 'number' &&
      typeof result.reasoning === 'string' &&
      result.confidence >= 0 && result.confidence <= 1
    );
  }

  /**
   * Get fallback parameters for when optimization fails
   */
  getFallbackParameters(request: ScrapingOptimizationRequest): OptimizedScrapingParameters {
    const domain = new URL(request.url).hostname;
    
    // Basic fallback based on domain patterns
    const basicIgnorePatterns: (string | ScrapingPattern)[] = [
      { extension: ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot'] },
      { extension: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] },
      { path_segment: 'admin' },
      { path_segment: 'login' },
      { path_segment: 'auth' },
      { contains: '/api/' },
      { contains: '/graphql' }
    ];

    const basicAllowPatterns: (string | ScrapingPattern)[] = [
      { extension: ['html', 'htm'] },
      { path_segment: 'docs' },
      { path_segment: 'documentation' },
      { path_segment: 'guide' },
      { path_segment: 'tutorial' }
    ];

    // Add version exclusions for common documentation sites
    if (domain.includes('docs') || domain.includes('documentation')) {
      basicIgnorePatterns.push(
        { contains: '/v1/' },
        { contains: '/v2/' },
        { contains: '/v3/' },
        { contains: '/v4/' },
        { contains: '/v5/' }
      );
    }

    return {
      maxPages: 200,
      selectors: 'article, .content, .main-content, main, .documentation-content',
      allowPatterns: basicAllowPatterns,
      ignorePatterns: basicIgnorePatterns,
      includeSubdomains: false,
      confidence: 0.3, // Low confidence for fallback
      reasoning: 'Fallback parameters used due to optimization failure. Basic patterns for documentation sites applied.'
    };
  }
}