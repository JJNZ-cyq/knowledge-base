/**
 * check.mjs —— 全库体检（每周日的固定动作）
 *
 * 用法：node tools/check.mjs
 *
 * 检查项：
 *   1. frontmatter 缺失或必填字段不全
 *   2. domain 取值非法（不在受控词表内）
 *   3. wikilink 断链（指向不存在的笔记）
 *   4. 孤立卡（无任何入链，且不是导航/规范类文件）
 *   5. 收件箱积压（条数 + 最老一条的天数）
 *   6. 逾期未复习的卡（status=learning 且超过 30 天没 reviewed）
 *   7. 文件名违规（非法字符 / 过长）
 *
 * 退出码：0 = 无错误（可能有警告）；1 = 存在错误级问题
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 不参与检查的目录
const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash', 'templates', 'tools']);

/**
 * 去掉代码块与行内代码，再找链接。
 * 否则文档里写的示例 `[[wikilink]]` 会被当成真链接，产生大量假断链。
 */
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')   // 围栏代码块
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');       // 行内代码
}

// 合法 domain 取值
const VALID_DOMAINS = new Set([
  '10-交能融合', '11-大模型', '12-编程与工程', '15-优化方法论', '19-交叉', '20-永久卡',
  '30-问题卡', '50-代码项目', '60-学习计划', '40-文献', '00-收件箱',
]);

// 必填 frontmatter 字段（卡片类）
const REQUIRED = ['title', 'type', 'status'];
/** 这些 type 不是"卡片"，而是库自身的说明书，允许没有 status */
const NON_CARD_TYPES = new Set(['导航', '规范', 'MOC']);
// 需要有 domain 的卡型
const NEEDS_DOMAIN = new Set(['知识卡', '文献卡', '永久卡', '问题卡', '踩坑卡', '项目速览']);
// 允许孤立的文件类型（导航、索引、规范类天生无入链）
const ALLOW_ORPHAN_TYPES = new Set(['导航', '规范', '周报', 'MOC']);

// ── 递归收集 .md ────────────────────────────────────────
/** @returns {string[]} 相对 ROOT 的路径，用 / 分隔 */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), out);
    } else if (e.isFile() && extname(e.name) === '.md' && e.name !== '.gitkeep') {
      out.push(relative(ROOT, join(dir, e.name)).split('\\').join('/'));
    }
  }
  return out;
}

const files = walk(ROOT);

// ── 解析 frontmatter ────────────────────────────────────
/**
 * @returns {{fm: Record<string,string>|null, body: string}}
 */
function parse(file) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return { fm: null, body: '' };
  }
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: text };

  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: text.slice(m[0].length) };
}

// ── 建立索引 ────────────────────────────────────────────
const notes = new Map(); // basename(无扩展名, 小写) → 相对路径
const parsed = new Map(); // 相对路径 → {fm, body}
const linksOut = new Map(); // 相对路径 → 出链名[]

for (const f of files) {
  const key = basename(f, '.md').toLowerCase();
  if (!notes.has(key)) notes.set(key, f);
  const p = parse(f);
  parsed.set(f, p);

  // 收集 wikilink：[[name]] 或 [[name|alias]] 或 [[name#heading]]
  // 先在"去代码"后的文本上找，避免把文档示例当成真链接
  const out = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let mm;
  const scanText = stripCode(p.body);
  while ((mm = re.exec(scanText)) !== null) {
    out.push(mm[1].trim().toLowerCase());
  }
  linksOut.set(f, out);
}

// ── 检查 ────────────────────────────────────────────────
const errors = [];
const warnings = [];
const info = [];

const inlinks = new Map(); // 相对路径 → 入链数
for (const f of files) inlinks.set(f, 0);

// 1 & 2 & 7：单文件检查
for (const f of files) {
  const { fm } = parsed.get(f);
  const name = basename(f, '.md');

  // 文件名违规
  if (/[\\/:*?"<>|]/.test(name)) {
    errors.push(`[文件名] 含非法字符：${f}`);
  }
  if (name.length > 60) {
    warnings.push(`[文件名] 超过 60 字符（${name.length}）：${f}`);
  }

  // frontmatter
  if (!fm) {
    // README 与设计方案是"关于库本身"的文档，不强制 frontmatter
    if (!['README.md', 'docs/设计方案.md'].includes(f)) {
      warnings.push(`[元数据] 缺少 frontmatter：${f}`);
    }
    continue;
  }
  const isCard = !NON_CARD_TYPES.has(fm.type || '');
  for (const k of REQUIRED) {
    if (isCard && !fm[k]) errors.push(`[元数据] 缺少必填字段 ${k}：${f}`);
  }
  if (!fm.type) warnings.push(`[元数据] 缺少 type：${f}`);
  if (fm.domain && !VALID_DOMAINS.has(fm.domain)) {
    errors.push(`[元数据] domain 取值非法 "${fm.domain}"：${f}`);
  }
  if (fm.type && NEEDS_DOMAIN.has(fm.type) && !fm.domain) {
    errors.push(`[元数据] ${fm.type} 缺少 domain：${f}`);
  }
  if (fm.status && !['inbox', 'learning', 'mastered', 'archived'].includes(fm.status)) {
    warnings.push(`[元数据] status 取值异常 "${fm.status}"：${f}`);
  }
}

// 3：断链
for (const f of files) {
  for (const target of linksOut.get(f)) {
    if (!target) continue;
    if (notes.has(target)) {
      const dest = notes.get(target);
      inlinks.set(dest, (inlinks.get(dest) || 0) + 1);
    } else {
      // 允许指向目录的写法（如 [[20-永久卡/xxx]]）：取最后一段再试
      const tail = target.split('/').pop();
      if (notes.has(tail)) {
        inlinks.set(notes.get(tail), (inlinks.get(notes.get(tail)) || 0) + 1);
      } else {
        warnings.push(`[断链] ${f} → [[${target}]]`);
      }
    }
  }
}

// 4：孤立卡（新卡天然无入链，属正常现象，只作提示不当警告）
const orphans = [];
for (const f of files) {
  const { fm } = parsed.get(f);
  if (!fm) continue;
  const t = fm.type || '';
  if (ALLOW_ORPHAN_TYPES.has(t)) continue;
  // 收件箱里的东西本来就没链接，不算孤立
  if (f.startsWith('00-收件箱/')) continue;
  if ((inlinks.get(f) || 0) === 0) orphans.push(f);
}

// 5：收件箱积压
const INBOX = join(ROOT, '00-收件箱');
let inboxCount = 0;
let oldestDays = null;
if (existsSync(INBOX)) {
  const stack = [INBOX];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name !== '.gitkeep' && !e.name.endsWith('.md') === false) {
        inboxCount++;
        const age = Math.floor((Date.now() - statSync(p).mtimeMs) / 86400000);
        if (oldestDays === null || age > oldestDays) oldestDays = age;
      }
    }
  }
}
if (inboxCount === 0) {
  info.push(`[收件箱] 已清空 ✅`);
} else if (inboxCount > 20) {
  errors.push(`[收件箱] 积压 ${inboxCount} 条，超过 20 条上限 —— 库正在退化成收藏夹`);
} else {
  warnings.push(`[收件箱] 积压 ${inboxCount} 条${oldestDays !== null ? `，最老一条已 ${oldestDays} 天` : ''}`);
}

// 6：逾期未复习
const STALE_DAYS = 30;
let stale = 0;
for (const f of files) {
  const { fm } = parsed.get(f);
  if (!fm || fm.status !== 'learning') continue;
  const d = fm.reviewed || fm.created;
  if (!d) continue;
  const t = Date.parse(d);
  if (Number.isNaN(t)) continue;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days > STALE_DAYS) {
    stale++;
    if (stale <= 5) warnings.push(`[待复习] ${days} 天未复习：${f}`);
  }
}
if (stale > 5) warnings.push(`[待复习] 另有 ${stale - 5} 张卡同样逾期（共 ${stale} 张）`);

// 孤立卡汇总（提示级）
if (orphans.length) {
  if (orphans.length <= 8) {
    for (const o of orphans) info.push(`[孤立] 无入链（新卡正常）：${o}`);
  } else {
    info.push(`[孤立] 有 ${orphans.length} 张卡无入链 —— 数量多说明卡片之间还没建立关联`);
  }
}

// ── 统计 ────────────────────────────────────────────────
const typeCount = {};
for (const f of files) {
  const { fm } = parsed.get(f);
  if (!fm) continue;
  typeCount[fm.type || '(无 type)'] = (typeCount[fm.type || '(无 type)'] || 0) + 1;
}

// ── 输出 ────────────────────────────────────────────────
const line = '─'.repeat(64);
console.log(`\n${line}\n  知识库体检报告  ${new Date().toLocaleString('zh-CN')}\n${line}`);

console.log(`\n📊 规模：共 ${files.length} 个 md 文件`);
const order = ['知识卡', '文献卡', '永久卡', '问题卡', '踩坑卡', '项目速览', '周报', '导航', '规范'];
const shown = new Set();
for (const t of order) {
  if (typeCount[t]) { console.log(`     ${t.padEnd(8, '　')} ${typeCount[t]}`); shown.add(t); }
}
for (const [t, c] of Object.entries(typeCount)) {
  if (!shown.has(t)) console.log(`     ${t.padEnd(8, '　')} ${c}`);
}

for (const i of info) console.log(`\nℹ️  ${i}`);

if (errors.length) {
  console.log(`\n❌ 错误 ${errors.length} 项（必须修）`);
  for (const e of errors) console.log(`   ${e}`);
}
if (warnings.length) {
  console.log(`\n⚠️  警告 ${warnings.length} 项（建议修）`);
  for (const w of warnings) console.log(`   ${w}`);
}
if (!errors.length && !warnings.length) {
  console.log(`\n✅ 全部通过，没有发现问题。`);
}

console.log(`\n${line}`);
if (errors.length) {
  console.log(`结论：有 ${errors.length} 项错误待处理。`);
} else if (warnings.length) {
  console.log(`结论：可以接受，但建议顺手处理警告。`);
} else {
  console.log(`结论：健康。`);
}
console.log(`${line}\n`);

process.exit(errors.length ? 1 : 0);
