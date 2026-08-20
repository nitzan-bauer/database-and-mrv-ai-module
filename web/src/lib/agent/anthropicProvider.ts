import "server-only";
import type { ModelProvider, ProviderResponse } from "./provider";

/**
 * The real provider, talking to Claude's Messages API directly over
 * `fetch` rather than through the Anthropic SDK. The module has no other
 * network-API dependency and everything else here (the .xlsx and .docx
 * readers, the KML export) was built the same way — trusting one more
 * package is a bigger commitment than one documented HTTP call, for a
 * request shape this small and this stable.
 *
 * A non-2xx response throws, deliberately. Faking a text answer out of a
 * failed request would hide the failure from whoever is looking at the
 * conversation; the runtime layer is what decides how to present an
 * error, not this one.
 *
 * The request carries an explicit timeout — confirmed live this session:
 * an unattended scheduled task calling this with no timeout at all sat
 * for 57+ seconds inside a single call with zero response, consuming a
 * whole serverless invocation's entire budget before Vercel's own hard
 * ceiling killed it. A caller with a person watching (the chat loop) can
 * wait; an unattended one needs this call to fail fast and let the
 * caller's own retry-next-time logic handle it instead.
 */
const COMPLETE_TIMEOUT_MS = 15_000;

export function createAnthropicProvider(apiKey: string, model: string): ModelProvider {
  return {
    id: `anthropic:${model}`,

    async complete({ system, userMessage, tools }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COMPLETE_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1536,
            system,
            messages: [{ role: "user", content: userMessage }],
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }),
        });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          throw new Error(`Anthropic API call timed out after ${COMPLETE_TIMEOUT_MS}ms`);
        }
        throw e;
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        content?: Array<
          { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown }
        >;
      };
      const blocks = data.content ?? [];

      const toolUse = blocks.find(
        (b): b is { type: "tool_use"; name: string; input: unknown } => b.type === "tool_use",
      );
      const text = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const response: ProviderResponse = toolUse
        ? {
            kind: "tool_call",
            call: { name: toolUse.name, input: (toolUse.input as Record<string, unknown>) ?? {} },
            text: text || undefined,
          }
        : { kind: "text", text };
      return response;
    },
  };
}
