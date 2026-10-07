import type { Api, Model } from "@earendil-works/pi-ai";
import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./advisor-ui.js", () => ({
	showAdvisorPicker: vi.fn(),
	showEffortPicker: vi.fn(),
}));

import {
	ADVISOR_TOOL_NAME,
	registerAdvisorCommand,
	registerAdvisorSessionStart,
	registerModelSelectHandler,
	registerThinkingLevelSelectHandler,
	setAdvisorEffort,
	setAdvisorModel,
	setDisabledForModels,
} from "./advisor/index.js";
import { ADVISOR_STATUS_KEY, formatAdvisorStatus } from "./advisor/status.js";
import { showAdvisorPicker, showEffortPicker } from "./advisor-ui.js";

const modelA = { provider: "anthropic", id: "opus", name: "Opus" } as unknown as Model<Api>;
const modelR = { provider: "anthropic", id: "opus-r", name: "Opus R", reasoning: true } as unknown as Model<Api>;
const modelBlocked = { provider: "anthropic", id: "sonnet", name: "Sonnet" } as unknown as Model<Api>;

beforeEach(() => {
	vi.mocked(showAdvisorPicker).mockReset();
	vi.mocked(showEffortPicker).mockReset();
});

/**
 * Last text pushed to the advisor status slot, with any theme escapes stripped.
 * The mock ctx exposes no theme, so production code emits the plain string;
 * this strips escapes anyway so the helper stays correct if a theme is added.
 */
function lastStatus(ctx: ReturnType<typeof createMockCtx>): string | undefined {
	const calls = vi.mocked(ctx.ui.setStatus).mock.calls.filter(([key]) => key === ADVISOR_STATUS_KEY);
	const text = calls.at(-1)?.[1];
	return text === undefined ? undefined : text.replace(/\x1b\[[0-9;]*m/g, "");
}

function registerCommand() {
	const { pi, captured } = createMockPi();
	registerAdvisorCommand(pi);
	return { pi, handler: captured.commands.get("advisor")?.handler };
}

describe("advisor status — enable path", () => {
	it("shows the advisor with its effort after /advisor selects one", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("anthropic/opus-r");
		vi.mocked(showEffortPicker).mockResolvedValueOnce("medium");
		const { handler } = registerCommand();
		const ctx = createMockCtx({ hasUI: true, models: [modelR], model: modelA });
		await handler?.("", ctx as never);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus-r • medium");
	});

	it("omits the effort when the model has none set", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("anthropic/opus");
		const { handler } = registerCommand();
		const ctx = createMockCtx({ hasUI: true, models: [modelA], model: modelA });
		await handler?.("", ctx as never);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus");
	});

	it("marks the advisor inactive when the executor blocklist strips it", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("anthropic/opus");
		setDisabledForModels(["anthropic:sonnet"]);
		const { handler } = registerCommand();
		const ctx = createMockCtx({ hasUI: true, models: [modelA], model: modelBlocked });
		await handler?.("", ctx as never);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus (inactive)");
	});
});

describe("advisor status — disable path", () => {
	it("clears the indicator when No advisor is chosen", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("__no_advisor__");
		setAdvisorModel(modelA);
		const { handler } = registerCommand();
		const ctx = createMockCtx({ hasUI: true, models: [modelA], model: modelA });
		await handler?.("", ctx as never);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith(ADVISOR_STATUS_KEY, undefined);
	});

	it("does not touch the indicator when the disable-path save fails", async () => {
		if (process.platform === "win32") return;
		const { mkdirSync, rmSync } = await import("node:fs");
		const { dirname, join } = await import("node:path");
		const configPath = join(process.env.HOME!, ".config", "rpiv-advisor", "advisor.json");
		mkdirSync(dirname(configPath), { recursive: true });
		mkdirSync(configPath, { recursive: true });
		try {
			vi.mocked(showAdvisorPicker).mockResolvedValueOnce("__no_advisor__");
			setAdvisorModel(modelA);
			const { handler } = registerCommand();
			const ctx = createMockCtx({ hasUI: true, models: [modelA], model: modelA });
			await handler?.("", ctx as never);
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Failed to save advisor selection"),
				"error",
			);
			expect(ctx.ui.setStatus).not.toHaveBeenCalled();
		} finally {
			rmSync(configPath, { recursive: true, force: true });
		}
	});

	it("does not touch the indicator when the enable-path save fails", async () => {
		if (process.platform === "win32") return;
		const { mkdirSync, rmSync } = await import("node:fs");
		const { dirname, join } = await import("node:path");
		const configPath = join(process.env.HOME!, ".config", "rpiv-advisor", "advisor.json");
		mkdirSync(dirname(configPath), { recursive: true });
		mkdirSync(configPath, { recursive: true });
		try {
			vi.mocked(showAdvisorPicker).mockResolvedValueOnce("anthropic/opus");
			setAdvisorModel(modelA);
			const { handler } = registerCommand();
			const ctx = createMockCtx({ hasUI: true, models: [modelA], model: modelA });
			await handler?.("", ctx as never);
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Failed to save advisor selection"),
				"error",
			);
			expect(ctx.ui.setStatus).not.toHaveBeenCalled();
		} finally {
			rmSync(configPath, { recursive: true, force: true });
		}
	});
});

describe("advisor status — session restore", () => {
	async function writeConfig(contents: unknown): Promise<void> {
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const { dirname, join } = await import("node:path");
		const configPath = join(process.env.HOME!, ".config", "rpiv-advisor", "advisor.json");
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(contents));
	}

	it("shows the restored advisor at session start", async () => {
		await writeConfig({ modelKey: "anthropic/opus", effort: "high" });
		const { pi, captured } = createMockPi();
		registerAdvisorSessionStart(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelA, models: [modelA] });
		await captured.events.get("session_start")?.[0]?.({} as never, ctx as never);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus • high");
	});

	it("marks a restored-but-blocked advisor inactive", async () => {
		await writeConfig({ modelKey: "anthropic/opus", disabledForModels: ["anthropic:sonnet"] });
		const { pi, captured } = createMockPi();
		registerAdvisorSessionStart(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelBlocked, models: [modelA] });
		await captured.events.get("session_start")?.[0]?.({} as never, ctx as never);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus (inactive)");
	});

	it("clears the indicator when no advisor is configured", async () => {
		await writeConfig({});
		const { pi, captured } = createMockPi();
		registerAdvisorSessionStart(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelA, models: [modelA] });
		await captured.events.get("session_start")?.[0]?.({} as never, ctx as never);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith(ADVISOR_STATUS_KEY, undefined);
	});

	it("clears the indicator when the configured model vanished from the registry", async () => {
		await writeConfig({ modelKey: "anthropic/gone" });
		const { pi, captured } = createMockPi();
		registerAdvisorSessionStart(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelA, models: [modelA] });
		await captured.events.get("session_start")?.[0]?.({} as never, ctx as never);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith(ADVISOR_STATUS_KEY, undefined);
	});
});

describe("advisor status — mid-session model and effort changes", () => {
	it("goes inactive when switching to a blocklisted executor", async () => {
		setAdvisorModel(modelA);
		setAdvisorEffort("high");
		setDisabledForModels(["anthropic:sonnet"]);
		const { pi, captured } = createMockPi();
		registerModelSelectHandler(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelBlocked });
		await captured.events.get("model_select")?.[0]?.(
			{ model: modelBlocked, previousModel: modelA, source: "set" } as never,
			ctx as never,
		);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus • high (inactive)");
	});

	it("goes active again when the executor stops being blocklisted", async () => {
		setAdvisorModel(modelA);
		setDisabledForModels(["anthropic:sonnet"]);
		const { pi, captured } = createMockPi();
		registerModelSelectHandler(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelA });
		await captured.events.get("model_select")?.[0]?.(
			{ model: modelA, previousModel: modelBlocked, source: "set" } as never,
			ctx as never,
		);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus");
	});

	it("reflects an effort-threshold block triggered by a thinking-level change", async () => {
		setAdvisorModel(modelA);
		setDisabledForModels([{ model: "anthropic:sonnet", minEffort: "high" }]);
		const { pi, captured } = createMockPi();
		registerThinkingLevelSelectHandler(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelBlocked });
		await captured.events.get("thinking_level_select")?.[0]?.(
			{ type: "thinking_level_select", level: "high", previousLevel: "low" } as never,
			ctx as never,
		);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus (inactive)");
	});

	it("keeps the label when the tool set is unchanged (no membership churn)", async () => {
		setAdvisorModel(modelA);
		setDisabledForModels(["anthropic:sonnet"]);
		const { pi, captured } = createMockPi();
		// Advisor already active; switching to a non-blocked executor changes no
		// membership, but the status must still be (re)asserted.
		pi.setActiveTools([ADVISOR_TOOL_NAME]);
		registerModelSelectHandler(pi);
		const ctx = createMockCtx({ hasUI: true, model: modelA });
		await captured.events.get("model_select")?.[0]?.(
			{ model: modelA, previousModel: modelA, source: "set" } as never,
			ctx as never,
		);
		expect(lastStatus(ctx)).toBe("Advisor: anthropic/opus");
	});
});

describe("advisor status — no UI", () => {
	it("does not call setStatus when the host has no UI", async () => {
		vi.mocked(showAdvisorPicker).mockResolvedValueOnce("anthropic/opus");
		const { handler } = registerCommand();
		const ctx = createMockCtx({ hasUI: false, models: [modelA] });
		await handler?.("", ctx as never);
		expect(ctx.ui.setStatus).not.toHaveBeenCalled();
	});
});

describe("formatAdvisorStatus — theming", () => {
	/** Records the colour name each fragment was wrapped in. */
	const theme = {
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	};

	it("dims the whole label and no suffix when active", () => {
		expect(formatAdvisorStatus(theme, "anthropic/opus", "high", false)).toBe(
			"<dim>Advisor: anthropic/opus • high</dim>",
		);
	});

	it("lifts only the (inactive) marker to warning", () => {
		expect(formatAdvisorStatus(theme, "anthropic/opus", undefined, true)).toBe(
			"<dim>Advisor: anthropic/opus</dim><warning> (inactive)</warning>",
		);
	});

	it("returns the plain string when the host exposes no theme", () => {
		expect(formatAdvisorStatus(undefined, "anthropic/opus", "medium", false)).toBe(
			"Advisor: anthropic/opus • medium",
		);
		expect(formatAdvisorStatus(undefined, "anthropic/opus", undefined, true)).toBe(
			"Advisor: anthropic/opus (inactive)",
		);
	});
});
