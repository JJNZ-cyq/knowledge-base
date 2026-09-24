---
title:       Python 环境用 uv 搭建
type:        知识卡
domain:      12-编程与工程
subdomain:   Python
tags:        [uv, 虚拟环境, 依赖管理]
status:      learning
created:     2026-09-24
updated:     2026-09-24
source:      
prereq:      []
used_in:     ["编程学习路径 阶段1"]
confidence:  5
reviewed:    2026-09-24
---

# Python 环境用 uv 搭建

## 一句话
> uv 一个工具同时管 Python 版本、虚拟环境和依赖，每个项目一个独立环境，
> 互不污染——取代了以前"装 Anaconda + conda create + pip install"那套。

## 展开

### 它是什么

`uv` 是 Rust 写的 Python 包与环境管理器。它把三件事合成一条命令：

| 以前要做的 | 现在 |
|---|---|
| 装 Anaconda / 手动下 Python | `uv python install 3.12` |
| `conda create -n xxx` / `python -m venv` | `uv init` 自动建 `.venv` |
| `pip install` + `pip freeze` | `uv add numpy`（自动写进 `pyproject.toml`） |

### 为什么是这样（机制/理由）

- **每个项目一个 `.venv`**：依赖装在项目目录里，不装到全局。所以 A 项目要
  numpy 1.x、B 项目要 numpy 2.x 也不冲突。
- **`pyproject.toml` + `uv.lock`**：前者声明"我要什么"，后者锁定"实际装的精确版本"。
  换电脑时 `uv sync` 就能还原出完全一样的环境。
- **`uv run`**：临时激活环境执行脚本，不需要先 `activate`，也就不会忘记激活。

### 什么时候会失效（边界条件）

- 项目**需要编译型依赖**（如某些科学库无预编译 wheel）时，uv 仍要调用系统编译器，
  这时和 pip 一样可能失败。
- 团队里其他人用 conda 时，混用可能产生两套环境认知混乱。
- **Gurobi 例外**：它是商业求解器，需要单独装且**需要 license**，
  只 `uv add gurobipy` 可能跑不通（要配 Gurobi 的 license 文件）。

## 本机实测结果（2026-09-24）

```powershell
cd E:\projects
uv init py-learn --python 3.12 --no-workspace
cd py-learn
uv add numpy pandas matplotlib
uv run main.py
```

装出来的版本：Python 3.12.13 / NumPy 2.5.3 / pandas 3.0.6 / matplotlib 3.11.2
自检脚本 `main.py` 跑通并生成了 `load_curve.png`。

> 本机 `uv` 里已有一个 Python 3.11.15，但 `uv init --python 3.12` 会自己下载 3.12.13，
> 不需要手动装。

## 常用命令

```powershell
uv run main.py        # 用项目环境运行脚本（不用先 activate）
uv add <包名>          # 加依赖，自动写入 pyproject.toml
uv remove <包名>       # 删依赖
uv sync               # 按 pyproject.toml 还原环境（换电脑后用）
uv python list        # 看本机有哪些 Python
```

## 为什么不用 Anaconda

本机 Anaconda 是 **Python 3.8.8**（偏旧），而且是**全局环境**——
装错包会影响所有项目，且很难查清某个包是谁装的。
uv 的隔离性正好解决这一点。

## 前置知识
- 无（这是第一张卡，零基础起点）

## 我在哪里用过
- `E:\projects\py-learn`（学习环境，已可用）

## 关联
- [[Windows 控制台 GBK 导致中文乱码]]
- [[Python 三引号嵌套会提前闭合字符串]]

## 待验证
- [ ] Gurobi 在本机是否需要额外配 license 才能用
