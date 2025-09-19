import type { Page } from 'patchright';
import { Logger } from '../utils/logger.js';

const logger = new Logger('PageStateObserver');

export interface PageState {
  url: string;
  title: string;
  readyState: string;
  timestamp: number;
  networkRequests: NetworkActivity[];
  domMutations: number;
  consoleMessages: ConsoleMessage[];
  loadingIndicators: LoadingIndicator[];
  interactiveElements: InteractiveElement[];
}

export interface NetworkActivity {
  url: string;
  method: string;
  status?: number;
  resourceType: string;
  timestamp: number;
  duration?: number;
}

export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error' | 'info';
  text: string;
  timestamp: number;
}

export interface LoadingIndicator {
  selector: string;
  visible: boolean;
  timestamp: number;
}

export interface InteractiveElement {
  selector: string;
  tagName: string;
  type?: string;
  visible: boolean;
  enabled: boolean;
  text?: string;
  timestamp: number;
}

export interface StateChange {
  type: 'url' | 'dom' | 'network' | 'loading' | 'console';
  before: any;
  after: any;
  timestamp: number;
  significance: 'low' | 'medium' | 'high';
}

/**
 * PageStateObserver monitors dynamic page changes in real-time
 *
 * This service provides the "Observe" capability for the dynamic interaction loop.
 * It tracks page state changes to inform planning and verification decisions.
 */
export class PageStateObserver {
  private currentState: PageState | null = null;
  private previousState: PageState | null = null;
  private observers: Map<string, any> = new Map();
  private isMonitoring = false;
  private stateChangeCallbacks: Array<(change: StateChange) => void> = [];

  constructor(private page: Page) {}

  /**
   * Start monitoring page state changes
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Already monitoring page state');
      return;
    }

    logger.debug('Starting page state monitoring');
    this.isMonitoring = true;

    // Capture initial state
    this.currentState = await this.captureCurrentState();

    // Set up network monitoring
    this.setupNetworkMonitoring();

    // Set up console monitoring
    this.setupConsoleMonitoring();

    // Set up DOM mutation monitoring
    await this.setupDOMMonitoring();

    // Set up URL change monitoring
    this.setupUrlMonitoring();

    logger.debug('Page state monitoring started');
  }

  /**
   * Stop monitoring and clean up
   */
  async stopMonitoring(): Promise<void> {
    if (!this.isMonitoring) {
      return;
    }

    logger.debug('Stopping page state monitoring');
    this.isMonitoring = false;

    // Clean up observers
    for (const [name, observer] of this.observers) {
      try {
        if (name === 'domMutation') {
          await this.page.evaluate(() => {
            if ((window as any).__pageStateObserver) {
              (window as any).__pageStateObserver.disconnect();
              delete (window as any).__pageStateObserver;
            }
          });
        }
      } catch (error) {
        logger.warn(`Error cleaning up observer ${name}:`, error);
      }
    }

    this.observers.clear();
    this.stateChangeCallbacks = [];

    logger.debug('Page state monitoring stopped');
  }

  /**
   * Capture the current complete state of the page
   */
  async captureCurrentState(): Promise<PageState> {
    const [
      url,
      title,
      readyState,
      loadingIndicators,
      interactiveElements
    ] = await Promise.all([
      this.page.url(),
      this.page.title(),
      this.page.evaluate(() => document.readyState),
      this.detectLoadingIndicators(),
      this.detectInteractiveElements()
    ]);

    const state: PageState = {
      url,
      title,
      readyState,
      timestamp: Date.now(),
      networkRequests: [],
      domMutations: 0,
      consoleMessages: [],
      loadingIndicators,
      interactiveElements
    };

    return state;
  }

  /**
   * Compare current state with previous state and detect significant changes
   */
  async detectStateChanges(): Promise<StateChange[]> {
    if (!this.currentState) {
      return [];
    }

    this.previousState = { ...this.currentState };
    this.currentState = await this.captureCurrentState();

    const changes: StateChange[] = [];

    // URL changes
    if (this.previousState.url !== this.currentState.url) {
      changes.push({
        type: 'url',
        before: this.previousState.url,
        after: this.currentState.url,
        timestamp: Date.now(),
        significance: 'high'
      });
    }

    // Loading state changes
    const loadingChanges = this.compareLoadingIndicators(
      this.previousState.loadingIndicators,
      this.currentState.loadingIndicators
    );
    changes.push(...loadingChanges);

    // Interactive elements changes
    const elementChanges = this.compareInteractiveElements(
      this.previousState.interactiveElements,
      this.currentState.interactiveElements
    );
    changes.push(...elementChanges);

    return changes;
  }

  /**
   * Set up network request monitoring
   */
  private setupNetworkMonitoring(): void {
    const networkRequests: NetworkActivity[] = [];

    this.page.on('request', (request) => {
      const activity: NetworkActivity = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        timestamp: Date.now()
      };
      networkRequests.push(activity);

      if (this.currentState) {
        this.currentState.networkRequests.push(activity);
      }
    });

    this.page.on('response', (response) => {
      const request = response.request();
      const existingActivity = networkRequests.find(
        r => r.url === request.url() && r.timestamp === request.timestamp
      );

      if (existingActivity) {
        existingActivity.status = response.status();
        existingActivity.duration = Date.now() - existingActivity.timestamp;
      }

      // Detect significant network activity
      if (response.status() >= 200 && response.status() < 300) {
        this.notifyStateChange({
          type: 'network',
          before: null,
          after: {
            url: response.url(),
            status: response.status(),
            method: request.method()
          },
          timestamp: Date.now(),
          significance: request.resourceType() === 'xhr' || request.resourceType() === 'fetch'
            ? 'high' : 'medium'
        });
      }
    });

    this.observers.set('network', true);
  }

  /**
   * Set up console message monitoring
   */
  private setupConsoleMonitoring(): void {
    this.page.on('console', (msg) => {
      const consoleMessage: ConsoleMessage = {
        type: msg.type() as any,
        text: msg.text(),
        timestamp: Date.now()
      };

      if (this.currentState) {
        this.currentState.consoleMessages.push(consoleMessage);
      }

      // Error messages are significant
      if (msg.type() === 'error') {
        this.notifyStateChange({
          type: 'console',
          before: null,
          after: consoleMessage,
          timestamp: Date.now(),
          significance: 'high'
        });
      }
    });

    this.observers.set('console', true);
  }

  /**
   * Set up DOM mutation monitoring
   */
  private async setupDOMMonitoring(): Promise<void> {
    await this.page.evaluate(() => {
      if ((window as any).__pageStateObserver) {
        return; // Already set up
      }

      let mutationCount = 0;

      const observer = new MutationObserver((mutations) => {
        mutationCount += mutations.length;

        // Emit significant mutations
        const significantMutations = mutations.filter(mutation =>
          mutation.type === 'childList' &&
          (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)
        );

        if (significantMutations.length > 0) {
          (window as any).__mutationCount = mutationCount;

          // Signal to the page state observer
          const event = new CustomEvent('pageStateChange', {
            detail: {
              type: 'dom',
              mutations: significantMutations.length,
              timestamp: Date.now()
            }
          });
          document.dispatchEvent(event);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true
      });

      (window as any).__pageStateObserver = observer;
      (window as any).__mutationCount = 0;
    });

    // Listen for DOM change events
    await this.page.exposeFunction('__notifyDOMChange', (data: any) => {
      if (this.currentState) {
        this.currentState.domMutations = data.mutations;
      }

      this.notifyStateChange({
        type: 'dom',
        before: this.currentState?.domMutations || 0,
        after: data.mutations,
        timestamp: data.timestamp,
        significance: data.mutations > 5 ? 'high' : 'medium'
      });
    });

    this.observers.set('domMutation', true);
  }

  /**
   * Set up URL change monitoring
   */
  private setupUrlMonitoring(): void {
    // Monitor URL changes for SPAs
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page.mainFrame()) {
        const newUrl = frame.url();
        const oldUrl = this.currentState?.url;

        if (oldUrl && oldUrl !== newUrl) {
          this.notifyStateChange({
            type: 'url',
            before: oldUrl,
            after: newUrl,
            timestamp: Date.now(),
            significance: 'high'
          });

          if (this.currentState) {
            this.currentState.url = newUrl;
          }
        }
      }
    });

    this.observers.set('urlChange', true);
  }

  /**
   * Detect loading indicators on the page
   */
  private async detectLoadingIndicators(): Promise<LoadingIndicator[]> {
    return await this.page.evaluate(() => {
      const indicators = [
        '.loading', '.spinner', '.skeleton',
        '[data-loading="true"]', '[aria-busy="true"]',
        '.MuiCircularProgress-root', '.ant-spin', '.v-progress-circular'
      ];

      return indicators.map(selector => {
        const element = document.querySelector(selector);
        return {
          selector,
          visible: element ?
            (element.offsetParent !== null && getComputedStyle(element).display !== 'none') :
            false,
          timestamp: Date.now()
        };
      }).filter(indicator => indicator.visible);
    });
  }

  /**
   * Detect interactive elements (buttons, links, inputs)
   */
  private async detectInteractiveElements(): Promise<InteractiveElement[]> {
    return await this.page.evaluate(() => {
      const selectors = [
        'button', 'a[href]', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]',
        '[onclick]', '.btn', '.button'
      ];

      const elements: InteractiveElement[] = [];

      selectors.forEach(selector => {
        const nodeList = document.querySelectorAll(selector);
        nodeList.forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 &&
                          element.offsetParent !== null &&
                          getComputedStyle(element).display !== 'none';

          const isEnabled = !(element as HTMLInputElement).disabled &&
                          !element.hasAttribute('aria-disabled') &&
                          getComputedStyle(element).pointerEvents !== 'none';

          elements.push({
            selector: `${selector}:nth-of-type(${index + 1})`,
            tagName: element.tagName.toLowerCase(),
            type: (element as HTMLInputElement).type,
            visible: isVisible,
            enabled: isEnabled,
            text: element.textContent?.trim() || '',
            timestamp: Date.now()
          });
        });
      });

      return elements.filter(el => el.visible && el.enabled);
    });
  }

  /**
   * Compare loading indicators between states
   */
  private compareLoadingIndicators(
    previous: LoadingIndicator[],
    current: LoadingIndicator[]
  ): StateChange[] {
    const changes: StateChange[] = [];

    // Check for newly appeared loading indicators
    current.forEach(indicator => {
      const wasVisible = previous.some(p => p.selector === indicator.selector && p.visible);
      if (!wasVisible && indicator.visible) {
        changes.push({
          type: 'loading',
          before: false,
          after: true,
          timestamp: Date.now(),
          significance: 'medium'
        });
      }
    });

    // Check for disappeared loading indicators
    previous.forEach(indicator => {
      const isStillVisible = current.some(c => c.selector === indicator.selector && c.visible);
      if (indicator.visible && !isStillVisible) {
        changes.push({
          type: 'loading',
          before: true,
          after: false,
          timestamp: Date.now(),
          significance: 'high' // Loading completion is significant
        });
      }
    });

    return changes;
  }

  /**
   * Compare interactive elements between states
   */
  private compareInteractiveElements(
    previous: InteractiveElement[],
    current: InteractiveElement[]
  ): StateChange[] {
    const changes: StateChange[] = [];

    // Simplified comparison - could be expanded
    if (previous.length !== current.length) {
      changes.push({
        type: 'dom',
        before: previous.length,
        after: current.length,
        timestamp: Date.now(),
        significance: 'medium'
      });
    }

    return changes;
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: (change: StateChange) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Notify registered callbacks of state changes
   */
  private notifyStateChange(change: StateChange): void {
    this.stateChangeCallbacks.forEach(callback => {
      try {
        callback(change);
      } catch (error) {
        logger.warn('Error in state change callback:', error);
      }
    });
  }

  /**
   * Get current page state
   */
  getCurrentState(): PageState | null {
    return this.currentState;
  }

  /**
   * Get previous page state
   */
  getPreviousState(): PageState | null {
    return this.previousState;
  }

  /**
   * Check if page appears to be in a stable state
   */
  async isPageStable(stabilityWindow: number = 2000): Promise<boolean> {
    if (!this.currentState) {
      return false;
    }

    const now = Date.now();

    // Check if there are any visible loading indicators
    const hasLoadingIndicators = this.currentState.loadingIndicators.some(
      indicator => indicator.visible
    );

    if (hasLoadingIndicators) {
      return false;
    }

    // Check if there has been recent network activity
    const recentNetworkActivity = this.currentState.networkRequests.filter(
      request => (now - request.timestamp) < stabilityWindow
    );

    if (recentNetworkActivity.length > 0) {
      return false;
    }

    // Check if DOM has been mutating recently
    const recentMutations = await this.page.evaluate((window) => {
      return (window as any).__mutationCount || 0;
    }, stabilityWindow);

    if (recentMutations > 0) {
      // Reset mutation counter
      await this.page.evaluate(() => {
        (window as any).__mutationCount = 0;
      });
      return false;
    }

    return true;
  }

  /**
   * Wait for page to reach stable state
   */
  async waitForStableState(
    timeout: number = 10000,
    stabilityWindow: number = 2000
  ): Promise<{ success: boolean; duration: number; error?: string }> {
    const startTime = Date.now();
    const endTime = startTime + timeout;

    while (Date.now() < endTime) {
      const isStable = await this.isPageStable(stabilityWindow);

      if (isStable) {
        return {
          success: true,
          duration: Date.now() - startTime
        };
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return {
      success: false,
      duration: Date.now() - startTime,
      error: 'Timeout waiting for stable page state'
    };
  }
}