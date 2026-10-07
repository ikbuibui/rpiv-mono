import type { Api, Model } from "@earendil-works/pi-ai";
import { createMockCtx, createMockPi, type MockCtxOptions } from "@juicesharp/rpiv-test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./advisor-ui.js", () => ({
	showAdvisorPicker: vi.fn(),
	showEffortPicker: vi.fn(),
}));

import { registerAdvisorCommand, setAdvisorModel } from "./advisor/index.js";
import { getScopedModels, selectAdvisorCandidates } from "./advisor/scope.js";
import { showAdvisorPicker, showEffortPicker } from "./advisor-ui.js";

const opus = { provider: "anthropic", id: "opus", name: "Opus" } as unknown as Model<Api>;
const sonnet = { provider: "anthropic", id: "sonnet", name: "Sonnet" } as unknown as Model<Api>;
const gpt = { provider: "openai", id: "gpt", name: "GPT" } as unknown as Model<Api>;
// Same bare id under two providers — the collision case a joined "provider/id"
// string could not tell apart for ids containing "/".
const shared = (provider: string) => ({ provider, id: "shared/one", name: "Shared" }) as unknown as Model<Api>;

beforeEach(() => {
	vi.mocked(showAdvisorPicker).mockReset();
	vi.mocked(showEffortPicker).mockReset();
});

/** Model keys the picker was actually offered, in order. */
function offeredKeys(): string[] {
	const items = vi.mocked(showAdvisorPicker).mock.calls.at(-1)?.[1] ?? [];
	return items.map((item) => item.value);
}

function runPicker(opts: MockCtxOptions) {
	const { pi, captured } = createMockPi();
	registerAdvisorCommand(pi);
	return { pi, ctx: createMockCtx(opts), handler: captured.commands.get("advisor")?.handler };
}

describe("getScopedModels", () => {
	it("returns [] when the host has no scopedModels field", () => {
		expect(getScopedModels({} as never)).toEqual([]);
	});

	it("returns [] when the field is present but not an array", () => {
		expect(getScopedModels({ scopedModels: "nope" } as never)).toEqual([]);
	});

	it("unwraps entries and skips ones without a model", () => {
		const ctx = { scopedModels: [{ model: opus }, { thinkingLevel: "high" }, { model: gpt }] } as never;
		expect(getScopedModels(ctx)).toEqual([opus, gpt]);
	});
});

describe("selectAdvisorCandidates", () => {
	it("offers every available model when no scope is configured", () => {
		expect(selectAdvisorCandidates({ available: [opus, sonnet, gpt], scoped: [] })).toEqual([opus, sonnet, gpt]);
	});

	it("offers only in-scope models when a scope is configured", () => {
		expect(selectAdvisorCandidates({ available: [opus, sonnet, gpt], scoped: [sonnet, gpt] })).toEqual([sonnet, gpt]);
	});

	it("drops scoped entries the registry no longer reports (stale patterns)", () => {
		expect(selectAdvisorCandidates({ available: [opus], scoped: [sonnet, opus] })).toEqual([opus]);
	});

	it("keeps the current advisor even when it is outside the scope", () => {
		expect(selectAdvisorCandidates({ available: [opus, sonnet], scoped: [opus], current: sonnet })).toEqual([
			sonnet,
			opus,
		]);
	});

	it("keeps the current advisor when no scope is configured, without duplicating it", () => {
		expect(selectAdvisorCandidates({ available: [opus, gpt], scoped: [], current: gpt })).toEqual([gpt, opus]);
	});

	it("drops an unavailable current advisor (no resurrecting from memory)", () => {
		expect(selectAdvisorCandidates({ available: [opus], scoped: [], current: sonnet })).toEqual([opus]);
	});

	it("never repeats the same provider+id", () => {
		expect(selectAdvisorCandidates({ available: [opus], scoped: [opus], current: opus })).toEqual([opus]);
	});

	it("distinguishes same model id under different providers", () => {
		const a = shared("alpha");
		const b = shared("beta");
		expect(selectAdvisorCandidates({ available: [a, b], scoped: [a, b] })).toEqual([a, b]);
	});

	it("returns the available instance, not a stale scoped snapshot", () => {
		const live = {
			provider: "anthropic",
			id: "opus",
			reasoning: true,
			contextWindow: 200000,
		} as unknown as Model<Api>;
		const stale = {
			provider: "anthropic",
			id: "opus",
			reasoning: false,
			contextWindow: 32000,
		} as unknown as Model<Api>;
		expect(selectAdvisorCandidates({ available: [live], scoped: [stale] })).toEqual([live]);
	});

	it("returns the available instance when the current advisor is stale", () => {
		const live = { provider: "anthropic", id: "opus", reasoning: true } as unknown as Model<Api>;
		const stale = { provider: "anthropic", id: "opus", reasoning: false } as unknown as Model<Api>;
		expect(selectAdvisorCandidates({ available: [live], scoped: [], current: stale })).toEqual([live]);
	});

	it("returns the available instance for a stale out-of-scope current advisor", () => {
		const liveCurrent = { provider: "anthropic", id: "sonnet", reasoning: true } as unknown as Model<Api>;
		const staleCurrent = { provider: "anthropic", id: "sonnet", reasoning: false } as unknown as Model<Api>;
		const result = selectAdvisorCandidates({ available: [opus, liveCurrent], scoped: [opus], current: staleCurrent });
		expect(result).toEqual([liveCurrent, opus]);
	});
});

describe("/advisor — scoped picker", () => {
	it("offers all available models when the session has no scope", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		const { ctx, handler } = runPicker({ hasUI: true, models: [opus, gpt] });
		await handler?.("", ctx as never);
		expect(offeredKeys()).toEqual(["anthropic/opus", "openai/gpt", "__no_advisor__"]);
	});

	it("offers only scoped models when a scope is configured", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		const { ctx, handler } = runPicker({
			hasUI: true,
			models: [opus, sonnet, gpt],
			scopedModels: [{ model: gpt }],
		});
		await handler?.("", ctx as never);
		expect(offeredKeys()).toEqual(["openai/gpt", "__no_advisor__"]);
	});

	it("still offers the current advisor when it sits outside the scope", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		setAdvisorModel(sonnet);
		const { ctx, handler } = runPicker({
			hasUI: true,
			models: [opus, sonnet, gpt],
			scopedModels: [{ model: gpt }],
		});
		await handler?.("", ctx as never);
		expect(offeredKeys()).toEqual(["anthropic/sonnet", "openai/gpt", "__no_advisor__"]);
	});

	it("marks the kept out-of-scope advisor with the checkmark", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		setAdvisorModel(sonnet);
		const { ctx, handler } = runPicker({
			hasUI: true,
			models: [opus, sonnet],
			scopedModels: [{ model: opus }],
		});
		await handler?.("", ctx as never);
		const items = vi.mocked(showAdvisorPicker).mock.calls.at(-1)?.[1] ?? [];
		const current = items.find((item) => item.value === "anthropic/sonnet");
		expect(current?.label).toContain("✓");
	});

	it("does not offer a scoped model the registry no longer reports", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		const { ctx, handler } = runPicker({
			hasUI: true,
			models: [opus],
			scopedModels: [{ model: sonnet }, { model: opus }],
		});
		await handler?.("", ctx as never);
		expect(offeredKeys()).toEqual(["anthropic/opus", "__no_advisor__"]);
	});

	it("resolves a picked model through the offered set (enable path)", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("openai/gpt");
		const { pi, ctx, handler } = runPicker({
			hasUI: true,
			models: [opus, gpt],
			scopedModels: [{ model: gpt }],
		});
		await handler?.("", ctx as never);
		expect(pi.setActiveTools).toHaveBeenCalledWith(expect.arrayContaining(["advisor"]));
		expect(ctx.ui.notify).toHaveBeenCalledWith("Advisor: openai/gpt", "info");
	});

	it("reports selection-not-found for a value outside the offered set", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("anthropic/opus");
		const { ctx, handler } = runPicker({
			hasUI: true,
			models: [opus, gpt],
			scopedModels: [{ model: gpt }],
		});
		await handler?.("", ctx as never);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Advisor selection not found"), "error");
	});

	it("re-reads the scope on each invocation (scope changes mid-session)", async () => {
		const { ctx, handler } = runPicker({ hasUI: true, models: [opus, gpt], scopedModels: [{ model: gpt }] });
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		await handler?.("", ctx as never);
		expect(offeredKeys()).toEqual(["openai/gpt", "__no_advisor__"]);

		(ctx as unknown as { scopedModels: unknown }).scopedModels = [{ model: gpt }, { model: opus }];
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce(null);
		await handler?.("", ctx as never);
		expect(offeredKeys()).toEqual(["openai/gpt", "anthropic/opus", "__no_advisor__"]);
	});
});
