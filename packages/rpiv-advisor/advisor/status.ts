/**
 * status — the persistent footer indicator for the active advisor.
 *
 * Renders through `ctx.ui.setStatus("advisor", …)`, which Pi shows on its own
 * line under the stats/model footer line. The indicator answers "is an advisor
 * configured right now, and which one?" without the user re-running /advisor,
 * so it is synchronised from one place — {@link reconcileAdvisorTool} — which
 * every lifecycle path already funnels through.
 *
 * Pi renders extension status text verbatim: its footer applies
 * `sanitizeStatusText` (control characters only) and no theme, so an unthemed
 * string shows in the terminal's default foreground — bright white next to the
 * dim built-in footer. This module therefore colours the label itself.
 *
 * A stale indicator is worse than none: it is cleared on every path where the
 * advisor is disabled or can no longer be consulted because its model left the
 * registry, and a failed config save never reaches here, so the label always
 * reflects committed in-memory state. A blocklisted advisor is *not* cleared —
 * it stays visible with an `(inactive)` marker, since the reason it cannot be
 * used is the current executor, not the selection.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { modelKey } from "@juicesharp/rpiv-config";
import { ADVISOR_STATUS_INACTIVE, msgAdvisorStatus } from "./messages.ts";
import { getAdvisorEffort, getAdvisorModel } from "./state.ts";

/** Footer status key. Single advisor slot; distinct from other extensions' keys. */
export const ADVISOR_STATUS_KEY = "advisor";

/**
 * Build the themed footer string for a selection.
 *
 * `dim` mirrors the footer's own stats line and keeps the indicator secondary
 * to the model line; the `(inactive)` marker is lifted to `warning` because
 * that is the state the user needs to notice. When the host exposes no theme
 * (a test double, or a future host that drops the field) the plain uncoloured
 * string is returned, so the text is always present even when it cannot be
 * styled.
 */
export function formatAdvisorStatus(
	theme: { fg(color: string, text: string): string } | undefined,
	label: string,
	effort: Parameters<typeof msgAdvisorStatus>[1],
	inactive: boolean,
): string {
	const text = msgAdvisorStatus(label, effort);
	const suffix = inactive ? ` ${ADVISOR_STATUS_INACTIVE}` : "";
	if (!theme) return text + suffix;
	return theme.fg("dim", text) + (inactive ? theme.fg("warning", suffix) : "");
}

/**
 * Push the current advisor selection into the footer status line.
 *
 * - No advisor configured → clear the status (no stale label).
 * - Advisor configured → `Advisor: <provider/model> [• effort]`, marked
 *   `(inactive)` when the executor blocklist has stripped the tool, so a
 *   configured-but-unusable advisor is not mistaken for an active one.
 *
 * No-ops when the host cannot render UI. Called on every reconcile — including
 * ones that did not change tool membership — because effort changes and model
 * switches alter the label without touching the active-tool list. Re-setting an
 * identical string is cheap (Pi stores it in a Map) and `setStatus` centralises
 * the render request, so unconditional updates keep the label correct without a
 * change-detection cache that could itself go stale.
 */
export function updateAdvisorStatus(ctx: ExtensionContext | undefined, opts: { blocked: boolean }): void {
	if (!ctx?.hasUI) return;
	const model = getAdvisorModel();
	if (!model) {
		ctx.ui.setStatus(ADVISOR_STATUS_KEY, undefined);
		return;
	}
	const status = formatAdvisorStatus(ctx.ui.theme, modelKey(model), getAdvisorEffort(), opts.blocked);
	ctx.ui.setStatus(ADVISOR_STATUS_KEY, status);
}
