// Throwaway verification for the artifact persistence guarantees.
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.DB_PATH = mkdtempSync(join(tmpdir(), 'vg-art-')) + '/db.sqlite';
const assetsDir = mkdtempSync(join(tmpdir(), 'vg-assets-'));
process.env.GENERATOR_ASSETS_PATH = assetsDir;

const { initDb } = await import('./src/db/index.js');
await initDb();

const { jobService } = await import('./src/services/job.js');
const { generatorService } = await import('./src/services/generator.js');
const { comfyuiService } = await import('./src/services/comfyui.js');
const { artifactService } = await import('./src/services/artifact.js');

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log(`PASS ${label}${extra ? ' | ' + extra : ''}`); }
  else { fail++; console.log(`FAIL ${label}${extra ? ' | ' + extra : ''}`); }
}

// --- 1) deleteJob removes only the row; the artifact file survives and stays servable
const job = await jobService.createGenerationJob({
  type: 'image',
  status: 'completed',
  input: { workflow: 'T2I-Flux', inputs: {} },
});
const artifactName = `${job.id}.png`;
const artifactPath = join(assetsDir, artifactName);
writeFileSync(artifactPath, 'KEEP-ME-FOREVER');
check('artifact exists before job delete', existsSync(artifactPath));

await jobService.deleteJob(job.id);
check('job row is gone after deleteJob', (await jobService.getJob(job.id)) === null);
check(
  'artifact file survives job deletion, bytes intact',
  existsSync(artifactPath) && readFileSync(artifactPath, 'utf-8') === 'KEEP-ME-FOREVER'
);
const resolved = artifactService.resolve(artifactName);
check(
  'artifact still resolvable after job deletion',
  resolved !== null && resolved.size === 'KEEP-ME-FOREVER'.length,
  resolved ? `mime=${resolved.mimeType}` : ''
);

// --- 2) persistArtifact is write-once: a pre-existing artifact is never overwritten
const job2 = await jobService.createGenerationJob({
  type: 'image',
  status: 'processing',
  input: {},
  comfyuiPromptId: 'fake-prompt-id',
} as never);
const preExisting = join(assetsDir, `${job2.id}.png`);
writeFileSync(preExisting, 'ORIGINAL-BYTES');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const c = comfyuiService as any;
c.getHistory = async () => ({
  'fake-prompt-id': {
    status: { completed: true },
    outputs: { '9': { images: [{ filename: 'ComfyUI_0001_.png', subfolder: '', type: 'output' }] } },
  },
});
c.getImage = async () => Buffer.from('NEW-BYTES-THAT-MUST-NOT-LAND');

const updated = await generatorService.syncJobStatus(job2.id);
check('reconcile completed the job', updated?.status === 'completed', updated?.artifact?.name ?? '');
check(
  'pre-existing artifact untouched by reconcile (write-once)',
  readFileSync(preExisting, 'utf-8') === 'ORIGINAL-BYTES'
);

console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
