/**
 * setup-obsidian.mjs —— 一次性配置 Obsidian 环境
 *
 * 用法：
 *   node tools/setup-obsidian.mjs              # 交互询问
 *   node tools/setup-obsidian.mjs --templater  # 用 Templater 模板（装了插件）
 *   node tools/setup-obsidian.mjs --native     # 用原生模板（不装插件也能用）
 *
 * 做什么：
 *   1. 写入 .obsidian/app.json          —— 排除模板目录、开启 wiki 链接等
 *   2. 写入 .obsidian/core-plugins.json —— 确保 file-recovery / 模板 / 反链 等已启用
 *   3. 写入 .obsidian/community-plugins.json —— 预列 Templater/Dataview/Tag Wrangler
 *   4. 决定 templates 目录放哪一版模板
 *
 * 不做：不下载插件（沙箱无外网）。插件必须在 Obsidian 界面里装。
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OBS = join(ROOT, '.obsidian');
const TPL = join(ROOT, 'templates');

// ── 决定模式 ────────────────────────────────────────────
const argv = process.argv.slice(2);
let mode = argv.includes('--templater') ? 'templater'
         : argv.includes('--native') ? 'native'
         : null;

if (!mode) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`
用哪一版模板作为默认？

  1) 原生模板  —— 不装任何插件就能用（推荐先选这个，Obsidian 自带模板插件已启用）
  2) Templater —— 装了 Templater 插件后用（支持自动填标题、弹窗选领域）

`);
  const a = (await rl.question('请输入 1 或 2 [1]: ')).trim() || '1';
  mode = a === '2' ? 'templater' : 'native';
  rl.close();
}

mkdirSync(OBS, { recursive: true });
const changed = [];

const writeIfChanged = (file, content) => {
  const abs = join(OBS, file);
  // 【重要】不要加末尾换行：Obsidian 自己重写 JSON 时不带 \n，
  // 如果我们带，Obsidian 每次保存都会产生一个"只差换行"的无意义 diff。
  const next = JSON.stringify(content, null, 2);
  if (existsSync(abs) && readFileSync(abs, 'utf8') === next) return false;
  writeFileSync(abs, next, 'utf8');
  changed.push(file);
  return true;
};

// ── 1. app.json ─────────────────────────────────────────
const appPath = join(OBS, 'app.json');
let app = {};
if (existsSync(appPath)) {
  try { app = JSON.parse(readFileSync(appPath, 'utf8')); } catch { app = {}; }
}

app.useMarkdownLinks = false;        // 用 [[wikilink]]，本库的关联全靠它
app.alwaysUpdateLinks = true;        // 改文件名时自动更新引用，防断链 ⭐
app.newFileLocation = 'folder';
app.attachmentFolderPath = '90-附件';
app.trashOption = 'local';
app.showLineNumber = true;
app.readableLineLength = false;
app.strictLineBreaks = true;
app.defaultViewMode = 'source';
app.promptDelete = true;

// 模板目录不参与搜索与图谱，否则模板会污染反链和断链统计
app.userIgnoreFilters = ['templates/'];

writeIfChanged('app.json', app);

// ── 2. core-plugins.json ────────────────────────────────
const corePath = join(OBS, 'core-plugins.json');
let core = {};
if (existsSync(corePath)) {
  try { core = JSON.parse(readFileSync(corePath, 'utf8')); } catch { core = {}; }
}

// 本库必需的几个必须打开
const mustOn = {
  'file-recovery': true,   // 防手滑，最重要的一个
  'templates': true,       // 原生模板
  'backlink': true,
  'outgoing-link': true,
  'tag-pane': true,
  'properties': true,      // frontmatter 可视化编辑
  'outline': true,
  'bookmarks': true,
  'command-palette': true,
  'global-search': true,
  'page-preview': true,
  'note-composer': true,
  'word-count': true,
};
// 本库用不到的关掉，减少干扰
const mustOff = {
  'slides': false,
  'audio-recorder': false,
  'publish': false,
  'webviewer': false,
  'markdown-importer': false,
  'zk-prefixer': false,
  'random-note': false,
  'daily-notes': false,   // 本库用 00-收件箱 当入口，不用日记
};

Object.assign(core, mustOn, mustOff);
writeIfChanged('core-plugins.json', core);

// ── 3. community-plugins.json ───────────────────────────
// 已安装并启用的社区插件列表。Obsidian 装好插件后会自己补进来；
// 这里预先写好，是为了让安装后自动启用，不用再点一次。
const community = ['templater-obsidian', 'dataview', 'tag-wrangler'];
writeIfChanged('community-plugins.json', community);

// ── 4. 模板双轨 ─────────────────────────────────────────
const NATIVE_DIR = join(TPL, '原生');
const TPLR_DIR = join(TPL, 'Templater');

/**
 * 把 Templater 语法降级成原生可用的占位符。
 * 原生模板不支持自动填标题，所以标题留成明显的手填占位。
 */
function toNative(text) {
  return text
    // tp.file.title
    .replace(/<%\s*tp\.file\.title\s*%>/g, '（改这里：标题）')
    // suggester：只保留第一个候选作为默认值提示
    .replace(/<%\s*await\s+tp\.system\.suggester\(\[([^\]]*)\][\s\S]*?\)\s*%>/g, (_, list) => {
      const first = list.split(',')[0].replace(/["'\s]/g, '');
      return `（改这里：${list.replace(/["'\s]/g, '').replace(/,/g, ' / ')}，默认 ${first}）`;
    })
    // 其余 tp.* 一律替换成提示
    .replace(/<%[\s\S]*?%>/g, '（改这里）');
}

const skipFiles = new Set(['原生', 'Templater']);
let tplMoved = 0;
let nativeMade = 0;

const tplFiles = existsSync(TPL)
  ? readdirSync(TPL).filter((f) => f.endsWith('.md') && statSync(join(TPL, f)).isFile())
  : [];

// 把根目录下的 Templater 版搬进子目录（只搬一次）
if (tplFiles.length) {
  mkdirSync(TPLR_DIR, { recursive: true });
  for (const f of tplFiles) {
    const dest = join(TPLR_DIR, f);
    if (!existsSync(dest)) {
      cpSync(join(TPL, f), dest);
      tplMoved++;
    }
    rmSync(join(TPL, f));
  }
}

// 生成原生版
mkdirSync(NATIVE_DIR, { recursive: true });
for (const f of readdirSync(TPLR_DIR).filter((x) => x.endsWith('.md'))) {
  const raw = readFileSync(join(TPLR_DIR, f), 'utf8');
  const native = toNative(raw);
  const dest = join(NATIVE_DIR, f);
  if (!existsSync(dest) || readFileSync(dest, 'utf8') !== native) {
    writeFileSync(dest, native, 'utf8');
    nativeMade++;
  }
}

// 把选中的那一版复制到 templates 根目录，作为 Obsidian「模板」插件的默认来源
const srcDir = mode === 'templater' ? TPLR_DIR : NATIVE_DIR;
for (const f of readdirSync(srcDir).filter((x) => x.endsWith('.md'))) {
  writeFileSync(join(TPL, f), readFileSync(join(srcDir, f), 'utf8'), 'utf8');
}

// ── 输出 ────────────────────────────────────────────────
console.log('\n✅ Obsidian 配置完成\n');
console.log(`   配置目录：.obsidian/`);
console.log(`   写入文件：${changed.length ? changed.join('、') : '（无变化）'}`);
console.log(`   模板迁移：${tplMoved} 个 → templates/Templater/`);
console.log(`   原生生成：${nativeMade} 个 → templates/原生/`);
console.log(`   当前默认：templates/  ← ${mode === 'templater' ? 'Templater 版' : '原生版'}`);
console.log('');
console.log('   已启用的核心插件：文件恢复、模板、反链、出链、标签、属性、大纲…');
console.log('   已关闭的干扰项：幻灯片、录音、发布、日记…');
console.log('');
console.log('下一步（必须手动，沙箱无法下载插件）：');
console.log('  1. 打开 Obsidian → 设置 → 第三方插件 → 关闭「安全模式 / 受限模式」');
console.log('  2. 点「浏览」→ 依次搜并安装：Templater、Dataview、Tag Wrangler');
console.log('  3. 装完回到已安装列表，确认三个都是开启状态');
console.log('');
console.log('若改用另一版模板，重跑：');
console.log(`  node tools/setup-obsidian.mjs ${mode === 'templater' ? '--native' : '--templater'}`);
console.log('');
