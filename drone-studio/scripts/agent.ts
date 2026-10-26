import { readFileSync } from 'node:fs';
import { applyOperations, propose } from '../src/core/commands';
import { parseProjectFile, projectBundle, trajectoryCsv } from '../src/core/export';
import { defaultProject } from '../src/core/model';
import { validateProject } from '../src/core/validation';

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`${flag} requires a value.`);
  return args[index + 1];
};
try {
  if (args.includes('--help') || !args.length) {
    console.log(
      `Lucidity design agent · no aircraft connection\n\nCommands (JSON is written to stdout; source files are never modified):\n  --brief "Create a 96 second cosmic show"    Propose edits without applying them\n  --command '{"type":"set_fleet","count":1200}'   Apply one operation or a JSON array\n  --commands-file operations.json            Apply a batch from a file\n  --project path/to/show.lucid.json           Read an existing design; default is the demo\n  --expected-revision 3                       Reject stale mutations\n  --validate                                 Include the design review\n  --csv                                      Output 2 Hz simulation trajectories\n  --tools                                    Print the supported operation contract\n\nUse npm run --silent agent -- [arguments] to preserve machine-readable output.`
    );
  } else if (args.includes('--tools')) {
    console.log(readFileSync(new URL('../docs/agent-tools.json', import.meta.url), 'utf8'));
  } else {
    const file = value('--project'),
      project = file
        ? parseProjectFile(readFileSync(file, 'utf8'))
        : structuredClone(defaultProject);
    const brief = value('--brief'),
      command = value('--command'),
      commandsFile = value('--commands-file'),
      revision = value('--expected-revision');
    if ([brief, command, commandsFile].filter(Boolean).length > 1)
      throw new Error('Choose one of --brief, --command, or --commands-file.');
    if (brief) console.log(JSON.stringify(propose(brief, project), null, 2));
    else {
      const input: unknown = commandsFile
        ? JSON.parse(readFileSync(commandsFile, 'utf8'))
        : command
          ? JSON.parse(command)
          : null;
      const result = input
        ? applyOperations(
            project,
            Array.isArray(input) ? input : [input],
            revision === undefined ? project.revision : Number(revision)
          )
        : project;
      if (args.includes('--csv')) console.log(trajectoryCsv(result));
      else
        console.log(
          JSON.stringify(
            projectBundle(result, args.includes('--validate') ? validateProject(result) : null),
            null,
            2
          )
        );
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({ error: error instanceof Error ? error.message : 'Command failed.' })
  );
  process.exitCode = 1;
}
