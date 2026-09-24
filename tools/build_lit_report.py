#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_lit_report.py -- 由分类结果生成文献地图报告（可重复生成）

用法：
    python tools/build_lit_report.py literature/文献分类.tsv literature/文献分类报告.md
"""
import sys
from collections import defaultdict

INTRO = """# 文献地图

> 本文件由 `tools/build_lit_report.py` 自动生成，**不要手改**，改脚本后重新生成。
> 生成依据：`literature/文献分类.tsv`
>
> - 分类依据是 **CrossRef 返回的真实标题**（DOI 解析），不是被截断的文件名
> - 分类判据只看论文的**决策对象**，不看它用了什么方法：
>   - **能量调度** —— 决策"什么时候充放多少电"（日前/日内调度、能量管理、需求响应、V2G 功率）
>   - **交通流分配** —— 决策"车走哪条路、去哪个站"（路径规划、交通分配、充电诱导、需求时空预测）
>   - **暂缓** —— 决策"在哪里建、建多大"（选址定容、技术经济、综述、政策），用户明确说暂缓
>
> ⚠️ 标注 `待确认` 的是同时含规划类词的边界论文，调度/分配只是其中一环，需人工定夺。

---

## 一、总体分布

"""


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding='utf-8-sig') as f:
        header = f.readline().rstrip('\n').split('\t')
        rows = [dict(zip(header, l.rstrip('\n').split('\t')))
                for l in f if l.strip()]

    groups = defaultdict(list)
    for r in rows:
        groups[r['分类']].append(r)

    order = ['01-能量调度', '02-交通流分配', '暂缓']
    labels = {
        '01-能量调度': '能量调度（当前重点 A）',
        '02-交通流分配': '交通流分配（当前重点 B）',
        '暂缓': '暂缓（规划/选址/综述/评估）',
    }

    out = [INTRO]
    out.append('| 分类 | 篇数 | 占比 | 被引合计 |\n|---|---|---|---|')
    for k in order:
        g = groups.get(k, [])
        cited = sum(int(r['被引']) for r in g if (r.get('被引') or '').strip().isdigit())
        out.append(f'| {labels[k]} | {len(g)} | {len(g)*100//len(rows)}% | {cited} |')
    out.append(f'| **合计** | **{len(rows)}** | 100% | |\n')

    # ── 各分类明细 ──
    for k in order:
        g = groups.get(k, [])
        if not g:
            continue
        out.append(f'\n## {labels[k]}（{len(g)} 篇）\n')
        out.append('| # | 星级 | 待确认 | 年 | 标题 | 期刊 | 被引 | DOI |')
        out.append('|---|---|---|---|---|---|---|---|')
        for i, r in enumerate(g, 1):
            title = r['标题'].replace('|', '\\|')
            out.append('| {} | {} | {} | {} | {} | {} | {} | {} |'.format(
                i, r['星级'], r['待确认'] or '', r['年份'], title,
                r['期刊'] or '-', r['被引'] or '-', r['DOI'] or '-'))

    # ── 待确认清单 ──
    amb = [r for r in rows if r.get('待确认')]
    if amb:
        out.append(f'\n## 待人工确认（{len(amb)} 篇）\n')
        for r in amb:
            out.append(f'- **[{r["分类"]}]** {r["标题"]}')
            out.append(f'  - 理由：{r["理由"]}')

    # ── 高价值论文（按被引）──
    top = sorted((r for r in rows if (r.get('被引') or '').strip().isdigit()),
                 key=lambda r: -int(r['被引']))[:15]
    out.append('\n## 高影响力文献 Top 15（按 CrossRef 被引）\n')
    out.append('> 用途：**优先读这些**——高被引通常意味着综述性强或方法被广泛复用。\n')
    out.append('| 被引 | 年 | 分类 | 标题 | 期刊 |')
    out.append('|---|---|---|---|---|')
    for r in top:
        out.append('| {} | {} | {} | {} | {} |'.format(
            r['被引'], r['年份'], r['分类'], r['标题'].replace('|', '\\|'), r['期刊'] or '-'))

    with open(dst, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')

    sys.stderr.write(f'wrote {dst}\n')


if __name__ == '__main__':
    main()
