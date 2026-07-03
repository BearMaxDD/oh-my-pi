export interface DiscoveredSkillLike {
	name: string;
	filePath: string;
}

export interface SuperpowersSkillDiscoveryReport {
	ok: boolean;
	found: string[];
	missing: string[];
}

export const REQUIRED_SUPERPOWERS_RUNTIME_SKILLS = [
	"using-superpowers",
	"brainstorming",
	"test-driven-development",
	"systematic-debugging",
	"requesting-code-review",
	"verification-before-completion",
] as const;

export function validateSuperpowersSkillDiscovery(skills: DiscoveredSkillLike[]): SuperpowersSkillDiscoveryReport {
	const found: string[] = [];
	const foundSet = new Set<string>();

	for (const skill of skills) {
		const normalizedName = skill.name.trim();
		const normalizedFilePath = skill.filePath.trim();
		if (
			normalizedName === "" ||
			foundSet.has(normalizedName) ||
			!isSkillFilePathForName(normalizedFilePath, normalizedName)
		) {
			continue;
		}
		found.push(normalizedName);
		foundSet.add(normalizedName);
	}

	const missing = REQUIRED_SUPERPOWERS_RUNTIME_SKILLS.filter(skill => !foundSet.has(skill));
	return { ok: missing.length === 0, found, missing };
}

function isSkillFilePathForName(filePath: string, name: string): boolean {
	const normalizedPath = filePath.replaceAll("\\", "/");
	if (!normalizedPath.endsWith("SKILL.md")) {
		return false;
	}
	return normalizedPath === `${name}/SKILL.md` || normalizedPath.includes(`/${name}/SKILL.md`);
}
