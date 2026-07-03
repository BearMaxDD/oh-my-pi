import * as path from "node:path";
import { getProjectDir } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { getConfigDirs } from "../config";
import { theme } from "../modes/theme/theme";
import { cleanSuperpowersAgents, listSuperpowersAgentRoles, syncSuperpowersAgents } from "../superpowers/agent-bridge";

export type SuperpowersAgentsAction = "list" | "sync" | "clean";

export interface SuperpowersAgentsCommandArgs {
	group: "agents";
	action: SuperpowersAgentsAction;
	flags: {
		dir?: string;
		json?: boolean;
		force?: boolean;
	};
}

export interface SuperpowersAgentsCliDeps {
	write(line: string): void;
	settings?: {
		enabled?: boolean;
	};
}

function resolveTargetDir(flags: SuperpowersAgentsCommandArgs["flags"]): string {
	const explicitDir = flags.dir?.trim();
	if (explicitDir) {
		return path.resolve(getProjectDir(), explicitDir);
	}

	const [userAgentsDir] = getConfigDirs("agents", { project: false });
	if (!userAgentsDir) {
		throw new Error("No user agents config directory is available.");
	}

	return userAgentsDir.path;
}

export async function runSuperpowersAgentsCommand(
	cmd: SuperpowersAgentsCommandArgs,
	deps: SuperpowersAgentsCliDeps = { write: line => process.stdout.write(`${line}\n`) },
): Promise<void> {
	switch (cmd.action) {
		case "list": {
			const roles = listSuperpowersAgentRoles();
			if (cmd.flags.json) {
				deps.write(JSON.stringify({ roles }, null, 2));
				return;
			}

			for (const role of roles) {
				deps.write(`${chalk.bold(role.name)} ${chalk.dim(role.description)}`);
			}
			return;
		}
		case "sync":
		case "clean": {
			if (deps.settings?.enabled === false) {
				throw new Error("Superpowers agent bridge is disabled");
			}
			if (cmd.action === "sync") {
				const targetDir = resolveTargetDir(cmd.flags);
				const result = await syncSuperpowersAgents({ targetDir, force: cmd.flags.force });
				if (cmd.flags.json) {
					deps.write(JSON.stringify(result, null, 2));
					return;
				}
				deps.write(chalk.bold("Superpowers agent wrappers synced"));
				deps.write(chalk.dim(`Target directory: ${result.targetDir}`));
				deps.write(chalk.green(`${theme.status.success} Written: ${result.written.length}`));
				deps.write(chalk.green(`${theme.status.success} Updated: ${result.updated.length}`));
				deps.write(chalk.dim(`${theme.status.info} Skipped unchanged: ${result.skipped.length}`));
				if (result.conflicts.length > 0) {
					deps.write(
						chalk.yellow(
							`${theme.status.warning} Conflicts: ${result.conflicts.length} (use --force to overwrite)`,
						),
					);
				}
				return;
			}
			if (cmd.action === "clean") {
				const targetDir = resolveTargetDir(cmd.flags);
				const result = await cleanSuperpowersAgents({ targetDir, force: cmd.flags.force });
				if (cmd.flags.json) {
					deps.write(JSON.stringify(result, null, 2));
					return;
				}
				deps.write(chalk.bold("Superpowers agent wrappers cleaned"));
				deps.write(chalk.dim(`Target directory: ${result.targetDir}`));
				deps.write(chalk.green(`${theme.status.success} Removed: ${result.removed.length}`));
				deps.write(chalk.dim(`${theme.status.info} Skipped: ${result.skipped.length}`));
				return;
			}
			return;
		}
	}
}
