/**
 * Pre-Step Interception Waterfall Types.
 *
 * Implements the DeepSeek Harness pre-step waterfall event model:
 * before each agent step, registered listeners can inspect, modify messages,
 * inject context, or reject the step entirely.
 */
import type { ModelMessage } from './model-io.js';

/**
 * Event passed into pre-step listeners before a model invocation step.
 */
export interface PreStepEvent {
  /**
   * The current candidate messages to be sent to the model.
   */
  readonly messages: ReadonlyArray<ModelMessage>;

  /**
   * Current conversation/iteration turn index.
   */
  readonly turn: number;

  /**
   * Current step sequence number.
   */
  readonly step: number;

  /**
   * Abort signal for step cancellation.
   */
  readonly signal?: AbortSignal;

  /**
   * Optional metadata passed along with the step execution.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The decision returned by a pre-step listener.
 * - 'reject': cancels this step / iteration.
 * - 'enter': proceeds with the (possibly modified or enriched) messages.
 */
export type PreStepDecision =
  | { readonly kind: 'reject'; readonly reason?: string }
  | { readonly kind: 'enter'; readonly messages: ReadonlyArray<ModelMessage> };

/**
 * Pre-step listener function signature.
 */
export type PreStepListener = (event: PreStepEvent) => Promise<PreStepDecision> | PreStepDecision;

/**
 * Optional interface for object-based pre-step interceptors.
 */
export interface PreStepInterceptor {
  readonly name?: string;
  intercept(event: PreStepEvent): Promise<PreStepDecision> | PreStepDecision;
}
