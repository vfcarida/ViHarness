// Pattern: Extensible Pub/Sub Event System (ref: DeepSeek Harness, Cordis)
/**
 * Event Map and Handler Definitions for Vi-Harness Plugin System.
 */
export interface EventMap {
  'plugin/loaded': { pluginName: string; timestamp: Date };
  'plugin/unloaded': { pluginName: string; timestamp: Date };
  'service/provided': { serviceKey: string; timestamp: Date };
  'service/removed': { serviceKey: string; timestamp: Date };
  'session/created': { sessionId: string; metadata?: Record<string, unknown>; timestamp: Date };
  'session/closed': { sessionId: string; timestamp: Date };
  'step/start': { turn: number; step: number; timestamp: Date };
  'step/complete': { turn: number; step: number; durationMs: number; timestamp: Date };
  'model/called': { modelId: string; tokensIn?: number; tokensOut?: number; timestamp: Date };
  'tool/executed': { toolName: string; durationMs: number; success: boolean; timestamp: Date };
  error: { error: Error; context?: Record<string, unknown>; timestamp: Date };
}

export type EventHandler<K extends keyof EventMap> = (data: EventMap[K]) => void | Promise<void>;
