import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const git = (args, env = process.env) =>
  execFileSync('git', args, { encoding: 'utf8', env }).trim();
if (git(['branch', '--show-current']) !== 'main') throw Error('main에서 배포하세요.');
if (git(['status', '--porcelain'])) throw Error('변경사항을 커밋한 뒤 배포하세요.');
const source = git(['rev-parse', 'HEAD']);
const remote = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
if (source !== remote) throw Error('로컬 main과 origin/main이 일치해야 합니다.');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
writeFileSync('dist/.nojekyll', '');
writeFileSync(
  'dist/deployment.json',
  JSON.stringify({ source, builtAt: new Date().toISOString() }, null, 2) + '\n',
);
// A temporary Git index stores the build tree. No checkout, clone or worktree is created.
const temporary = mkdtempSync(join(tmpdir(), 'chladni-pages-index-'));
try {
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
  git(['read-tree', '--empty'], env);
  git(['add', '-f', '--', 'dist'], env);
  const root = git(['write-tree'], env);
  const tree = git(['rev-parse', `${root}:dist`]);
  const parent = git(['ls-remote', 'origin', 'refs/heads/gh-pages']).split(/\s/)[0];
  if (parent) git(['fetch', 'origin', 'gh-pages']);
  const commit = git([
    'commit-tree',
    tree,
    ...(parent ? ['-p', parent] : []),
    '-m',
    `Publish Chladni from ${source}`,
  ]);
  execFileSync('git', ['push', 'origin', `${commit}:refs/heads/gh-pages`], { stdio: 'inherit' });
  console.log(`Pages source: ${source}\nhttps://pastelj321.github.io/Chladni/`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
