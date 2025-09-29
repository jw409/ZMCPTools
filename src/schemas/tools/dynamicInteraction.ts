import { z } from "zod";

/**
 * Dynamic Web Page Interaction Schema
 *
 * Leverages Playwright's native auto-waiting and user-facing locators
 * for robust interactions with modern dynamic web applications.
 */

// Locator strategy types based on Playwright's user-facing locators
export const LocatorStrategySchema = z.object({
  type: z.enum([
    "role",        // page.getByRole('button', { name: 'Submit' })
    "text",        // page.getByText('Click here')
    "label",       // page.getByLabel('Username')
    "placeholder", // page.getByPlaceholder('Enter email')
    "testId",      // page.getByTestId('login-button')
    "selector",    // Fallback to CSS selector
  ]).describe("Type of locator strategy to use"),

  value: z.string().describe("The locator value (text, role name, selector, etc.)"),

  options: z.object({
    name: z.string().optional().describe("For role locators: accessible name"),
    exact: z.boolean().optional().describe("For text locators: exact match"),
    timeout: z.number().optional().describe("Custom timeout for this locator in ms"),
  }).optional().describe("Additional options for the locator"),
});

// Wait strategy for verification phase
export const WaitStrategySchema = z.object({
  type: z.enum([
    "networkidle",     // Wait for network to be idle
    "domcontentloaded", // Wait for DOM content loaded
    "load",            // Wait for full page load
    "element_visible", // Wait for specific element to be visible
    "element_hidden",  // Wait for element to be hidden (spinner disappears)
    "response",        // Wait for specific network response
    "function",        // Wait for custom function to return true
  ]).describe("Type of wait strategy"),

  target: z.string().optional().describe("Target for wait (URL pattern for response, selector for element, JS function for custom)"),

  timeout: z.number().default(10000).describe("Maximum time to wait in milliseconds"),

  options: z.object({
    state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
    status: z.number().optional().describe("Expected HTTP status code for response waits"),
  }).optional(),
});

// Verification rule to confirm action success
export const VerificationRuleSchema = z.object({
  type: z.enum([
    "element_present",   // Element exists and is visible
    "element_absent",    // Element no longer exists or is hidden
    "text_present",      // Specific text appears on page
    "url_changed",       // URL has changed (navigation occurred)
    "network_response",  // Specific API response received
    "console_message",   // Console log/error message appeared
  ]).describe("Type of verification to perform"),

  locator: LocatorStrategySchema.optional().describe("Locator for element-based verifications"),

  expectedText: z.string().optional().describe("Expected text content for text-based verifications"),

  expectedUrl: z.string().optional().describe("Expected URL pattern for navigation verifications"),

  apiEndpoint: z.string().optional().describe("API endpoint pattern to monitor for network verifications"),

  timeout: z.number().default(5000).describe("Maximum time to wait for verification"),

  required: z.boolean().default(true).describe("Whether this verification must pass for success"),
});

// Action step in the interaction sequence
export const ActionStepSchema = z.object({
  action: z.enum([
    "click",
    "type",
    "fill",        // Clear and type (Playwright's recommended approach)
    "select",
    "hover",
    "scroll",
    "upload",
    "press",       // Keyboard shortcuts
    "wait",        // Explicit wait step
  ]).describe("Type of action to perform"),

  locator: LocatorStrategySchema.describe("How to find the target element"),

  value: z.union([z.string(), z.array(z.string())]).optional().describe("Value for type/select/upload actions"),

  options: z.object({
    force: z.boolean().optional().describe("Force the action even if element not actionable"),
    timeout: z.number().optional().describe("Custom timeout for this action"),
    clickCount: z.number().optional().describe("Number of clicks for click action"),
    key: z.string().optional().describe("Key name for press action"),
    modifiers: z.array(z.string()).optional().describe("Modifier keys (Alt, Control, Meta, Shift)"),
  }).optional().describe("Additional options for the action"),

  waitBefore: WaitStrategySchema.optional().describe("Wait strategy to apply before this action"),

  waitAfter: WaitStrategySchema.optional().describe("Wait strategy to apply after this action"),

  verify: z.array(VerificationRuleSchema).optional().describe("Verification rules to check after this action"),
});

// Main schema for dynamic interaction
export const PerformDynamicInteractionSchema = z.object({
  session_id: z.string().describe("Browser session ID to perform interactions on. Session must already exist"),

  objective: z.string().describe("Natural language description of what you want to achieve (e.g., 'Log in with username admin and password 123, then verify dashboard loads')"),

  // Manual steps override (for when LLM planning isn't needed)
  steps: z.array(ActionStepSchema).optional().describe("Pre-defined action steps (overrides AI planning)"),

  // Global configuration
  config: z.object({
    maxRetries: z.number().default(3).describe("Maximum number of retry attempts for failed actions"),

    retryDelay: z.number().default(1000).describe("Base delay between retries in milliseconds (uses exponential backoff)"),

    globalTimeout: z.number().default(60000).describe("Maximum total time for entire interaction sequence"),

    debugMode: z.boolean().default(false).describe("Enable detailed logging and trace capture"),

    traceOnFailure: z.boolean().default(true).describe("Capture Playwright trace when interaction fails"),

    screenshotOnFailure: z.boolean().default(true).describe("Take screenshot when action fails"),

    // Default wait strategies applied to all actions
    defaultWaitBefore: WaitStrategySchema.optional().describe("Default wait strategy before each action"),

    defaultWaitAfter: WaitStrategySchema.optional().describe("Default wait strategy after each action"),

    // Global verification rules checked after sequence completion
    successVerification: z.array(VerificationRuleSchema).optional().describe("Rules to verify overall objective success"),

  }).optional().describe("Configuration options for the interaction"),

  context: z.object({
    userAgent: z.string().optional().describe("Custom user agent for this interaction"),

    viewport: z.object({
      width: z.number(),
      height: z.number(),
    }).optional().describe("Custom viewport size"),

    locale: z.string().optional().describe("Locale for this interaction"),

    timezone: z.string().optional().describe("Timezone for this interaction"),

  }).optional().describe("Browser context configuration"),

}).describe("Perform intelligent, goal-oriented interactions with dynamic web pages using state-aware execution loop");

// Response schema for dynamic interactions
export const DynamicInteractionResponseSchema = z.object({
  success: z.boolean().describe("Whether the overall interaction succeeded"),

  objective: z.string().describe("The original objective"),

  stepsExecuted: z.number().describe("Number of action steps that were executed"),

  stepsPlanned: z.number().describe("Total number of steps that were planned"),

  executionTime: z.number().describe("Total execution time in milliseconds"),

  results: z.array(z.object({
    stepIndex: z.number(),
    action: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    retryCount: z.number(),
    executionTime: z.number(),
    verificationResults: z.array(z.object({
      type: z.string(),
      success: z.boolean(),
      message: z.string().optional(),
    })).optional(),
  })).describe("Detailed results for each action step"),

  finalState: z.object({
    url: z.string(),
    title: z.string(),
    screenshot: z.string().optional().describe("Base64 screenshot if captured"),
    console: z.array(z.string()).optional().describe("Console messages during interaction"),
  }).describe("Final page state after interaction"),

  traces: z.object({
    traceFile: z.string().optional().describe("Path to Playwright trace file if captured"),
    screenshots: z.array(z.string()).optional().describe("Paths to failure screenshots"),
  }).optional().describe("Debug artifacts if enabled"),

  recommendations: z.array(z.string()).optional().describe("Suggestions for improving future interactions"),

}).describe("Response from dynamic interaction execution with detailed results and debugging information");

// Export types for TypeScript usage
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;
export type WaitStrategy = z.infer<typeof WaitStrategySchema>;
export type VerificationRule = z.infer<typeof VerificationRuleSchema>;
export type ActionStep = z.infer<typeof ActionStepSchema>;
export type PerformDynamicInteraction = z.infer<typeof PerformDynamicInteractionSchema>;
export type DynamicInteractionResponse = z.infer<typeof DynamicInteractionResponseSchema>;