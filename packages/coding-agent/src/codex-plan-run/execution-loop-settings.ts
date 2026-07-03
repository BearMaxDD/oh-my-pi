import type { PlanRunDriverInput } from "./driver";

export type ExecutionLoopMode = "off" | "role-bound" | "hybrid";
export type ExecutionLoopGateMode = "off" | "advisory" | "required";

export interface ExecutionLoopSettingsReader {
	get(key: string): unknown;
}

export interface ExecutionLoopSettingsBlocker {
	reason: "invalid_runtime_allowed_environments" | "invalid_execution_loop_mode" | "invalid_gate_mode";
	message: string;
}

type DriverGateFields = Pick<
	PlanRunDriverInput,
	| "enableRoleBoundExecution"
	| "enableAdvisorGate"
	| "enableGlobalImpactGate"
	| "enableRealBusinessSimulationGate"
	| "superpowersGateMode"
>;

export interface ResolvedExecutionLoopSettings {
	driverDefaults: DriverGateFields;
	blockers: ExecutionLoopSettingsBlocker[];
	runtimeScenario: {
		browser: { enabled: boolean };
		api: { enabled: boolean };
		database: { enabled: boolean };
	};
	classification: {
		enabled: boolean;
		requireReviewerEvidence: boolean;
	};
}

export function resolveExecutionLoopSettings(options: {
	settings: ExecutionLoopSettingsReader;
	overrides?: Partial<DriverGateFields>;
}): ResolvedExecutionLoopSettings {
	const { settings, overrides } = options;

	const mode = (settings.get("superpowers.executionLoop.mode") as ExecutionLoopMode | undefined) ?? "role-bound";

	// When mode is off, all productized gates are disabled.
	if (mode === "off") {
		const driverDefaults: DriverGateFields = {
			enableRoleBoundExecution: false,
			enableAdvisorGate: false,
			enableGlobalImpactGate: false,
			enableRealBusinessSimulationGate: false,
			superpowersGateMode: "off",
		};
		applyOverrides(driverDefaults, overrides);
		return {
			driverDefaults,
			blockers: [],
			runtimeScenario: {
				browser: {
					enabled: readBool(settings, "superpowers.executionLoop.runtimeScenario.browser.enabled", false),
				},
				api: { enabled: readBool(settings, "superpowers.executionLoop.runtimeScenario.api.enabled", false) },
				database: {
					enabled: readBool(settings, "superpowers.executionLoop.runtimeScenario.database.enabled", false),
				},
			},
			classification: {
				enabled: readBool(settings, "superpowers.executionLoop.classification.enabled", true),
				requireReviewerEvidence: readBool(
					settings,
					"superpowers.executionLoop.classification.requireReviewerEvidence",
					true,
				),
			},
		};
	}

	// Read individual settings with safe defaults.
	const roleBoundEnabled = readBool(settings, "superpowers.executionLoop.roleBoundExecution.enabled", true);
	const advisorEnabled = readBool(settings, "superpowers.executionLoop.roleBoundExecution.requireAdvisorGate", true);
	const globalImpactEnabled = readBool(settings, "superpowers.executionLoop.globalImpactGate.enabled", true);
	const globalImpactMode = readString(
		settings,
		"superpowers.executionLoop.globalImpactGate.mode",
		"required",
	) as ExecutionLoopGateMode;
	const runtimeEnabled = readBool(settings, "superpowers.executionLoop.realBusinessSimulationGate.enabled", true);

	const runtimeScenario = {
		browser: { enabled: readBool(settings, "superpowers.executionLoop.runtimeScenario.browser.enabled", false) },
		api: { enabled: readBool(settings, "superpowers.executionLoop.runtimeScenario.api.enabled", false) },
		database: { enabled: readBool(settings, "superpowers.executionLoop.runtimeScenario.database.enabled", false) },
	};
	const classification = {
		enabled: readBool(settings, "superpowers.executionLoop.classification.enabled", true),
		requireReviewerEvidence: readBool(
			settings,
			"superpowers.executionLoop.classification.requireReviewerEvidence",
			true,
		),
	};

	const driverDefaults: DriverGateFields = {
		enableRoleBoundExecution: roleBoundEnabled,
		enableAdvisorGate: advisorEnabled,
		enableGlobalImpactGate: globalImpactEnabled,
		enableRealBusinessSimulationGate: runtimeEnabled,
		superpowersGateMode: globalImpactMode,
	};

	applyOverrides(driverDefaults, overrides);

	// Collect blockers.
	const blockers: ExecutionLoopSettingsBlocker[] = [];

	if (driverDefaults.enableRealBusinessSimulationGate) {
		const allowedEnvironments = settings.get(
			"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments",
		) as string[] | undefined;
		if (!hasValidEnvironment(allowedEnvironments)) {
			blockers.push({
				reason: "invalid_runtime_allowed_environments",
				message:
					"realBusinessSimulationGate.allowedEnvironments must include local, docker, or sandbox when runtime simulation is enabled.",
			});
		}
	}

	return { driverDefaults, blockers, runtimeScenario, classification };
}

function readBool(settings: ExecutionLoopSettingsReader, key: string, defaultValue: boolean): boolean {
	const raw = settings.get(key);
	if (typeof raw === "boolean") return raw;
	if (raw === undefined || raw === null) return defaultValue;
	if (typeof raw === "string") {
		const normalized = raw.trim().toLowerCase();
		if (normalized === "true" || normalized === "1") return true;
		if (normalized === "false" || normalized === "0") return false;
	}
	return defaultValue;
}

function readString(settings: ExecutionLoopSettingsReader, key: string, defaultValue: string): string {
	const raw = settings.get(key);
	if (typeof raw === "string") return raw;
	return defaultValue;
}

function hasValidEnvironment(environments: string[] | undefined): boolean {
	if (!environments || environments.length === 0) return false;
	return environments.some(e => e === "local" || e === "docker" || e === "sandbox");
}

function applyOverrides(target: DriverGateFields, overrides: Partial<DriverGateFields> | undefined): void {
	if (!overrides) return;
	if (overrides.enableRoleBoundExecution !== undefined) {
		target.enableRoleBoundExecution = overrides.enableRoleBoundExecution;
	}
	if (overrides.enableAdvisorGate !== undefined) {
		target.enableAdvisorGate = overrides.enableAdvisorGate;
	}
	if (overrides.enableGlobalImpactGate !== undefined) {
		target.enableGlobalImpactGate = overrides.enableGlobalImpactGate;
	}
	if (overrides.enableRealBusinessSimulationGate !== undefined) {
		target.enableRealBusinessSimulationGate = overrides.enableRealBusinessSimulationGate;
	}
	if (overrides.superpowersGateMode !== undefined) {
		target.superpowersGateMode = overrides.superpowersGateMode;
	}
}
