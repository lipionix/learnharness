import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import { createPracticeAgent, createProberAgent, createTeacherAgent, type AgentBuildOptions } from "../src/agent/teacher-agent.ts";
import type { PiEngine } from "../src/agent/models.ts";

function engine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: (model, context, options) => faux.streamSimple(model, context, options) };
}

const factories = [
	(opts: AgentBuildOptions) => createProberAgent({ chatId: opts.chatId, searchAvailable: () => false } as never, opts),
	(opts: AgentBuildOptions) => createTeacherAgent(undefined, opts),
	(opts: AgentBuildOptions) => createPracticeAgent({} as never, opts),
];

describe("session response language", () => {
	it("adds the explicit policy to every learner-facing agent without transcript pollution", () => {
		for (const factory of factories) {
			const agent = factory({ engine: engine(), chatId: "chat_language", tools: {}, responseLanguage: "es" });
			assert.match(agent.state.systemPrompt, /Write every learner-facing response in Spanish/);
			assert.ok(
				agent.state.messages
					.filter((message) => message.role !== "system")
					.every((message) => !JSON.stringify(message).includes("Write every learner-facing response in Spanish")),
			);
			assert.doesNotMatch(agent.state.systemPrompt, /latest substantive learner-authored input/);
		}
	});

	it("uses automatic guidance when selected", () => {
		const agent = factories[0]!({ engine: engine(), chatId: "chat_language_auto", tools: {}, responseLanguage: "automatic" });
		assert.match(agent.state.systemPrompt, /dominant language of their latest substantive learner-authored input/);
	});
});
