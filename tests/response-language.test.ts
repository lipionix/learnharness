import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import { createPracticeAgent, createProberAgent, createTeacherAgent, learnerSystemPrompt, type AgentBuildOptions } from "../src/agent/teacher-agent.ts";
import type { PiEngine } from "../src/agent/models.ts";
import { chatStore } from "../src/store/chats.ts";
const chatSettingsRoute = await import("../app/api/chats/[id]/settings/route.ts");

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
		assert.match(agent.state.systemPrompt, /identify the dominant communication language of the latest substantive learner-authored input/);
	});

	it("keeps the compaction prompt accounting on the same prompt source", () => {
		assert.equal(
			Math.ceil(learnerSystemPrompt("teacher", "fr").length / 4),
			Math.ceil(`${agentPrompt("teacher")}\n\n---\n\n${agentLanguage("fr")}`.length / 4),
		);
	});

	it("persists and reloads the per-session setting", () => {
		const chat = chatStore.createChat("response language test");
		try {
			chatStore.saveSettings(chat.id, { responseLanguage: "es" });
			assert.equal(chatStore.getChat(chat.id)?.settings?.responseLanguage, "es");
			chatStore.saveSettings(chat.id, {});
			assert.equal(chatStore.getChat(chat.id)?.settings?.responseLanguage, undefined);
		} finally {
			chatStore.deleteChat(chat.id);
		}
	});

	it("validates and persists the setting through the chat settings route", async () => {
		const chat = chatStore.createChat("response language route test");
		try {
			const response = await chatSettingsRoute.PUT(
				new Request("http://localhost/api/chats/test/settings", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ responseLanguage: "de" }),
				}),
				{ params: Promise.resolve({ id: chat.id }) },
			);
			assert.equal(response.status, 200);
			assert.equal((await response.json()).settings.responseLanguage, "de");
			assert.equal(chatStore.getChat(chat.id)?.settings?.responseLanguage, "de");

			const invalid = await chatSettingsRoute.PUT(
				new Request("http://localhost/api/chats/test/settings", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ responseLanguage: "xx" }),
				}),
				{ params: Promise.resolve({ id: chat.id }) },
			);
			assert.equal(invalid.status, 400);
			assert.equal(chatStore.getChat(chat.id)?.settings?.responseLanguage, "de");
		} finally {
			chatStore.deleteChat(chat.id);
		}
	});
});

function agentPrompt(kind: "teacher" | "practice"): string {
	return kind === "teacher"
		? factories[1]!({ engine: engine(), chatId: "prompt-accounting", tools: {} }).state.systemPrompt
		: factories[2]!({ engine: engine(), chatId: "prompt-accounting", tools: {} }).state.systemPrompt;
}

function agentLanguage(language: "fr"): string {
	return `## Response language\nWrite every learner-facing response in French.\nApply this to explanations, questions, quizzes, and practice problems. Keep code, formulas, identifiers, and quoted source text unchanged.`;
}
