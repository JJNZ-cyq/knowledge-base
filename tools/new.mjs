/**
 * new.mjs —— 新建一张卡（自动放入正确目录 + 填好 frontmatter）
 *
 * 用法：
 *   node tools/new.mjs <卡型> --title "标题" [--domain 10-交能融合] [--sub 01-能量调度]
 *
 * 示例：
 *   node tools/new.mjs 知识卡 --domain 10-交能融合 --sub 01-能量调度 --title "日前调度的滚动修正"
 *   node tools/new.mjs 踩坑卡 --domain 12-编程与工程 --sub CPP --title "shared_ptr 循环引用不释放"
 *   node tools/new.mjs 问题卡 --title "双层规划何时能转单层"
 *   node tools/new.mjs 文献卡 --domain 10-交能融合 --sub 02-交通流分配 --title "li2025evcharging"
 *
 * 卡型：知识卡 | 永久卡 | 问题卡 | 文献卡 | 踩坑卡 | 项目速览
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);

// ── 参数解析 ────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(`用法: node tools/new.mjs <卡型> [--title "标题"] [--domain 领域] [--sub 子区]

卡型：
  知识卡      一个概念，用我自己的话写
  永久卡      可迁移的洞见（跨来源）
  问题卡      一个待验证的疑问
  文献卡      一篇文献的笔记（文件名建议用 citekey）
  踩坑卡      编程/工程踩的坑（症状 → 根因 → 最小复现）
  项目速览    一个 GitHub 项目 / 自己项目的登记

领域（--domain，受控取值）：
  10-交能融合   11-大模型   12-编程与工程   15-优化方法论   19-交叉   20-永久卡

子区（--sub）常用值：
  10-交能融合：  01-能量调度   02-交通流分配   09-其他
  12-编程与工程： CPP   Python   混合栈
  15-优化方法论： 建模范式   求解与工具   不确定性

不带 --title 时进入交互模式，逐项询问。`);
  process.exit(0);
}

const args = { title: '', domain: '', sub: '' };
let cardType = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--title') args.title = argv[++i] ?? '';
  else if (a === '--domain') args.domain = argv[++i] ?? '';
  else if (a === '--sub') args.sub = argv[++i] ?? '';
  else if (!a.startsWith('--') && !cardType) cardType = a;
}

// ── 交互模式 ────────────────────────────────────────────
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

if (!args.title) {
  const rl = createInterface({ input, output });
  const ask = async (q, def = '') => {
    const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
    return a || def;
  };
  if (!cardType) cardType = await ask('卡型 (知识卡/永久卡/问题卡/文献卡/踩坑卡/项目速览)', '知识卡');
  args.title = await ask('标题（简短、能当文件名）');
  args.domain = await ask('领域 domain', '10-交能融合');
  args.sub = await ask('子区 subdomain（可留空）', '');
  rl.close();
}

// ── 领域 → 目录映射 ─────────────────────────────────────
/** 目标目录解析：返回相对 ROOT 的目录路径 */
function resolveDir(type, domain, sub) {
  switch (type) {
    case '永久卡':
      return '20-永久卡';
    case '问题卡':
      return '30-问题卡';
    case '项目速览':
      return sub ? join('50-代码项目', sub) : '50-代码项目';
    case '文献卡': {
      const d = domain || '10-交能融合';
      const s = sub || '';
      if (d === '10-交能融合') return join(d, s || '09-其他', '文献笔记');
      return join(d, '文献笔记');
    }
    case '知识卡':
    case '踩坑卡': {
      const d = domain || '10-交能融合';
      const s = sub || '';
      if (d === '12-编程与工程') {
        // 编程领域按语言再分一层
        const langMap = { CPP: 'CPP', cpp: 'CPP', Python: 'Python', python: 'Python', 混合栈: '混合栈' };
        const lang = langMap[s] || 'CPP';
        if (lang === '混合栈') return join(d, '混合栈');
        const leaf = type === '踩坑卡' ? '工程实践' : '语言特性';
        return join(d, lang, leaf);
      }
      if (d === '15-优化方法论') return join(d, s || '建模范式');
      if (d === '11-大模型') return join(d, '知识卡');
      if (d === '19-交叉') return join(d, s || '大模型×交能融合');
      if (d === '20-永久卡') return '20-永久卡';
      if (d === '10-交能融合') return join(d, s || '09-其他', '知识卡');
      return d;
    }
    default:
      return null;
  }
}

const VALID_TYPES = ['知识卡', '永久卡', '问题卡', '文献卡', '踩坑卡', '项目速览'];
if (!VALID_TYPES.includes(cardType)) {
  console.error(`❌ 未知卡型：${cardType}`);
  console.error(`   合法值：${VALID_TYPES.join(' | ')}`);
  process.exit(1);
}

// ── 文件名清洗 ──────────────────────────────────────────
function sanitize(name) {
  let s = String(name).trim();
  // Windows 非法字符
  s = s.replace(/[\\/:*?"<>|]/g, '-');
  // 折叠空白
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 60) {
    console.warn(`⚠️  标题超过 60 字符，已截断到 60`);
    s = s.slice(0, 60).trim();
  }
  return s;
}

const safeTitle = sanitize(args.title);
if (!safeTitle) {
  console.error('❌ 标题为空，无法创建。');
  process.exit(1);
}

const targetDir = resolveDir(cardType, args.domain, args.sub);
if (!targetDir) {
  console.error(`❌ 无法解析目录：type=${cardType} domain=${args.domain} sub=${args.sub}`);
  process.exit(1);
}
const absDir = join(ROOT, targetDir);
mkdirSync(absDir, { recursive: true });

const filePath = join(absDir, `${safeTitle}.md`);
if (existsSync(filePath)) {
  console.error(`❌ 文件已存在，未覆盖：${filePath}`);
  console.error(`   换个标题，或先删掉旧文件。`);
  process.exit(1);
}

// ── frontmatter 构造 ────────────────────────────────────
const DOMAIN_OK = ['10-交能融合', '11-大模型', '12-编程与工程', '15-优化方法论', '19-交叉', '20-永久卡'];
const domain = args.domain && DOMAIN_OK.includes(args.domain) ? args.domain : (targetDir.split(/[\\/]/)[0]);

const yamlList = (arr) => `[${arr.join(', ')}]`;

const fm = {
  知识卡: `---
title:       ${safeTitle}
type:        知识卡
domain:      ${domain}
subdomain:   ${args.sub || ''}
tags:        []
status:      learning
created:     ${today}
updated:     ${today}
source:      
prereq:      []
used_in:     []
confidence:  3
reviewed:    
---`,
  永久卡: `---
title:       ${safeTitle}
type:        永久卡
domain:      20-永久卡
tags:        []
status:      learning
created:     ${today}
updated:     ${today}
derived_from: []
confidence:  3
reviewed:    
---`,
  问题卡: `---
title:       ${safeTitle}
type:        问题卡
domain:      30-问题卡
tags:        []
status:      learning
created:     ${today}
updated:     ${today}
hypothesis:  
verify_by:   
conclusion:  
closed_at:   
---`,
  文献卡: `---
title:       ${safeTitle}
type:        文献卡
domain:      ${domain}
subdomain:   ${args.sub || ''}
tags:        []
status:      inbox
created:     ${today}
updated:     ${today}
source:      zotero:${safeTitle}
problem:     
method:      
network:     
solver:      
data:        
gap:         
confidence:  3
reviewed:    
---`,
  踩坑卡: `---
title:       ${safeTitle}
type:        踩坑卡
domain:      ${domain}
subdomain:   ${args.sub || ''}
tags:        []
status:      learning
created:     ${today}
updated:     ${today}
symptom:     
cause:       
minimal_repro: 
source:      
---`,
  项目速览: `---
title:       ${safeTitle}
type:        项目速览
domain:      50-代码项目
tags:        []
status:      learning
created:     ${today}
updated:     ${today}
repo:        
commit:      
stack:       
my_use:      
---`,
}[cardType];

// ── 正文骨架 ────────────────────────────────────────────
const body = {
  知识卡: `
# ${safeTitle}

## 一句话
> 不看原文，用我自己的话讲一遍。（写不出来 → status 保持 learning）

## 展开

### 它是什么

### 为什么是这样（机制/理由）

### 什么时候会失效（边界条件）

## 前置知识
- [[]]

## 我在哪里用过
- 

## 关联
- [[]]

## 待验证
- [ ] 
`,
  永久卡: `
# ${safeTitle}

## 核心洞见
> 一句能被别的场景复用的话。**不能迁移的结论，不是永久卡，是知识卡。**

## 它把哪些东西连起来了

| 来源卡 | 它贡献了什么 |
|---|---|
| [[]] |  |

## 它改变了我的什么判断 / 做法

## 反例与边界
> 这条洞见什么时候不成立？

## 关联
- [[]]
`,
  问题卡: `
# ❓ ${safeTitle}

## 问题描述
> 要具体到能设计一个验证动作。"怎么学好优化"不是问题，"双层规划什么时候能转成单层"是。

## 当前理解
> 现在我认为答案是……

## 假设
> 

## 验证方式
- [ ] 

## 结论
> 验证完成后回来填。填完记得：**结论若可迁移，升级成永久卡。**

## 关联
- [[]]
`,
  文献卡: `
# ${safeTitle}

> citekey：\`${safeTitle}\` · 期刊： · 年份：
> 元数据以 Zotero 为准，此处不重复记录。

## 作者主张什么（一句话）

## 用什么方法证明

## 关键建模细节
> 只记**能复现**的细节：目标函数、约束类型、求解规模、关键假设。

## 实验与算例
- 数据来源：
- 对比基准：
- 主要结果：

## 局限与我没被说服的地方

## 对我有什么用
> 空着很正常。**空着不代表要删，代表还没想清楚——这才是要解决的问题。**

## 由此产出的知识卡
- [[]]

## 关联
- [[]]
`,
  踩坑卡: `
# 🐛 ${safeTitle}

## 症状
> 写在**报错信息里能搜到的字**。下次遇到同样的错误，靠这句话命中。

\`\`\`
（粘贴报错原文）
\`\`\`

## 最小复现
> 代码放 \`90-附件/cpp-snippets/${safeTitle}.cpp\`，必须**能编译**。

\`\`\`cpp
// 最小可编译片段
\`\`\`

## 根因
> 说清**机制**，不只是"这样写就好了"。

## 正确写法

## 为什么容易踩
> 哪些直觉会把人带到这个坑里？

## 一行速查
\`\`\`
症状关键词 → 原因关键词 → 解法关键词
\`\`\`

## 关联
- [[]]
`,
  项目速览: `
# 🧩 ${safeTitle}

> 源码位置：\`E:\\repos\\${safeTitle}\`（**不放库内**）
> \`\`\`
> repo:   <url>
> commit: <hash>   ← 必须记！否则半年后笔记与源码对不上
> \`\`\`

## 它解决什么问题（一句话）

## 为什么值得看

## 技术栈与规模
- 语言：
- 构建：
- 依赖：

## 入口在哪
| 文件 | 关键函数/类 | 作用 |
|---|---|---|
|  |  |  |

## 我打算怎么用 / 改它

## 可借鉴的设计

## 关联
- [[]]
`,
}[cardType];

writeFileSync(filePath, `${fm}\n${body}`, 'utf8');

const rel = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
console.log(`✅ 已创建 ${cardType}`);
console.log(`   路径：${rel}`);
console.log(`   领域：${domain}${args.sub ? ' / ' + args.sub : ''}`);
