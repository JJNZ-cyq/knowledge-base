#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
classify_literature.py -- 按两个重点子区给文献分类

分类依据是 CrossRef 返回的真实标题（不是被截断的文件名）。

分类规则（只看论文的**决策对象**，不看它用了什么方法）：
  01-能量调度   决策对象是"什么时候充放多少电" —— 日前/日内调度、能量管理、
                需求响应、微网协同、V2G 功率控制
  02-交通流分配 决策对象是"车走哪条路、去哪个站" —— 路径规划、交通分配、
                充电诱导、充电需求时空预测、排队
  暂缓          决策对象是"在哪里建、建多大" —— 选址定容、技术经济评估、
                综述、政策与接受度、装置建模
                （存量文献的主体，用户明确说暂缓）

用法：
    python tools/classify_literature.py <inventory.tsv> <out.tsv>
"""
import re
import sys

# doi 片段 -> (分类, 星级, 一句话理由)
# 用 doi 片段匹配比用标题字符串稳，改标题不会失配
RULES = [
    # ── 01-能量调度 ──────────────────────────────────────────
    ('10.1016/j.egyr.2021.11.200', '01-能量调度', 3, '移动储能的时空最优调度，应急供电'),
    ('10.1016/j.compeleceng.2025.110227', '01-能量调度', 3, '主动配电网日前调度+重构，含EV停车场聚合商'),
    ('10.1016/j.energy.2024.133840', '01-能量调度', 3, '多微网日前优化，随机-鲁棒模型'),
    ('10.1016/j.epsr.2011.08.004', '01-能量调度', 2, '地铁交通系统能量管理（经典，被引93）'),
    ('10.1016/j.apenergy.2025.126410', '01-能量调度', 3, '电氢微网风险型数据驱动能量管理'),
    ('10.1016/j.csite.2025.105937', '01-能量调度', 2, '含可再生能源与混动车的微网能量管理'),
    ('10.1016/j.enconman.2025.120046', '01-能量调度', 3, '能量枢纽协同管理，含储氢与PEV预热的响应需求'),
    ('10.1016/j.ijhydene.2022.09.238', '01-能量调度', 3, '光-氢微网能量管理，V2G与电转气交易（被引83）'),
    ('10.1016/j.energy.2025.136720', '01-能量调度', 3, '快充枢纽与独立储能的联合运行，含公平性'),
    ('10.1016/j.jclepro.2024.144633', '01-能量调度', 2, '利用EV提升微网韧性的能量管理'),
    ('10.1016/j.scs.2024.105807', '01-能量调度', 3, '互联多能微网后悔感知优化，全碳消除'),
    ('10.1016/j.segan.2025.101926', '01-能量调度', 3, '光伏+储能充电站的能量管理策略，含神经网络解法'),
    ('10.1016/j.est.2025.116980', '01-能量调度', 3, '机场微网调频策略，V2G与航空器并网'),
    ('10.1016/j.epsr.2025.111546', '01-能量调度', 3, '配电网有序充放电，低碳灵活规划'),
    ('10.1016/j.apenergy.2025.127078', '01-能量调度', 2, '单向充电灵活性在规划与运行中的作用（瑞士）'),
    ('10.1016/j.rineng.2025.107106', '01-能量调度', 2, '太阳能-燃料电池混动车多目标能量管理'),

    # ── 02-交通流分配 ────────────────────────────────────────
    ('10.1016/j.apenergy.2025.126887', '02-交通流分配', 3, '网联车个性化路径规划，时间/能量/充电停靠联合优化'),
    ('10.1016/j.segan.2025.101952', '02-交通流分配', 3, 'Stackelberg 博弈的动态在线双边路径规划+充电诱导'),
    ('10.1016/j.segan.2025.101946', '02-交通流分配', 3, '车队规模/充电站/运行联合优化，城市交通网'),
    ('10.1016/j.trc.2025.105292', '02-交通流分配', 2, '模块化公交的充电调度与路径规划，非线性充电曲线'),
    ('10.1016/j.trd.2025.104605', '02-交通流分配', 3, '连续近似法做城市公共充电设施规划 ← 交通流建模经典范式'),
    ('10.1016/j.trb.2025.103291', '02-交通流分配', 3, '拥堵条件下的鲁棒规划 ← TR-B 方法论文'),
    ('10.1016/j.est.2025.118585', '02-交通流分配', 2, '基于续航里程的交通流建模，充电站与并联电容协同'),
    ('10.1016/j.est.2025.118419', '02-交通流分配', 3, '交通-电力系统规划运行综述 ← 建立领域框架，建议最先读'),
    ('10.1016/j.trip.2025.101639', '02-交通流分配', 2, '充电需求预测支撑公共充电设施选址'),
    ('10.1016/j.trd.2025.105058', '02-交通流分配', 2, '时空充电模式 → 局部供需规划'),
    ('10.1016/j.seta.2025.104547', '02-交通流分配', 2, '用交通数据与概率分布函数规划高速快充站'),
    ('10.1016/j.isci.2025.113368', '02-交通流分配', 2, '充电设施时空规划：需求估计 + 电网感知优化'),

    # ── 有显著运行/调度成分，但主体是规划 → 暂缓但标注 ────────
    ('10.1016/j.eswa.2025.129402', '暂缓', 2, '公交基建+车队+充电时刻联合优化（规划主体，含调度）'),
    ('10.1016/j.trd.2024.104584', '暂缓', 2, '快充公交系统规划与调度，含分布式光伏'),
    ('10.1016/j.expert', '暂缓', 1, ''),
]

# 按标题关键词兜底（RULES 未命中时）
KEYWORD_RULES = [
    (r'route planning|routing|path planning|traffic flow|traffic assignment|'
     r'user equilibrium|charging demand predict|demand forecasting|induced|'
     r'\bqueue|traffic network', '02-交通流分配', 2),
    (r'\bdispatch|scheduling|energy management|day-ahead|real-time control|'
     r'frequency control|demand response|orderly charging|peak shaving|'
     r'vehicle-to-grid|V2G', '01-能量调度', 2),
]

# 命中这些词说明主体是"在哪里建、建多大"，不是调度。
# 双重命中（既像调度又像规划）时标注出来，留人工判定，而不是硬猜。
PLANNING_HINT = re.compile(
    r'\bplanning|configuration|sizing|\bdesign\b|site selection|deployment|'
    r'placement|location|capacity|techno-economic|feasibility|review\b'
)


def classify(title, doi):
    t = (title or '').lower()
    for frag, cat, star, why in RULES:
        if frag and frag in (doi or '').lower():
            return cat, star, why, False
    for pat, cat, star in KEYWORD_RULES:
        m = re.search(pat, t)
        if m:
            # 同时含规划类词 = 边界论文，调度只是规划里的一环，标注待人工确认
            ambiguous = bool(PLANNING_HINT.search(t))
            why = '关键词命中：' + m.group(0)
            if ambiguous:
                why += '（⚠️ 同时含规划类词，请人工确认归属）'
            return cat, star, why, ambiguous
    return '暂缓', 0, '规划/选址定容/综述/评估类，非当前两个重点', False


def main():
    src, dst = sys.argv[1], sys.argv[2]
    rows = []
    with open(src, encoding='utf-8-sig') as f:
        header = f.readline().rstrip('\n').split('\t')
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 8:
                continue
            rows.append(dict(zip(header, parts)))

    out = []
    for r in rows:
        cat, star, why, ambiguous = classify(r.get('title', ''), r.get('doi', ''))
        out.append((cat, star, r, why, ambiguous))

    # 排序：分类 → 待确认排前面（先处理不确定的）→ 星级降序 → 年份降序
    order = {'01-能量调度': 0, '02-交通流分配': 1, '暂缓': 2}
    out.sort(key=lambda x: (order.get(x[0], 9), not x[4], -x[1], -int(x[2].get('year') or 0)))

    with open(dst, 'w', encoding='utf-8') as f:
        f.write('分类\t星级\t待确认\t年份\t标题\t期刊\t被引\tDOI\t原文件\t理由\n')
        for cat, star, r, why, amb in out:
            f.write('\t'.join([
                cat, '*' * star, '⚠️' if amb else '',
                str(r.get('year', '')),
                r.get('title', ''), r.get('journal', ''), str(r.get('cited', '')),
                r.get('doi', ''), r.get('file', ''), why,
            ]) + '\n')

    # 统计
    from collections import Counter
    c = Counter(x[0] for x in out)
    n_amb = sum(1 for x in out if x[4])
    sys.stderr.write(f'total {len(out)}\n')
    for k, v in sorted(c.items(), key=lambda kv: order.get(kv[0], 9)):
        sys.stderr.write(f'  {k}: {v}\n')
    sys.stderr.write(f'  其中待人工确认: {n_amb}\n')
    sys.stderr.write(f'wrote {dst}\n')


if __name__ == '__main__':
    main()
