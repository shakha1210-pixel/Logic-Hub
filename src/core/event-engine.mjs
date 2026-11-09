/**
 * LogicHub Event Engine
 *
 * Pure orchestration layer. Consumers must be deterministic and side-effect
 * free; persist the returned state atomically only after the full pipeline
 * succeeds. Do not register browser/client callbacks as authoritative consumers.
 */
import { applyGameCompleted, EVENT_TYPES } from "./logic-hub-core.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createEventEngine({ policy, consumers = [] } = {}) {
  if (!isObject(policy)) throw new TypeError("A reward policy is required");
  if (!Array.isArray(consumers)) throw new TypeError("consumers must be an array");

  const registry = new Map();

  function register(consumer) {
    if (!isObject(consumer) || typeof consumer.id !== "string" || !consumer.id.trim()) {
      throw new TypeError("Each consumer requires a non-empty id");
    }
    if (typeof consumer.handle !== "function") {
      throw new TypeError(`Consumer ${consumer.id} requires a handle function`);
    }
    if (registry.has(consumer.id)) throw new Error(`Duplicate consumer id: ${consumer.id}`);

    const eventTypes = consumer.eventTypes ?? [EVENT_TYPES.GAME_COMPLETED];
    if (!Array.isArray(eventTypes) || eventTypes.length === 0 ||
        eventTypes.some((type) => typeof type !== "string" || !type.trim())) {
      throw new TypeError(`Consumer ${consumer.id} has invalid eventTypes`);
    }

    registry.set(consumer.id, { ...consumer, eventTypes: [...eventTypes] });
    return () => registry.delete(consumer.id);
  }

  for (const consumer of consumers) register(consumer);

  function process(state, event) {
    if (!isObject(event)) throw new TypeError("event must be an object");
    if (event.type !== EVENT_TYPES.GAME_COMPLETED) {
      throw new TypeError(`Unsupported event type: ${String(event.type)}`);
    }

    const coreResult = applyGameCompleted(state, event, policy);
    if (coreResult.duplicate) {
      return { state: coreResult.state, duplicate: true, emitted: [], consumerResults: [] };
    }

    let nextState = coreResult.state;
    const emitted = [...coreResult.emitted];
    const consumerResults = [];

    for (const consumer of registry.values()) {
      if (!consumer.eventTypes.includes(event.type)) continue;

      // Consumers are pure state transformers. If one throws, no returned
      // state is committed by the caller.
      const result = consumer.handle({
        event: Object.freeze({ ...event, result: Object.freeze({ ...event.result }) }),
        state: nextState,
        emitted: [...emitted],
      });

      if (!isObject(result)) {
        throw new TypeError(`Consumer ${consumer.id} must return an object`);
      }
      if (result.state !== undefined) {
        if (!isObject(result.state)) throw new TypeError(`Consumer ${consumer.id} returned invalid state`);
        nextState = result.state;
      }
      const consumerEvents = result.emitted ?? [];
      if (!Array.isArray(consumerEvents)) {
        throw new TypeError(`Consumer ${consumer.id} emitted must be an array`);
      }
      emitted.push(...consumerEvents);
      consumerResults.push({ consumerId: consumer.id, result: result.result ?? null });
    }

    return { state: nextState, duplicate: false, emitted, consumerResults };
  }

  return Object.freeze({
    process,
    register,
    listConsumers: () => [...registry.keys()],
  });
}
