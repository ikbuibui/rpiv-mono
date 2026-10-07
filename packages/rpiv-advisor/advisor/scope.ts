/**
 * scope — decide which models the /advisor picker may offer.
 *
 * The picker follows Pi's *session-scoped* model set (`ctx.scopedModels` — the
 * same set `/scoped-models` and Ctrl+P cycling use) so a narrowed model list
 * also narrows what can be picked as an advisor. Hosts that predate the
 * `scopedModels` context field — and programmatic/test contexts that never set
 * it — read as "no scope configured" and fall back to every available model,
 * so /advisor is never accidentally emptied.
 *
 * The field is read structurally rather than through the peer types because
 * the package's pinned `@earendil-works/pi-coding-agent` peer predates it; the
 * same host-version tolerance `pi-compat.ts` applies to pi-ai entrypoints
 * applies here to context fields.
 *
 * The currently configured advisor always stays offered — even when it sits
 * outside the scope — so the picker can render its checkmark instead of
 * silently orphaning a model the user already chose. Models that vanished from
 * the registry are *not* resurrected: only entries the host still reports as
 * available are ever selectable.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Structural shape of the host's `ctx.scopedModels` entries. */
interface ScopedModelEntry {
	model?: Model<Api>;
}

/** Structural view of the context fields this module tolerates on old hosts. */
interface ScopedModelsCarrier {
	scopedModels?: readonly ScopedModelEntry[];
}

/** Provider+id identity — deliberately not `modelKey`, whose joined string is
 *  ambiguous when a model id itself contains `/`. */
function isSameModel(a: Model<Api>, b: Model<Api>): boolean {
	return a.provider === b.provider && a.id === b.id;
}

/**
 * Read the session-scoped models from the extension context.
 *
 * Returns the unwrapped `Model` of each entry. A host without the field, a
 * non-array value, or entries missing `model` all read as "no scope", which
 * keeps older hosts and bare test contexts on the all-models fallback.
 */
export function getScopedModels(ctx: ExtensionContext | undefined): Model<Api>[] {
	const scoped = (ctx as ScopedModelsCarrier | undefined)?.scopedModels;
	if (!Array.isArray(scoped)) return [];
	return scoped.flatMap((entry) => (entry?.model ? [entry.model] : []));
}

/**
 * Choose the models the /advisor picker offers, in display order.
 *
 * - No scope configured → every available model (the pre-scoping behaviour).
 * - Scope configured → the available models inside the scope, in scope order.
 *   A scoped pattern that no longer resolves is simply absent, so stale scoped
 *   entries never become newly selectable.
 * - The current advisor is moved to the front when the registry still reports
 *   it available, so its checkmark stays visible regardless of scope. An
 *   unavailable current advisor is dropped like any other missing model.
 *
 * Every returned object is the one from `available`, never the `scoped` or
 * `current` instance: scoped entries and the in-memory selection are snapshots
 * that can predate a registry refresh (rotated credentials, changed reasoning
 * support, a new endpoint), and handing a stale object to `/advisor` would
 * persist or query against outdated metadata. Identity is provider+id; the
 * available instance is the source of truth.
 *
 * The result never contains the same provider+id twice.
 */
export function selectAdvisorCandidates(options: {
	available: readonly Model<Api>[];
	scoped: readonly Model<Api>[];
	current?: Model<Api>;
}): Model<Api>[] {
	const { available, scoped, current } = options;
	const find = (model: Model<Api>): Model<Api> | undefined => available.find((a) => isSameModel(a, model));

	if (scoped.length > 0) {
		// Map each scoped snapshot onto its available counterpart, dropping
		// entries the registry no longer reports.
		const inScope = scoped.flatMap((model) => {
			const live = find(model);
			return live ? [live] : [];
		});
		const liveCurrent = current ? find(current) : undefined;
		return dedupe(liveCurrent ? [liveCurrent, ...inScope] : inScope);
	}

	// No scope: every available model, with the current one promoted to the
	// front (using its available instance) so its checkmark is visible early.
	const liveCurrent = current ? find(current) : undefined;
	return liveCurrent ? dedupe([liveCurrent, ...available]) : dedupe(available);
}

function dedupe(models: readonly Model<Api>[]): Model<Api>[] {
	const seen = new Set<string>();
	const result: Model<Api>[] = [];
	for (const model of models) {
		const key = `${model.provider}\0${model.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(model);
	}
	return result;
}
