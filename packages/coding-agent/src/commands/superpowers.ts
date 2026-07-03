import { Args, Command, Flags, renderCommandHelp } from "@oh-my-pi/pi-utils/cli";
import {
	runSuperpowersAgentsCommand,
	type SuperpowersAgentsAction,
	type SuperpowersAgentsCommandArgs,
} from "../cli/superpowers-agents-cli";
import { initTheme } from "../modes/theme/theme";

const GROUPS = ["agents"];
const AGENT_ACTIONS: SuperpowersAgentsAction[] = ["list", "sync", "clean"];

export default class Superpowers extends Command {
	static description = "Manage Superpowers integrations";

	static args = {
		group: Args.string({
			description: "Superpowers group",
			required: false,
			options: GROUPS,
		}),
		action: Args.string({
			description: "Superpowers agents action",
			required: false,
			options: AGENT_ACTIONS,
		}),
	};

	static flags = {
		dir: Flags.string({ description: "Target agents directory" }),
		force: Flags.boolean({ char: "f", description: "Overwrite conflicting generated wrapper files" }),
		json: Flags.boolean({ description: "Output JSON" }),
	};

	static examples = [
		"# List supported Superpowers agent roles\n  omp superpowers agents list",
		"# Sync generated wrappers into the default user agents directory\n  omp superpowers agents sync",
		"# Sync generated wrappers into a custom directory\n  omp superpowers agents sync --dir ./tmp/agents --json",
		"# Remove generated wrappers from a custom directory\n  omp superpowers agents clean --dir ./tmp/agents",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Superpowers);
		if (!args.group || !args.action) {
			renderCommandHelp("omp", "superpowers", Superpowers);
			return;
		}

		const cmd: SuperpowersAgentsCommandArgs = {
			group: args.group as "agents",
			action: args.action as SuperpowersAgentsAction,
			flags: {
				dir: flags.dir,
				force: flags.force,
				json: flags.json,
			},
		};

		await initTheme();
		await runSuperpowersAgentsCommand(cmd);
	}
}
