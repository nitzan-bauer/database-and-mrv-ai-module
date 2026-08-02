import "server-only";

/**
 * The model provider boundary for the Verified Credits Factory runtime.
 *
 * Every agent — Dave, Rebeka, the ones after them — reasons through the
 * same shape: a system prompt (the agent's own role_prompt, verbatim, from
 * mrv.agents), one user message, and the JSON schemas of the tools that
 * agent actually holds. What answers that call is swappable, and has to
 * be: whether a model key exists is a fact about this deployment, not
 * about the agents, and the runtime must behave identically in shape
 * whichever provider is behind it — only the actual reasoning differs.
 *
 * This is why the interface exists at all rather than calling Anthropic's
 * API directly from the runtime: a test has to be able to prove the loop
 * — schema assembly, tool restriction, the auto/confirm gate — without an
 * API key or a live model, and a deployment with no key configured has to
 * say so honestly rather than crash or fabricate a response.
 */

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's input, as Anthropic's tool-use format expects. */
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolCall {
  name: string;
  input: Record<string, unknown>;
}

export type ProviderResponse =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; call: ProviderToolCall; text?: string };

export interface ModelProvider {
  /** Identifies what actually answered — shown in the UI so a response is never presented as more than it is. */
  readonly id: string;
  complete(args: { system: string; userMessage: string; tools: ToolSchema[] }): Promise<ProviderResponse>;
}

/**
 * Picks a provider from the environment. No key configured is not an
 * error state to work around — it is the true current state of this
 * deployment, and getNoKeyProvider() says so in its response rather than
 * this function throwing or silently degrading.
 */
export async function getConfiguredProvider(): Promise<ModelProvider> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    const { getNoKeyProvider } = await import("./noKeyProvider");
    return getNoKeyProvider();
  }
  const { createAnthropicProvider } = await import("./anthropicProvider");
  return createAnthropicProvider(apiKey, process.env.AGENT_MODEL_ID?.trim() || "claude-sonnet-5");
}
