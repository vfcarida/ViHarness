/**
 * Capability Matcher.
 *
 * Verifies whether a candidate ModelDescriptor satisfies the required
 * capabilities and context window requirements of a RoutingRequest.
 */
import type { ModelDescriptor } from '../../core/model/model-io.js';
import type { RoutingRequest } from '../../core/model/router-types.js';

export interface CapabilityMatchResult {
  readonly matches: boolean;
  readonly reason: string;
}

export class CapabilityMatcher {
  /**
   * Check if a model descriptor satisfies a routing request.
   */
  static match(descriptor: ModelDescriptor, request: RoutingRequest): CapabilityMatchResult {
    // 1. Context window check
    if (descriptor.capabilities.maxContextTokens < request.contextTokenCount) {
      return {
        matches: false,
        reason: `Context requirement (${request.contextTokenCount} tokens) exceeds model capacity (${descriptor.capabilities.maxContextTokens} tokens)`,
      };
    }

    // 2. Explicit required capabilities check
    if (request.requiredCapabilities && request.requiredCapabilities.length > 0) {
      for (const reqCap of request.requiredCapabilities) {
        if (!descriptor.capabilities.capabilities.has(reqCap)) {
          return {
            matches: false,
            reason: `Model lacks required capability: ${reqCap}`,
          };
        }
      }
    }

    return {
      matches: true,
      reason: 'All capability and context constraints satisfied',
    };
  }
}
