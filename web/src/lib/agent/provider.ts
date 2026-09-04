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

export type ProviderResponse = (
  | { kind: "text"; text: string }
  | { kind: "tool_call"; call: ProviderToolCall; text?: string }
) & {
  /**
   * How many real web searches the server actually executed for this call
   * (Anthropic's own `usage.server_tool_use.web_search_requests`), only
   * present when `webSearch` was requested. Lets a caller tell "searched
   * and genuinely found nothing" apart from "the search tool never ran" —
   * confirmed live this session as a real, silent gap: a scheduled task
   * reporting "no deals found this month" looked identical to one where
   * websearch failed outright, with no way to flag the second as a bug.
   */
  webSearchesPerformed?: number;
};

export interface ModelProvider {
  /** Identifies what actually answered — shown in the UI so a response is never presented as more than it is. */
  readonly id: string;
  complete(args: {
    system: string;
    userMessage: string;
    tools: ToolSchema[];
    /**
     * Anthropic's own hosted web-search tool (Nitzan's own instruction:
     * broad-web-search capability should be available to every agent, not
     * just the one task it was first built for) — the model decides on its
     * own whether and how many times to search, up to maxUses, and the
     * server executes each search itself. Ignored by providers that can't
     * offer it (no-key stand-in included) rather than erroring.
     */
    webSearch?: { maxUses?: number; timeoutMs?: number };
    /**
     * Overrides the call's own timeout regardless of webSearch — for a
     * caller with a person actually watching (an interactive "Ask <Agent>"
     * chat turn), which can and should wait longer than the flat default
     * built for an unattended scheduled task sharing one serverless
     * invocation's budget with other due tasks.
     */
    timeoutMs?: number;
    /**
     * Overrides the call's own max_tokens. Confirmed live this session: a
     * large attached document pushed claude-sonnet-5 to spend nearly all of
     * the default 1536-token budget on its own internal "thinking" content
     * block, leaving no room to emit any actual answer text (stop_reason
     * "max_tokens", empty response) — thinking tokens count against this
     * same budget. A caller expecting to hand over a lot of real content
     * (an interactive turn with an attachment) needs materially more room
     * than the default.
     */
    maxTokens?: number;
  }): Promise<ProviderResponse>;
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
