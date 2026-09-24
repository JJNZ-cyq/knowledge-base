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

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
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

/**
 * 读 JSON，并容忍 UTF-8 BOM。
 *
 * 为什么必须容 BOM：本机 PowerShell 5.1 的 `Set-Content -Encoding UTF8`
 * 会写入 BOM，而 `JSON.parse` 遇到 BOM 直接抛错（已实测踩到）。
 * 所有手动改过、或被其它工具写过的配置文件都可能是带 BOM 的。
 * 返回 null 表示读不到或解析失败，由调用方决定怎么处理。
 */
function readJson(abs) {
  if (!existsSync(abs)) return null;
  try {
    // \uFEFF 即 BOM，用 replace 去掉，避免它出现在 JSON.parse 的输入里
    return JSON.parse(readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

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
app = readJson(appPath) ?? {};

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
core = readJson(corePath) ?? {};

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

// ── 4. Templater：从库结构推导模板规则 ──────────────────
/**
 * 【为什么不是硬编码目录列表】
 * 首版只列了 3 个目录，而库里有十几个卡片目录，导致在未列出的目录里
 * 新建笔记时 Templater 静默不生效。补目录是治标：结构一变又会漏。
 *
 * 这里改为遍历库结构，按目录名判断该目录装什么卡。目录名即语义，
 * 因此规则不可能与结构脱节。
 *
 *   <任意>\知识卡\      -> 知识卡
 *   <任意>\文献笔记\    -> 文献卡
 *   <任意>\项目笔记\    -> 项目速览
 *   30-问题卡\          -> 问题卡
 *   20-永久卡\          -> 永久卡
 *   00-收件箱\**        -> 知识卡（兜底：先收下，之后再改类型）
 */
/**
 * 目录名 → 卡片模板映射。
 *
 * 用【后缀匹配】而不是【全名精确匹配】：库里既有 `知识卡\`，也有
 * `20-永久卡\`、`30-问题卡\` 这种带编号前缀的，精确匹配会漏掉后者。
 * 后缀匹配对两种写法都成立。
 */
const DIR_SUFFIX_TO_CARD = [
  ['知识卡', '知识卡'],
  ['文献笔记', '文献卡'],
  ['项目笔记', '项目速览'],
  ['问题卡', '问题卡'],
  ['永久卡', '永久卡'],
  // 15-优化方法论 的子区
  ['建模范式', '知识卡'],
  ['求解与工具', '知识卡'],
  ['不确定性', '知识卡'],
  // 12-编程与工程 的子区
  ['语言特性', '知识卡'],
  ['工程实践', '知识卡'],
  ['语言与生态', '知识卡'],
  ['科学计算', '知识卡'],
  ['优化建模', '知识卡'],
  ['混合栈', '知识卡'],
];

/** 收件箱：整棵树都套知识卡（先收下，之后再改类型） */
const INBOX_SUFFIX = '收件箱';

/**
 * 该目录名自带哪种卡？返回 null 表示"不因自己的名字而定"。
 * 注意：这里**不看收件箱**——收件箱的属性由父目录继承而来，见下面 inheritedCard。
 */
function cardForDirName(name) {
  // 后缀匹配：取命中最长的一条，避免将来加短后缀时误伤
  let best = null;
  for (const [suffix, card] of DIR_SUFFIX_TO_CARD) {
    if (name.endsWith(suffix) && (!best || suffix.length > best[0].length)) best = [suffix, card];
  }
  return best ? best[1] : null;
}

/**
 * 递归收集所有需要套模板的目录。
 *
 * 【inheritedCard：父目录属性向下继承】
 * `00-收件箱\灵感\` 这种子目录，名字里没有"收件箱"三个字，靠自己的名字
 * 永远判不出来。所以约定：父目录一旦确定装某种卡，整棵子树默认继承，
 * 直到某个后代靠自己的名字改判。
 *
 * 这样任意深度的收件箱子目录都自动覆盖，不需要往名单里补目录——
 * 之前反复漏掉 灵感/待读/剪藏 就是这个继承缺失导致的。
 *
 * 【结构约束】每次迭代只有两条独立语句：判定、递归。不用 else/continue
 * 提前跳出，否则命中判定的目录不再深入，子目录会被整棵漏掉。
 */
function discoverTemplateFolders(dir = ROOT, out = [], inheritedCard = null) {
  const SKIP = new Set(['.git', '.obsidian', 'templates', 'tools', 'node_modules']);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    const abs = join(dir, entry.name);

    const isInbox = entry.name.endsWith(INBOX_SUFFIX);
    // 判定：自己的名字优先；否则继承父目录
    const card = cardForDirName(entry.name) ?? (isInbox ? '知识卡' : inheritedCard);
    if (card) out.push({ rel: relPath(abs), card });

    // 递归：无条件深入，并把当前卡片类型传下去
    discoverTemplateFolders(abs, out, card);
  }
  return out;
}

function relPath(abs) {
  return abs.replace(ROOT, '').replace(/^[\\/]/, '').split('\\').join('/');
}

const tplFolders = discoverTemplateFolders();

// 读 Templater 已安装的版本号，避免自己编 data_version / 字段集
const tplManifest = join(OBS, 'plugins', 'templater-obsidian', 'manifest.json');
const tplVersion = readJson(tplManifest)?.version ?? null;

// 规则表提到模块作用域：输出段的自检也要用它
const tplRules = tplFolders
  .filter((f) => existsSync(join(TPL, `${f.card}.md`)))
  .map((f) => ({ folder: f.rel, template: `templates/${f.card}.md` }));

if (tplVersion) {
  const tplData = {
    data_version: 2,
    command_timeout: 5,
    templates_folder: 'templates',
    // 空占位条目会出现在 Templater 设置界面里，只留真实配置
    templates_pairs: [],
    trigger_on_file_creation_mode: 'folder',
    auto_jump_to_cursor: false,
    jump_to_cursor_after_file_name: false,
    shell_path: '',
    user_scripts_folder: '',
    folder_templates: tplRules,
    file_templates: [],
    syntax_highlighting: true,
    syntax_highlighting_mobile: false,
    enabled_templates_hotkeys: [],
    startup_templates: [],
    intellisense_render: '1',
    ignore_folders_on_creation: [],
  };
  const abs = join(OBS, 'plugins', 'templater-obsidian', 'data.json');
  const next = JSON.stringify(tplData, null, 2);
  if (!existsSync(abs) || readFileSync(abs, 'utf8') !== next) {
    writeFileSync(abs, next, 'utf8');
    changed.push('plugins/templater-obsidian/data.json');
  }
}

/**
 * 自检：库里每个"装卡片"的目录，是否都有对应的模板规则。
 *
 * 为什么值得写进脚本：这个缺陷此前出现过两次——第一次只配了 3 个目录，
 * 第二次漏了带编号前缀的目录和收件箱子目录。两次都是**静默失败**：
 * 在未覆盖的目录里新建笔记时 Templater 什么都不做，也不报错。
 * 所以让脚本每次运行后主动核对，而不是等人发现"模板怎么没生效"。
 */
function auditTemplateCoverage(rules) {
  const covered = new Set(rules.map((r) => r.folder));
  const missing = discoverTemplateFolders()
    .filter((f) => !covered.has(f.rel))
    .map((f) => `${f.rel}（应为 ${f.card}）`);
  // 反向检查：规则指向不存在的目录 = 僵尸规则（目录被改名或删除）
  const zombies = rules
    .filter((r) => !existsSync(join(ROOT, r.folder)))
    .map((r) => r.folder);
  return { missing, zombies };
}

// ── 4. 模板双轨 ─────────────────────────────────────────
/**
 * 双轨模板的目录布局（两个子目录都是"原件"，templates 根目录是"当前生效版"）：
 *
 *   templates/Templater/*.md   Templater 语法原件
 *   templates/原生/*.md        原生占位符原件（由 Templater 版自动降级生成）
 *   templates/*.md             当前生效版（= 上面二者之一，供 Templater 读取）
 *
 * 【为什么不再做"迁移"】首版有个"把根目录文件搬进 Templater/ 子目录"的
 * 一次性迁移逻辑，它每次都先 rmSync 掉根目录文件再重新复制。一旦中途失败，
 * Templater 就指向了不存在的模板文件。迁移早已完成，该逻辑纯属残留，删除。
 * 现在只做单向覆盖写入，不做删除。
 */
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

let nativeMade = 0;

// 由 Templater 版生成/刷新原生版
mkdirSync(TPLR_DIR, { recursive: true });
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

// 把选中的那一版写入 templates 根目录，作为 Obsidian 模板插件的默认来源。
// 只覆盖写入，不删除任何文件。
const srcDir = mode === 'templater' ? TPLR_DIR : NATIVE_DIR;
for (const f of readdirSync(srcDir).filter((x) => x.endsWith('.md'))) {
  writeFileSync(join(TPL, f), readFileSync(join(srcDir, f), 'utf8'), 'utf8');
}

// ── 输出 ────────────────────────────────────────────────
console.log('\n✅ Obsidian 配置完成\n');
console.log(`   写入文件：${changed.length ? changed.join('、') : '（无变化）'}`);
console.log(`   原生版刷新：${nativeMade} 个 → templates/原生/`);
console.log(`   当前生效：templates/*.md  ← ${mode === 'templater' ? 'Templater 版' : '原生版'}`);
console.log('');

if (tplVersion) {
  // 【关键】自检必须读回"磁盘上实际生效"的规则，不能用内存里的 tplRules——
  // 那是同源自证：拿自己刚生成的东西跟自己的来源比，永远不会失败。
  // 读磁盘才能真正发现"没写成功 / 被手改过 / 插件被禁用导致跳过写入"等情况。
  const persistedPath = join(OBS, 'plugins', 'templater-obsidian', 'data.json');
  const persistedRules = readJson(persistedPath)?.folder_templates ?? [];

  const { missing, zombies } = auditTemplateCoverage(persistedRules);
  console.log(`   Templater v${tplVersion}：磁盘生效规则 ${persistedRules.length} 条`);
  console.log('     （规则由库结构推导，新增卡片目录自动纳入，无需改脚本）');
  if (missing.length) {
    console.log(`   ❌ 自检发现 ${missing.length} 个目录未覆盖（在这些目录里新建笔记不会套模板）：`);
    for (const m of missing) console.log(`        ${m}`);
  } else {
    console.log('   ✅ 自检通过：所有卡片目录均已覆盖');
  }
  if (zombies.length) {
    console.log(`   ⚠️ ${zombies.length} 条僵尸规则（目录已不存在）：${zombies.join('、')}`);
  }
} else {
  console.log('   ⚠️ 未检测到 Templater（.obsidian/plugins/templater-obsidian/manifest.json 不存在）');
  console.log('      跳过其配置。装好插件后重跑本脚本即可自动配好。');
}
console.log('');
console.log(`切换模板版本：node tools/setup-obsidian.mjs ${mode === 'templater' ? '--native' : '--templater'}`);
console.log('');
