import { ChatOpenRouter } from "@langchain/openrouter";

export const fastModel = new ChatOpenRouter({
  model: "openai/gpt-5-mini",
  temperature: 0,
  maxRetries: 3,
});

export const reasoningModel = new ChatOpenRouter({
  model: "x-ai/grok-4.1-fast",
  temperature: 0.1,
  maxTokens: 16000,
  maxRetries: 3,
});
