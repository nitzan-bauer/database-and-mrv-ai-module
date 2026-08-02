import "server-only";
import type { ModelProvider } from "./provider";

/**
 * The stand-in used whenever ANTHROPIC_API_KEY is not set — which, on this
 * deployment right now, is always.
 *
 * It never invokes a tool. A provider that "reasoned" its way to a tool
 * call without any actual reasoning behind it would be indistinguishable
 * on screen from one that did — the same failure this build has refused
 * everywhere else, from GHG inputs to baseline sites: a plausible-looking
 * value standing in for a real one. So this returns text, always, and the
 * text says plainly that no model is configured rather than attempting a
 * scripted imitation of one.
 */
export function getNoKeyProvider(): ModelProvider {
  return {
    id: "no-model-configured",
    async complete() {
      return {
        kind: "text",
        text:
          "No model API key is configured on this deployment, so there is no reasoning behind " +
          "this response. Set ANTHROPIC_API_KEY (and optionally AGENT_MODEL_ID) to enable it.",
      };
    },
  };
}
