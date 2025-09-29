import type { Page } from 'patchright';
import type { WaitStrategy } from '../schemas/tools/dynamicInteraction.js';
import { Logger } from './logger.js';

const logger = new Logger('WaitStrategies');

/**
 * Intelligent wait strategies leveraging Playwright's native capabilities
 *
 * These utilities build on Playwright's auto-waiting to handle complex
 * dynamic page scenarios where standard auto-waiting isn't sufficient.
 */
export class WaitStrategies {
  constructor(private page: Page) {}

  /**
   * Execute a wait strategy using Playwright's native waiting capabilities
   */
  async executeWaitStrategy(strategy: WaitStrategy): Promise<{ success: boolean; error?: string; duration: number }> {
    const startTime = Date.now();

    try {
      logger.debug(`Executing wait strategy: ${strategy.type}`, { strategy });

      switch (strategy.type) {
        case 'networkidle':
          await this.waitForNetworkIdle(strategy.timeout);
          break;

        case 'domcontentloaded':
          await this.page.waitForLoadState('domcontentloaded', { timeout: strategy.timeout });
          break;

        case 'load':
          await this.page.waitForLoadState('load', { timeout: strategy.timeout });
          break;

        case 'element_visible':
          if (!strategy.target) {
            throw new Error('element_visible wait strategy requires a target selector');
          }
          await this.waitForElementVisible(strategy.target, strategy.timeout, strategy.options?.state);
          break;

        case 'element_hidden':
          if (!strategy.target) {
            throw new Error('element_hidden wait strategy requires a target selector');
          }
          await this.waitForElementHidden(strategy.target, strategy.timeout);
          break;

        case 'response':
          if (!strategy.target) {
            throw new Error('response wait strategy requires a target URL pattern');
          }
          await this.waitForResponse(strategy.target, strategy.timeout, strategy.options?.status);
          break;

        case 'function':
          if (!strategy.target) {
            throw new Error('function wait strategy requires a target function');
          }
          await this.waitForFunction(strategy.target, strategy.timeout);
          break;

        default:
          throw new Error(`Unknown wait strategy: ${strategy.type}`);
      }

      const duration = Date.now() - startTime;
      logger.debug(`Wait strategy completed successfully in ${duration}ms`);

      return { success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown wait error';

      logger.warn(`Wait strategy failed after ${duration}ms: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        duration
      };
    }
  }

  /**
   * Wait for network to be idle (no requests for specified time)
   * Uses Playwright's built-in networkidle detection
   */
  private async waitForNetworkIdle(timeout: number = 10000): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * Wait for element to be visible using Playwright's user-facing locators
   */
  private async waitForElementVisible(
    selector: string,
    timeout: number = 10000,
    state: 'visible' | 'hidden' | 'attached' | 'detached' = 'visible'
  ): Promise<void> {
    // Try to use user-facing locators if possible
    let locator;

    if (selector.startsWith('role:')) {
      const roleName = selector.replace('role:', '');
      locator = this.page.getByRole(roleName as any);
    } else if (selector.startsWith('text:')) {
      const text = selector.replace('text:', '');
      locator = this.page.getByText(text);
    } else if (selector.startsWith('label:')) {
      const label = selector.replace('label:', '');
      locator = this.page.getByLabel(label);
    } else if (selector.startsWith('placeholder:')) {
      const placeholder = selector.replace('placeholder:', '');
      locator = this.page.getByPlaceholder(placeholder);
    } else if (selector.startsWith('testid:')) {
      const testId = selector.replace('testid:', '');
      locator = this.page.getByTestId(testId);
    } else {
      // Fallback to CSS selector
      locator = this.page.locator(selector);
    }

    await locator.waitFor({ state, timeout });
  }

  /**
   * Wait for element to be hidden or removed
   */
  private async waitForElementHidden(selector: string, timeout: number = 10000): Promise<void> {
    await this.waitForElementVisible(selector, timeout, 'hidden');
  }

  /**
   * Wait for specific network response using Playwright's network monitoring
   */
  private async waitForResponse(
    urlPattern: string,
    timeout: number = 10000,
    expectedStatus?: number
  ): Promise<void> {
    const responsePromise = this.page.waitForResponse(
      response => {
        const matchesPattern = response.url().includes(urlPattern) ||
                             new RegExp(urlPattern).test(response.url());

        if (!matchesPattern) return false;

        if (expectedStatus !== undefined) {
          return response.status() === expectedStatus;
        }

        return response.status() >= 200 && response.status() < 400;
      },
      { timeout }
    );

    await responsePromise;
  }

  /**
   * Wait for custom JavaScript function to return truthy value
   */
  private async waitForFunction(jsFunction: string, timeout: number = 10000): Promise<void> {
    await this.page.waitForFunction(jsFunction, undefined, { timeout });
  }

  /**
   * Composite wait strategy that combines multiple conditions
   */
  async waitForMultipleConditions(
    strategies: WaitStrategy[],
    mode: 'all' | 'any' = 'all'
  ): Promise<{ success: boolean; results: Array<{ strategy: WaitStrategy; result: { success: boolean; error?: string; duration: number } }> }> {
    const results: Array<{ strategy: WaitStrategy; result: { success: boolean; error?: string; duration: number } }> = [];

    if (mode === 'all') {
      // Execute strategies sequentially, all must succeed
      for (const strategy of strategies) {
        const result = await this.executeWaitStrategy(strategy);
        results.push({ strategy, result });

        if (!result.success) {
          return { success: false, results };
        }
      }
      return { success: true, results };
    } else {
      // Execute strategies in parallel, any can succeed
      const promises = strategies.map(async (strategy) => {
        const result = await this.executeWaitStrategy(strategy);
        return { strategy, result };
      });

      const allResults = await Promise.allSettled(promises);

      for (const settledResult of allResults) {
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
          if (settledResult.value.result.success) {
            return { success: true, results };
          }
        } else {
          // Handle Promise rejection
          results.push({
            strategy: strategies[allResults.indexOf(settledResult)],
            result: {
              success: false,
              error: settledResult.reason?.message || 'Promise rejected',
              duration: 0
            }
          });
        }
      }

      return { success: false, results };
    }
  }

  /**
   * Smart wait that automatically detects page state and applies appropriate strategy
   */
  async smartWait(timeoutMs: number = 10000): Promise<{ success: boolean; detectedState: string; error?: string }> {
    try {
      // First, check if page is still loading
      const isLoading = await this.page.evaluate(() => document.readyState !== 'complete');

      if (isLoading) {
        await this.page.waitForLoadState('load', { timeout: timeoutMs });
        return { success: true, detectedState: 'page_loading' };
      }

      // Check for common loading indicators
      const loadingIndicators = [
        '.loading', '.spinner', '.skeleton',
        '[data-loading="true"]', '[aria-busy="true"]',
        '.MuiCircularProgress-root', // Material-UI
        '.ant-spin', // Ant Design
        '.v-progress-circular' // Vuetify
      ];

      for (const indicator of loadingIndicators) {
        try {
          const isVisible = await this.page.locator(indicator).isVisible({ timeout: 100 });
          if (isVisible) {
            // Wait for loading indicator to disappear
            await this.page.locator(indicator).waitFor({ state: 'hidden', timeout: timeoutMs });
            return { success: true, detectedState: `loading_indicator_${indicator}` };
          }
        } catch {
          // Indicator not found, continue
        }
      }

      // Check for network activity
      let networkActive = false;
      const networkPromise = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 1000);

        this.page.on('request', () => {
          networkActive = true;
          clearTimeout(timeout);
          resolve(true);
        });
      });

      networkActive = await networkPromise;

      if (networkActive) {
        await this.waitForNetworkIdle(timeoutMs);
        return { success: true, detectedState: 'network_activity' };
      }

      // If nothing detected, wait for DOM stability
      await this.waitForDOMStability(2000); // 2 second stability window
      return { success: true, detectedState: 'dom_stable' };

    } catch (error) {
      return {
        success: false,
        detectedState: 'timeout',
        error: error instanceof Error ? error.message : 'Smart wait failed'
      };
    }
  }

  /**
   * Wait for DOM to be stable (no mutations for specified time)
   */
  private async waitForDOMStability(stabilityWindow: number = 1000): Promise<void> {
    await this.page.waitForFunction(
      (window) => {
        return new Promise((resolve) => {
          let timer: NodeJS.Timeout;

          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve(true);
            }, window);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true
          });

          // If no mutations occur within the window, resolve immediately
          timer = setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, window);
        });
      },
      stabilityWindow,
      { timeout: 30000 }
    );
  }

  /**
   * Exponential backoff utility for retries
   */
  static calculateBackoffDelay(attempt: number, baseDelay: number = 1000, maxDelay: number = 10000): number {
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Add some jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }
}

/**
 * Factory function for creating wait strategies
 */
export class WaitStrategyFactory {
  /**
   * Create common wait strategies for different scenarios
   */
  static forSPANavigation(): WaitStrategy[] {
    return [
      { type: 'networkidle', timeout: 5000 },
      { type: 'domcontentloaded', timeout: 10000 }
    ];
  }

  static forFormSubmission(submitButtonSelector?: string): WaitStrategy[] {
    const strategies: WaitStrategy[] = [
      { type: 'networkidle', timeout: 10000 }
    ];

    if (submitButtonSelector) {
      strategies.push({
        type: 'element_hidden',
        target: submitButtonSelector,
        timeout: 5000
      });
    }

    return strategies;
  }

  static forModalDialog(): WaitStrategy[] {
    return [
      { type: 'element_visible', target: 'role:dialog', timeout: 5000 },
      { type: 'domcontentloaded', timeout: 3000 }
    ];
  }

  static forApiResponse(endpoint: string, timeout: number = 10000): WaitStrategy {
    return {
      type: 'response',
      target: endpoint,
      timeout,
      options: { status: 200 }
    };
  }

  static forLoadingSpinner(): WaitStrategy[] {
    return [
      { type: 'element_hidden', target: '.loading', timeout: 15000 },
      { type: 'element_hidden', target: '.spinner', timeout: 15000 },
      { type: 'element_hidden', target: '[data-loading="true"]', timeout: 15000 }
    ];
  }
}