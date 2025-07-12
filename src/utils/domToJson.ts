/**
 * domToJson.ts - Comprehensive DOM-to-JSON utility for ClaudeMcpTools
 * 
 * Converts DOM elements to navigable JSON structure for AI navigation and analysis.
 * Includes computed CSS styles, bounding box information, interactivity detection,
 * and supports filtering/optimization for AI consumption.
 * 
 * Key Features:
 * - Full DOM tree serialization with inline CSS styles
 * - Bounding box and visibility detection
 * - Interactive element identification (clickable, input, etc.)
 * - HTML sanitization and markdown conversion
 * - Style filtering for AI optimization
 * - Playwright page.evaluate() compatibility
 * - Database schema integration for domJsonContent
 */

import type { Page } from 'patchright';
import TurndownService from 'turndown';

// ===================================
// TypeScript Interfaces
// ===================================

/**
 * Core DOM JSON node structure matching database schema
 */
export interface DOMJsonNode {
  /** Element tag name (div, span, button, etc.) */
  tagName: string;
  /** Element ID attribute */
  id?: string;
  /** Element class names as array */
  classes?: string[];
  /** Element attributes (excluding style and class) */
  attributes?: Record<string, string>;
  /** Computed CSS styles (filtered for relevance) */
  styles?: Record<string, string>;
  /** Bounding box information */
  boundingBox?: BoundingBox;
  /** Text content (direct text, not including children) */
  textContent?: string;
  /** Inner text including children */
  innerText?: string;
  /** Whether element is visible on screen */
  isVisible?: boolean;
  /** Whether element is interactive (clickable, focusable) */
  isInteractive?: boolean;
  /** Interactive element metadata */
  interactionMetadata?: InteractionMetadata;
  /** Child elements */
  children?: DOMJsonNode[];
  /** Parent element reference (tagName#id.class for navigation) */
  parentReference?: string;
  /** Unique selector path to this element */
  selectorPath?: string;
  /** Element depth in DOM tree */
  depth?: number;
  /** Element index among siblings */
  siblingIndex?: number;
}

/**
 * Element bounding box information
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Whether element is in viewport */
  inViewport?: boolean;
}

/**
 * Interactive element metadata
 */
export interface InteractionMetadata {
  /** Type of interaction (click, input, select, etc.) */
  type: 'click' | 'input' | 'select' | 'link' | 'button' | 'form' | 'media' | 'other';
  /** Action that would be performed (navigate, submit, etc.) */
  action?: string;
  /** Form input type for input elements */
  inputType?: string;
  /** Link destination for anchor elements */
  href?: string;
  /** Form method for form elements */
  formMethod?: string;
  /** ARIA label or accessible name */
  accessibleName?: string;
  /** Whether element is focusable */
  focusable?: boolean;
  /** Tab index value */
  tabIndex?: number;
}

/**
 * Serialization options
 */
export interface SerializationOptions {
  /** Include all computed styles (default: false, includes only relevant styles) */
  includeAllStyles?: boolean;
  /** Custom style properties to include/exclude */
  styleFilter?: StyleFilterOptions;
  /** Include bounding box information */
  includeBoundingBox?: boolean;
  /** Include interactive element detection */
  includeInteractivity?: boolean;
  /** Maximum depth to traverse (prevents infinite recursion) */
  maxDepth?: number;
  /** CSS selector to limit serialization scope */
  scope?: string;
  /** Exclude hidden elements */
  excludeHidden?: boolean;
  /** Include parent references for navigation */
  includeParentReferences?: boolean;
  /** Include selector paths for element targeting */
  includeSelectorPaths?: boolean;
  /** Optimize for AI navigation (reduces size, focuses on interactive elements) */
  optimizeForAI?: boolean;
}

/**
 * Style filtering options
 */
export interface StyleFilterOptions {
  /** Specific style properties to include */
  include?: string[];
  /** Specific style properties to exclude */
  exclude?: string[];
  /** Include only layout-relevant styles */
  layoutOnly?: boolean;
  /** Include only visual styles (colors, fonts, etc.) */
  visualOnly?: boolean;
}

/**
 * HTML sanitization options
 */
export interface SanitizationOptions {
  /** Remove script tags */
  removeScripts?: boolean;
  /** Remove style tags */
  removeStyles?: boolean;
  /** Remove comments */
  removeComments?: boolean;
  /** Remove data attributes */
  removeDataAttributes?: boolean;
  /** Remove event handler attributes */
  removeEventHandlers?: boolean;
  /** Allowed tags (whitelist) */
  allowedTags?: string[];
  /** Forbidden tags (blacklist) */
  forbiddenTags?: string[];
}

/**
 * Markdown conversion options
 */
export interface MarkdownOptions {
  /** Convert headings */
  headings?: boolean;
  /** Convert links */
  links?: boolean;
  /** Convert lists */
  lists?: boolean;
  /** Convert tables */
  tables?: boolean;
  /** Convert code blocks */
  codeBlocks?: boolean;
  /** Convert emphasis (bold, italic) */
  emphasis?: boolean;
  /** Custom turndown rules */
  customRules?: Record<string, any>;
}

// ===================================
// Core Serialization Functions
// ===================================

/**
 * Main function to serialize DOM to JSON structure
 * Designed to work with Playwright page.evaluate()
 */
export function serializeDOMToJson(
  selector: string = 'html',
  options: SerializationOptions = {}
): DOMJsonNode | null {
  // This function runs in browser context
  const targetElement = document.querySelector(selector);
  if (!targetElement) {
    return null;
  }

  const defaultOptions: Required<SerializationOptions> = {
    includeAllStyles: false,
    styleFilter: { layoutOnly: false, visualOnly: false },
    includeBoundingBox: true,
    includeInteractivity: true,
    maxDepth: 50,
    scope: selector,
    excludeHidden: false,
    includeParentReferences: true,
    includeSelectorPaths: true,
    optimizeForAI: true
  };

  const mergedOptions = { ...defaultOptions, ...options };

  return serializeElement(targetElement as Element, mergedOptions, 0, null);
}

/**
 * Serialize a single DOM element recursively
 */
function serializeElement(
  element: Element,
  options: Required<SerializationOptions>,
  depth: number,
  parent: Element | null
): DOMJsonNode {
  const node: DOMJsonNode = {
    tagName: element.tagName.toLowerCase(),
    depth,
    siblingIndex: Array.from(element.parentElement?.children || []).indexOf(element)
  };

  // Basic attributes
  if (element.id) {
    node.id = element.id;
  }

  if (element.className) {
    node.classes = Array.from(element.classList);
  }

  // Element attributes (excluding style and class)
  const attributes: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (attr.name !== 'style' && attr.name !== 'class') {
      attributes[attr.name] = attr.value;
    }
  }
  if (Object.keys(attributes).length > 0) {
    node.attributes = attributes;
  }

  // Text content
  const directText = Array.from(element.childNodes)
    .filter(child => child.nodeType === Node.TEXT_NODE)
    .map(child => child.textContent?.trim() || '')
    .filter(text => text)
    .join(' ');
  
  if (directText) {
    node.textContent = directText;
  }

  const innerText = (element as HTMLElement).innerText?.trim();
  if (innerText && innerText !== directText) {
    node.innerText = innerText;
  }

  // Computed styles
  if (window.getComputedStyle) {
    const computedStyles = window.getComputedStyle(element);
    node.styles = extractRelevantStyles(computedStyles, options.styleFilter);
  }

  // Bounding box
  if (options.includeBoundingBox) {
    node.boundingBox = getBoundingBoxInfo(element);
  }

  // Visibility
  node.isVisible = isElementVisible(element);

  // Skip hidden elements if requested
  if (options.excludeHidden && !node.isVisible) {
    return node;
  }

  // Interactivity detection
  if (options.includeInteractivity) {
    const interactionData = detectInteractiveElements(element);
    node.isInteractive = interactionData.isInteractive;
    if (interactionData.metadata) {
      node.interactionMetadata = interactionData.metadata;
    }
  }

  // Parent reference
  if (options.includeParentReferences && parent) {
    node.parentReference = generateElementReference(parent);
  }

  // Selector path
  if (options.includeSelectorPaths) {
    node.selectorPath = generateSelectorPath(element);
  }

  // Recursively process children
  if (depth < options.maxDepth) {
    const children: DOMJsonNode[] = [];
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      const childNode = serializeElement(child, options, depth + 1, element);
      
      // AI optimization: skip non-interactive leaf nodes with no text
      if (options.optimizeForAI) {
        if (shouldIncludeForAI(childNode, child)) {
          children.push(childNode);
        }
      } else {
        children.push(childNode);
      }
    }
    
    if (children.length > 0) {
      node.children = children;
    }
  }

  return node;
}

/**
 * Extract relevant CSS styles for AI navigation
 */
function extractRelevantStyles(
  computedStyles: CSSStyleDeclaration,
  filter: StyleFilterOptions
): Record<string, string> {
  const relevantStyles: Record<string, string> = {};

  // Define style categories
  const layoutStyles = [
    'display', 'position', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'margin', 'padding', 'border',
    'flex', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
    'grid', 'gridTemplate', 'gridArea', 'gap',
    'float', 'clear', 'overflow', 'zIndex', 'visibility'
  ];

  const visualStyles = [
    'color', 'backgroundColor', 'backgroundImage', 'backgroundSize',
    'fontSize', 'fontFamily', 'fontWeight', 'lineHeight',
    'textAlign', 'textDecoration', 'textTransform',
    'borderColor', 'borderRadius', 'boxShadow', 'opacity',
    'cursor'
  ];

  const interactionStyles = [
    'cursor', 'pointerEvents', 'userSelect', 'touchAction'
  ];

  let stylesToCheck: string[] = [];

  if (filter.include) {
    stylesToCheck = filter.include;
  } else if (filter.layoutOnly) {
    stylesToCheck = layoutStyles;
  } else if (filter.visualOnly) {
    stylesToCheck = visualStyles;
  } else {
    // Default: include layout, visual, and interaction styles
    stylesToCheck = [...layoutStyles, ...visualStyles, ...interactionStyles];
  }

  // Remove excluded styles
  if (filter.exclude) {
    stylesToCheck = stylesToCheck.filter(style => !filter.exclude!.includes(style));
  }

  // Extract styles
  for (const styleName of stylesToCheck) {
    const kebabCase = styleName.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    const value = computedStyles.getPropertyValue(kebabCase) || 
                  (computedStyles as any)[styleName];
    
    if (value && value !== 'auto' && value !== 'none' && value !== 'normal' && 
        value !== 'initial' && value !== 'inherit' && value !== 'unset') {
      relevantStyles[kebabCase] = value;
    }
  }

  return relevantStyles;
}

/**
 * Get comprehensive bounding box information
 */
function getBoundingBoxInfo(element: Element): BoundingBox {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    inViewport: rect.top >= 0 && rect.left >= 0 && 
                rect.bottom <= viewportHeight && rect.right <= viewportWidth
  };
}

/**
 * Check if element is visible
 */
function isElementVisible(element: Element): boolean {
  if (window.getComputedStyle) {
    const styles = window.getComputedStyle(element);
    if (styles.display === 'none' || styles.visibility === 'hidden' || 
        styles.opacity === '0') {
      return false;
    }
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Detect interactive elements and their capabilities
 */
export function detectInteractiveElements(element: Element): {
  isInteractive: boolean;
  metadata?: InteractionMetadata;
} {
  const tagName = element.tagName.toLowerCase();
  const metadata: InteractionMetadata = {
    type: 'other',
    focusable: false,
    tabIndex: -1
  };

  let isInteractive = false;

  // Check tab index
  const tabIndex = (element as HTMLElement).tabIndex;
  if (tabIndex >= 0) {
    metadata.focusable = true;
    metadata.tabIndex = tabIndex;
    isInteractive = true;
  }

  // Check by tag name
  switch (tagName) {
    case 'a':
      const href = (element as HTMLAnchorElement).href;
      if (href) {
        metadata.type = 'link';
        metadata.action = 'navigate';
        metadata.href = href;
        isInteractive = true;
      }
      break;

    case 'button':
      metadata.type = 'button';
      metadata.action = 'click';
      isInteractive = true;
      break;

    case 'input':
      const inputType = (element as HTMLInputElement).type || 'text';
      metadata.type = 'input';
      metadata.inputType = inputType;
      metadata.action = inputType === 'submit' ? 'submit' : 'input';
      isInteractive = true;
      break;

    case 'select':
      metadata.type = 'select';
      metadata.action = 'select';
      isInteractive = true;
      break;

    case 'textarea':
      metadata.type = 'input';
      metadata.inputType = 'textarea';
      metadata.action = 'input';
      isInteractive = true;
      break;

    case 'form':
      metadata.type = 'form';
      metadata.action = 'submit';
      metadata.formMethod = (element as HTMLFormElement).method || 'get';
      isInteractive = true;
      break;

    case 'audio':
    case 'video':
      metadata.type = 'media';
      metadata.action = 'play';
      isInteractive = true;
      break;
  }

  // Check for click event listeners (heuristic)
  if (!isInteractive) {
    const styles = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (styles?.cursor === 'pointer') {
      metadata.type = 'click';
      metadata.action = 'click';
      isInteractive = true;
    }
  }

  // Check for ARIA attributes
  const role = element.getAttribute('role');
  if (role) {
    const interactiveRoles = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio'];
    if (interactiveRoles.includes(role)) {
      metadata.type = 'click';
      metadata.action = 'click';
      isInteractive = true;
    }
  }

  // Get accessible name
  const ariaLabel = element.getAttribute('aria-label');
  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  const title = element.getAttribute('title');
  const textContent = (element as HTMLElement).textContent?.trim();

  if (ariaLabel) {
    metadata.accessibleName = ariaLabel;
  } else if (ariaLabelledBy) {
    const labelElement = document.getElementById(ariaLabelledBy);
    if (labelElement) {
      metadata.accessibleName = labelElement.textContent?.trim() || '';
    }
  } else if (title) {
    metadata.accessibleName = title;
  } else if (textContent && textContent.length < 100) {
    metadata.accessibleName = textContent;
  }

  return {
    isInteractive,
    metadata: isInteractive ? metadata : undefined
  };
}

/**
 * Generate a reference string for an element
 */
function generateElementReference(element: Element): string {
  let reference = element.tagName.toLowerCase();
  
  if (element.id) {
    reference += `#${element.id}`;
  }
  
  if (element.className) {
    const classes = Array.from(element.classList).slice(0, 3); // Limit to 3 classes
    if (classes.length > 0) {
      reference += `.${classes.join('.')}`;
    }
  }
  
  return reference;
}

/**
 * Generate CSS selector path to element
 */
function generateSelectorPath(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break; // ID is unique, no need to go further
    }
    
    if (current.className) {
      const classes = Array.from(current.classList);
      if (classes.length > 0) {
        selector += `.${classes.join('.')}`;
      }
    }
    
    // Add nth-child if needed for specificity
    const siblings = Array.from(current.parentElement?.children || []);
    const sameTagSiblings = siblings.filter(s => s.tagName === current!.tagName);
    if (sameTagSiblings.length > 1) {
      const index = sameTagSiblings.indexOf(current) + 1;
      selector += `:nth-of-type(${index})`;
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Determine if element should be included for AI optimization
 */
function shouldIncludeForAI(node: DOMJsonNode, element: Element): boolean {
  // Always include interactive elements
  if (node.isInteractive) {
    return true;
  }

  // Include elements with meaningful text
  if (node.textContent || node.innerText) {
    return true;
  }

  // Include structural elements
  const structuralTags = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer'];
  if (structuralTags.includes(node.tagName)) {
    return true;
  }

  // Include form-related elements
  const formTags = ['form', 'fieldset', 'legend', 'label'];
  if (formTags.includes(node.tagName)) {
    return true;
  }

  // Include elements with children (containers)
  if (node.children && node.children.length > 0) {
    return true;
  }

  // Include elements with important visual styles
  if (node.styles) {
    const hasImportantStyles = ['background-color', 'background-image', 'border', 'box-shadow']
      .some(style => node.styles![style]);
    if (hasImportantStyles) {
      return true;
    }
  }

  // Exclude empty containers and decorative elements
  return false;
}

// ===================================
// HTML Processing Functions
// ===================================

/**
 * Sanitize HTML content for safe processing
 * Uses regex-based approach for Node.js compatibility
 */
export function sanitizeHTMLContent(
  html: string,
  options: SanitizationOptions = {}
): string {
  const defaultOptions: Required<SanitizationOptions> = {
    removeScripts: true,
    removeStyles: true,
    removeComments: true,
    removeDataAttributes: false,
    removeEventHandlers: true,
    allowedTags: [],
    forbiddenTags: ['script', 'style', 'noscript', 'iframe', 'object', 'embed']
  };

  const mergedOptions = { ...defaultOptions, ...options };
  let sanitized = html;

  // Remove comments
  if (mergedOptions.removeComments) {
    sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');
  }

  // Remove forbidden tags
  if (mergedOptions.removeScripts) {
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
  if (mergedOptions.removeStyles) {
    sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  }

  // Remove additional forbidden tags
  mergedOptions.forbiddenTags.forEach(tag => {
    const regex = new RegExp(`<${tag}\\b[^<]*(?:(?!<\\/${tag}>)<[^<]*)*<\\/${tag}>`, 'gi');
    sanitized = sanitized.replace(regex, '');
    // Also remove self-closing versions
    const selfClosingRegex = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    sanitized = sanitized.replace(selfClosingRegex, '');
  });

  // Remove event handlers
  if (mergedOptions.removeEventHandlers) {
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
  }

  // Remove data attributes
  if (mergedOptions.removeDataAttributes) {
    sanitized = sanitized.replace(/\s+data-[\w-]+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\s+data-[\w-]+\s*=\s*[^\s>]+/gi, '');
  }

  // Apply tag whitelist if specified
  if (mergedOptions.allowedTags.length > 0) {
    // This is a simple implementation - a more robust one would require proper HTML parsing
    const allowedPattern = mergedOptions.allowedTags.join('|');
    const tagRegex = new RegExp(`<(?!\\/?(${allowedPattern})\\b)[^>]*>`, 'gi');
    sanitized = sanitized.replace(tagRegex, '');
  }

  return sanitized;
}

/**
 * Convert HTML to markdown format
 */
export function convertHTMLToMarkdown(
  html: string,
  options: MarkdownOptions = {}
): string {
  const defaultOptions: Required<MarkdownOptions> = {
    headings: true,
    links: true,
    lists: true,
    tables: true,
    codeBlocks: true,
    emphasis: true,
    customRules: {}
  };

  const mergedOptions = { ...defaultOptions, ...options };

  // Create turndown service
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```'
  });

  // Configure based on options
  if (!mergedOptions.headings) {
    turndownService.remove(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  }

  if (!mergedOptions.links) {
    turndownService.remove(['a']);
  }

  if (!mergedOptions.lists) {
    turndownService.remove(['ul', 'ol', 'li']);
  }

  if (!mergedOptions.tables) {
    turndownService.remove(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
  }

  if (!mergedOptions.codeBlocks) {
    turndownService.remove(['pre', 'code']);
  }

  if (!mergedOptions.emphasis) {
    turndownService.remove(['strong', 'b', 'em', 'i']);
  }

  // Add custom rules
  Object.entries(mergedOptions.customRules).forEach(([key, rule]) => {
    turndownService.addRule(key, rule);
  });

  // Convert to markdown
  const markdown = turndownService.turndown(html);

  // Clean up extra whitespace
  return markdown
    .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double
    .replace(/[ \t]+$/gm, '') // Remove trailing whitespace
    .trim();
}

// ===================================
// AI Optimization Functions
// ===================================

/**
 * Optimize styles for AI consumption by filtering to most relevant properties
 */
export function optimizeStylesForAI(styles: Record<string, string>): Record<string, string> {
  const aiRelevantStyles = [
    // Layout and positioning
    'display', 'position', 'top', 'left', 'right', 'bottom',
    'width', 'height', 'margin', 'padding',
    'flex-direction', 'justify-content', 'align-items',
    'grid-template', 'gap',
    
    // Visibility and interaction
    'visibility', 'opacity', 'cursor', 'pointer-events',
    'overflow', 'z-index',
    
    // Typography (for readability)
    'font-size', 'font-weight', 'color', 'text-align',
    
    // Visual cues for interaction
    'background-color', 'border', 'border-radius', 'box-shadow'
  ];

  const optimized: Record<string, string> = {};
  
  aiRelevantStyles.forEach(prop => {
    if (styles[prop]) {
      optimized[prop] = styles[prop];
    }
  });

  return optimized;
}

// ===================================
// Playwright Integration Helper
// ===================================

/**
 * Helper function to serialize DOM using Playwright page
 * This creates browser-executable code as a string to avoid TypeScript issues
 */
export async function serializeDOMWithPlaywright(
  page: Page,
  selector: string = 'html',
  options: SerializationOptions = {}
): Promise<DOMJsonNode | null> {
  // Create the serialization script as a string
  const script = `
    (function(selector, options) {
      // Default options
      const defaultOptions = {
        includeAllStyles: false,
        styleFilter: { layoutOnly: false, visualOnly: false },
        includeBoundingBox: true,
        includeInteractivity: true,
        maxDepth: 50,
        scope: selector,
        excludeHidden: false,
        includeParentReferences: true,
        includeSelectorPaths: true,
        optimizeForAI: true
      };
      
      const mergedOptions = Object.assign({}, defaultOptions, options);
      
      const targetElement = document.querySelector(selector);
      if (!targetElement) {
        return null;
      }
      
      function serializeElement(element, opts, depth, parent) {
        const node = {
          tagName: element.tagName.toLowerCase(),
          depth: depth,
          siblingIndex: Array.from(element.parentElement ? element.parentElement.children : []).indexOf(element)
        };
        
        if (element.id) node.id = element.id;
        if (element.className) node.classes = Array.from(element.classList);
        
        // Attributes
        const attributes = {};
        for (let i = 0; i < element.attributes.length; i++) {
          const attr = element.attributes[i];
          if (attr.name !== 'style' && attr.name !== 'class') {
            attributes[attr.name] = attr.value;
          }
        }
        if (Object.keys(attributes).length > 0) node.attributes = attributes;
        
        // Text content
        const directText = Array.from(element.childNodes)
          .filter(function(child) { return child.nodeType === 3; })
          .map(function(child) { return child.textContent ? child.textContent.trim() : ''; })
          .filter(function(text) { return text; })
          .join(' ');
        if (directText) node.textContent = directText;
        
        const innerText = element.innerText ? element.innerText.trim() : '';
        if (innerText && innerText !== directText) node.innerText = innerText;
        
        // Styles
        if (window.getComputedStyle) {
          const computedStyles = window.getComputedStyle(element);
          const styles = {};
          const stylesToCheck = ['display', 'position', 'width', 'height', 'color', 'background-color', 'cursor', 'visibility'];
          
          for (let i = 0; i < stylesToCheck.length; i++) {
            const prop = stylesToCheck[i];
            const value = computedStyles.getPropertyValue(prop);
            if (value && value !== 'auto' && value !== 'none' && value !== 'normal') {
              styles[prop] = value;
            }
          }
          if (Object.keys(styles).length > 0) node.styles = styles;
        }
        
        // Bounding box
        if (opts.includeBoundingBox) {
          const rect = element.getBoundingClientRect();
          node.boundingBox = {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left
          };
        }
        
        // Visibility
        node.isVisible = element.offsetWidth > 0 && element.offsetHeight > 0;
        
        // Interactivity
        if (opts.includeInteractivity) {
          const tagName = element.tagName.toLowerCase();
          const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
          node.isInteractive = interactiveTags.includes(tagName) || element.tabIndex >= 0;
          
          if (node.isInteractive) {
            node.interactionMetadata = { type: tagName };
            if (tagName === 'a' && element.href) {
              node.interactionMetadata.href = element.href;
            }
          }
        }
        
        // Selector path
        if (opts.includeSelectorPaths) {
          let selector = element.tagName.toLowerCase();
          if (element.id) selector += '#' + element.id;
          else if (element.className) selector += '.' + element.className.split(' ')[0];
          node.selectorPath = selector;
        }
        
        // Children
        if (depth < opts.maxDepth) {
          const children = [];
          for (let i = 0; i < element.children.length; i++) {
            const child = element.children[i];
            const childNode = serializeElement(child, opts, depth + 1, element);
            children.push(childNode);
          }
          if (children.length > 0) node.children = children;
        }
        
        return node;
      }
      
      return serializeElement(targetElement, mergedOptions, 0, null);
    })('${selector}', ${JSON.stringify(options)});
  `;
  
  return await page.evaluate(script);
}

// ===================================
// Export Default Configuration
// ===================================

/**
 * Default options optimized for AI navigation
 */
export const AI_OPTIMIZED_OPTIONS: SerializationOptions = {
  includeAllStyles: false,
  styleFilter: { layoutOnly: true },
  includeBoundingBox: true,
  includeInteractivity: true,
  maxDepth: 25,
  excludeHidden: true,
  includeParentReferences: true,
  includeSelectorPaths: true,
  optimizeForAI: true
};

/**
 * Default options for comprehensive DOM analysis
 */
export const COMPREHENSIVE_OPTIONS: SerializationOptions = {
  includeAllStyles: true,
  styleFilter: {},
  includeBoundingBox: true,
  includeInteractivity: true,
  maxDepth: 50,
  excludeHidden: false,
  includeParentReferences: true,
  includeSelectorPaths: true,
  optimizeForAI: false
};

/**
 * Convenience export for the main serialization function
 */
export { serializeDOMToJson as default };