import "server-only";
import type { ModelProvider, ProviderResponse } from "./provider";

/**
 * A provider whose answer is supplied by the caller instead of a model.
 *
 * This is what makes the runtime loop provable without an API key or a
 * live model: the mechanics under test — restricting tools to what the
 * agent actually holds, executing an 'auto' tool call, withholding a
 * 'confirm' one — do not depend on what a model would say, only on what
 * the runtime does once something says it. Standing in a fixed answer
 * tests the loop; it is not a claim about how a real model would behave.
 */
export function createScriptedProvider(response: ProviderResponse): ModelProvider {
  return {
    id: "scripted",
    async complete() {
      return response;
    },
  };
}
