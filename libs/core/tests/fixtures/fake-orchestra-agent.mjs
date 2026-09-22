// Installed as `codex` on the fixture PATH. Only the agent CLI and queue
// transport are fake; the installed Orchestra scripts and tmux are real.
import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
process.title = 'codex';
const home = process.env.HOME;
const args = process.argv.slice(2);
if (args[0] === 'queue') {
  if (existsSync(join(home, 'refuse-queue'))) process.exit(1);
  appendFileSync(join(home, 'deliveries.jsonl'), JSON.stringify(args) + '\n');
  process.exit(0);
}
writeFileSync(
  join(home, 'agent-start.json'),
  JSON.stringify({
    args,
    cwd: process.cwd(),
    pid: process.pid,
    tmux: process.env.TMUX ?? null,
    // Enough of the environment to prove what the launch seam put
    // there, without recording the whole of it into a fixture file.
    env: Object.fromEntries(
      ['CLAUDE_CONFIG_DIR', 'GIT_INDEX_FILE', 'GIT_OPTIONAL_LOCKS'].map(
        (key) => [key, process.env[key] ?? null]
      )
    ),
  })
);
const report = join(
  home,
  '.claude/plugins/orchestra/skills/player/scripts/report.sh'
);
createInterface({ input: process.stdin }).on('line', (line) => {
  appendFileSync(join(home, 'agent-input.jsonl'), JSON.stringify(line) + '\n');
  if (!line.startsWith('report ') && line !== 'orchestrator') return;
  const reportArgs =
    line === 'orchestrator' ? ['--orchestrator'] : ['PROGRESS', line.slice(7)];
  const result = spawnSync('bash', [report, ...reportArgs], {
    encoding: 'utf8',
    env: process.env,
  });
  writeFileSync(
    join(home, 'report-result.json'),
    JSON.stringify({
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    })
  );
});
