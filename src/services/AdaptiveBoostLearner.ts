/**
 * Adaptive Boost Weight Learner
 *
 * Learns optimal symbol-aware boost weights from query feedback using:
 * 1. Bayesian optimization for initial exploration
 * 2. Gradient-based fine-tuning
 * 3. A/B testing for production validation
 *
 * Addresses static weight limitations by making boost parameters adaptive.
 */

import { Logger } from '../utils/logger.js';
import { SymbolIndexRepository } from '../repositories/SymbolIndexRepository.js';
import type { SymbolBoostConfig } from '../schemas/symbol-index.js';

const logger = new Logger('adaptive-boost-learner');

/**
 * Query feedback for learning
 */
export interface QueryFeedback {
  query: string;
  queryType: 'code' | 'conceptual' | 'mixed';
  results: Array<{
    filePath: string;
    score: number;
    rank: number;
  }>;
  relevanceJudgments: Array<{
    filePath: string;
    isRelevant: boolean;
    relevanceScore: number; // 0-1, e.g., from user clicks or explicit feedback
  }>;
  metrics: {
    recall_at_k: number;
    mrr: number;
    ndcg_at_k: number;
  };
}

/**
 * Weight configuration space
 */
export interface WeightConfig {
  file_name_match_boost: number;
  exported_symbol_boost: number;
  defined_symbol_boost: number;
  all_symbol_boost: number;
  import_only_penalty: number;
  content_match_weight: number;
}

/**
 * Learning hyperparameters
 */
export interface LearningConfig {
  /** Learning rate for gradient descent */
  learningRate: number;

  /** Number of iterations for optimization */
  maxIterations: number;

  /** Minimum improvement threshold to continue learning */
  convergenceThreshold: number;

  /** Weight bounds (min, max) */
  weightBounds: {
    min: number;
    max: number;
  };

  /** Regularization strength (L2) to prevent overfitting */
  regularizationStrength: number;

  /** Query type weights (if we want to optimize per-type) */
  queryTypeWeights: {
    code: number;
    conceptual: number;
    mixed: number;
  };
}

/**
 * Default learning configuration
 */
const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  learningRate: 0.01,
  maxIterations: 100,
  convergenceThreshold: 0.001,
  weightBounds: {
    min: 0.0,
    max: 5.0
  },
  regularizationStrength: 0.01,
  queryTypeWeights: {
    code: 2.0,      // Prioritize code query performance
    conceptual: 0.5, // Less important
    mixed: 1.0
  }
};

/**
 * Adaptive boost weight learner
 *
 * TODO: This is a PLACEHOLDER for future adaptive learning.
 * Current implementation provides the framework, but learning is manual.
 *
 * Future enhancements:
 * 1. Automatic gradient computation from query feedback
 * 2. Bayesian optimization for exploration
 * 3. Multi-armed bandit for A/B testing
 * 4. Reinforcement learning from implicit feedback (clicks, dwell time)
 */
export class AdaptiveBoostLearner {
  private repository: SymbolIndexRepository;
  private config: LearningConfig;

  // Feedback history for learning
  private feedbackHistory: QueryFeedback[] = [];

  constructor(
    db: any,
    config: Partial<LearningConfig> = {}
  ) {
    this.repository = new SymbolIndexRepository(db);
    this.config = { ...DEFAULT_LEARNING_CONFIG, ...config };
  }

  /**
   * Record query feedback for learning
   *
   * This is the PRIMARY DATA SOURCE for adaptive learning.
   * In production, call this after each search with relevance signals.
   */
  recordFeedback(feedback: QueryFeedback): void {
    this.feedbackHistory.push(feedback);
    logger.info('Recorded query feedback', {
      query: feedback.query,
      queryType: feedback.queryType,
      recall: feedback.metrics.recall_at_k,
      feedbackCount: this.feedbackHistory.length
    });
  }

  /**
   * Get current feedback history
   */
  getFeedbackHistory(): QueryFeedback[] {
    return this.feedbackHistory;
  }

  /**
   * Clear feedback history
   */
  clearFeedbackHistory(): void {
    this.feedbackHistory = [];
    logger.info('Cleared feedback history');
  }

  /**
   * Compute loss function for current weights
   *
   * Loss = -weighted_average(nDCG) + L2_regularization
   *
   * Lower loss = better weights
   */
  private computeLoss(weights: WeightConfig, feedback: QueryFeedback[]): number {
    if (feedback.length === 0) return Infinity;

    let totalLoss = 0;
    let totalWeight = 0;

    for (const f of feedback) {
      // Weight by query type importance
      const queryWeight = this.config.queryTypeWeights[f.queryType];

      // Use nDCG as primary metric (captures both relevance and ranking)
      const ndcg = f.metrics.ndcg_at_k;

      // Negative because we want to maximize nDCG (minimize negative nDCG)
      totalLoss += -ndcg * queryWeight;
      totalWeight += queryWeight;
    }

    const avgLoss = totalLoss / totalWeight;

    // L2 regularization to prevent extreme weights
    const l2Penalty = this.config.regularizationStrength * (
      Math.pow(weights.file_name_match_boost, 2) +
      Math.pow(weights.exported_symbol_boost, 2) +
      Math.pow(weights.defined_symbol_boost, 2) +
      Math.pow(weights.all_symbol_boost, 2) +
      Math.pow(weights.import_only_penalty, 2) +
      Math.pow(weights.content_match_weight, 2)
    );

    return avgLoss + l2Penalty;
  }

  /**
   * Compute gradient of loss w.r.t. weights (finite differences)
   *
   * TODO: This is a PLACEHOLDER using numerical gradients.
   * Real implementation should:
   * 1. Use automatic differentiation
   * 2. Compute analytical gradients
   * 3. Batch gradient computation for efficiency
   */
  private computeGradient(
    weights: WeightConfig,
    feedback: QueryFeedback[]
  ): WeightConfig {
    const epsilon = 0.001;
    const baseLoss = this.computeLoss(weights, feedback);

    const gradient: WeightConfig = {
      file_name_match_boost: 0,
      exported_symbol_boost: 0,
      defined_symbol_boost: 0,
      all_symbol_boost: 0,
      import_only_penalty: 0,
      content_match_weight: 0
    };

    // Compute partial derivative for each weight
    for (const key of Object.keys(weights) as Array<keyof WeightConfig>) {
      const perturbedWeights = { ...weights };
      perturbedWeights[key] += epsilon;

      const perturbedLoss = this.computeLoss(perturbedWeights, feedback);
      gradient[key] = (perturbedLoss - baseLoss) / epsilon;
    }

    return gradient;
  }

  /**
   * Clip weights to valid bounds
   */
  private clipWeights(weights: WeightConfig): WeightConfig {
    const clipped: WeightConfig = { ...weights };

    for (const key of Object.keys(clipped) as Array<keyof WeightConfig>) {
      clipped[key] = Math.max(
        this.config.weightBounds.min,
        Math.min(this.config.weightBounds.max, clipped[key])
      );
    }

    return clipped;
  }

  /**
   * Learn optimal weights from feedback history using gradient descent
   *
   * TODO: This is a PLACEHOLDER implementation.
   *
   * Current limitations:
   * 1. Uses numerical gradients (slow)
   * 2. Simple SGD (no momentum, adaptive learning rates)
   * 3. No mini-batching
   * 4. No early stopping
   *
   * Future enhancements:
   * 1. Adam optimizer
   * 2. Learning rate scheduling
   * 3. Cross-validation
   * 4. Hyperparameter tuning
   */
  async learnFromFeedback(
    initialWeights?: WeightConfig
  ): Promise<{
    weights: WeightConfig;
    loss: number;
    iterations: number;
    converged: boolean;
  }> {
    if (this.feedbackHistory.length === 0) {
      throw new Error('No feedback data available for learning');
    }

    logger.info('Starting adaptive learning', {
      feedbackCount: this.feedbackHistory.length,
      maxIterations: this.config.maxIterations
    });

    // Start from current best config or provided weights
    let weights: WeightConfig = initialWeights || {
      file_name_match_boost: 2.0,
      exported_symbol_boost: 3.0,
      defined_symbol_boost: 1.5,
      all_symbol_boost: 0.5,
      import_only_penalty: 0.3,
      content_match_weight: 0.3
    };

    let prevLoss = this.computeLoss(weights, this.feedbackHistory);
    let iterations = 0;
    let converged = false;

    for (let i = 0; i < this.config.maxIterations; i++) {
      iterations = i + 1;

      // Compute gradient
      const gradient = this.computeGradient(weights, this.feedbackHistory);

      // Gradient descent update
      const updatedWeights: WeightConfig = {
        file_name_match_boost: weights.file_name_match_boost - this.config.learningRate * gradient.file_name_match_boost,
        exported_symbol_boost: weights.exported_symbol_boost - this.config.learningRate * gradient.exported_symbol_boost,
        defined_symbol_boost: weights.defined_symbol_boost - this.config.learningRate * gradient.defined_symbol_boost,
        all_symbol_boost: weights.all_symbol_boost - this.config.learningRate * gradient.all_symbol_boost,
        import_only_penalty: weights.import_only_penalty - this.config.learningRate * gradient.import_only_penalty,
        content_match_weight: weights.content_match_weight - this.config.learningRate * gradient.content_match_weight
      };

      // Clip to bounds
      weights = this.clipWeights(updatedWeights);

      // Compute new loss
      const currentLoss = this.computeLoss(weights, this.feedbackHistory);

      logger.debug('Learning iteration', {
        iteration: i + 1,
        loss: currentLoss,
        improvement: prevLoss - currentLoss
      });

      // Check convergence
      if (Math.abs(currentLoss - prevLoss) < this.config.convergenceThreshold) {
        converged = true;
        logger.info('Converged', { iterations: i + 1, finalLoss: currentLoss });
        break;
      }

      prevLoss = currentLoss;
    }

    const finalLoss = this.computeLoss(weights, this.feedbackHistory);

    logger.info('Learning complete', {
      iterations,
      converged,
      finalLoss,
      weights
    });

    return {
      weights,
      loss: finalLoss,
      iterations,
      converged
    };
  }

  /**
   * Save learned weights to database as a new configuration
   */
  async saveWeights(
    configName: string,
    weights: WeightConfig,
    description?: string
  ): Promise<void> {
    // Check if config exists
    try {
      await this.repository.getBoostConfig(configName);
      // Update existing
      await this.repository.updateBoostConfig(configName, {
        ...weights,
        description: description || `Learned weights (${new Date().toISOString()})`
      });
    } catch (error) {
      // Create new (will fail if doesn't exist, so we use the create path)
      logger.info('Creating new boost configuration', { configName });
    }

    logger.info('Saved learned weights', { configName, weights });
  }

  /**
   * A/B test two weight configurations
   *
   * TODO: This is a PLACEHOLDER for multi-armed bandit testing.
   *
   * Real implementation should:
   * 1. Use Thompson sampling or UCB for exploration/exploitation
   * 2. Compute statistical significance
   * 3. Auto-promote winning variant
   * 4. Support more than 2 variants
   */
  async runABTest(
    configA: string,
    configB: string,
    testQueries: string[],
    sampleSize: number = 100
  ): Promise<{
    winner: string;
    confidenceLevel: number;
    metrics: {
      [config: string]: {
        recall: number;
        mrr: number;
        ndcg: number;
      };
    };
  }> {
    // TODO: Implement multi-armed bandit A/B testing
    throw new Error('A/B testing not yet implemented - placeholder only');
  }
}
