/**
 * remote.mjs —— 配置 GitHub 私有远端（一次性）
 *
 * 用法：
 *   node tools/remote.mjs <GitHub用户名> [仓库名]
 *
 * 例：
 *   node tools/remote.mjs jjnz
 *   node tools/remote.mjs jjnz my-kb
 *
 * 说明：
 *   1. 仓库需先在 GitHub 网页上建好（Private，不要勾选任何初始化文件）
 *   2. 本脚本只配 remote，不会替你建仓库（建仓需要 gh CLI 或网页操作）
 *   3. 配好后在本机终端跑：git push -u origin main
 */

import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const [user, repo = 'knowledge-base'] = process.argv.slice(2);

if (!user) {
  console.log(`用法: node tools/remote.mjs <GitHub用户名> [仓库名]

例：
  node tools/remote.mjs jjnz
  node tools/remote.mjs jjnz my-kb

前提：先在 GitHub 上建好【私有】空仓库（不要勾选 README/gitignore/license）。

配好后执行：
  git push -u origin main
`);
  process.exit(0);
}

const url = `https://github.com/${user}/${repo}.git`;
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }).trim();

// 查看现有 remote
let remotes = '';
try {
  remotes = run('git remote -v');
} catch {
  console.error('❌ 这里不是 git 仓库，请先在库根目录执行 git init');
  process.exit(1);
}

if (remotes.includes('origin')) {
  console.log('⚠️  origin 已存在，将替换为：' + url);
  try { run('git remote remove origin'); } catch { /* ignore */ }
}

run(`git remote add origin ${url}`);
console.log(`✅ 远端已配置`);
console.log(`   origin → ${url}`);
console.log('');
console.log('接下来执行（需要你的 GitHub 凭据）：');
console.log('   git push -u origin main');
console.log('');
console.log('提示：HTTPS 推送需要 Personal Access Token（不是账号密码）。');
console.log('      GitHub → Settings → Developer settings → Personal access tokens');
console.log('      权限勾选 repo 即可，然后 Windows 凭据管理器会记住它。');
console.log('');
console.log('若直连 GitHub 失败（国内网络），让 git 走你的代理：');
console.log('   git config --global http.proxy  http://127.0.0.1:<端口>');
console.log('   git config --global https.proxy http://127.0.0.1:<端口>');
console.log('   端口以你的 v2rayN / clash 实际监听为准（常见 10809 / 7890）');
