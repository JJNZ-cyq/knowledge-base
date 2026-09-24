---
title:       Windows 控制台 GBK 导致中文乱码
type:        踩坑卡
domain:      12-编程与工程
subdomain:   Python
tags:        [编码, GBK, UTF8, Windows]
status:      mastered
created:     2026-09-24
updated:     2026-09-24
symptom:     UnicodeEncodeError: 'gbk' codec can't encode character；或 print 中文显示成乱码
cause:       Windows 控制台默认用系统区域编码(GBK/936)，Python 把输出按 GBK 编码，遇到 GBK 装不下的字符就抛错
minimal_repro: 
source:      
---

# 🐛 Windows 控制台 GBK 导致中文乱码

## 症状
> 写在**报错信息里能搜到的字**，下次遇到同样的错，靠这句话命中。

```
UnicodeEncodeError: 'gbk' codec can't encode character '\u2705' in position 0: illegal multibyte sequence
```

或者没有报错，但 `print("中文")` 输出成 `�������`。

**注意区别**：这个错的触发点是 `print` 的**输出**，不是文件读取。
如果是读文件出错，那是另一个问题（读文件要显式指定 `encoding="utf-8"`）。

## 最小复现

```python
print("✅ 完成")     # 在 Windows 默认控制台下直接崩
```

## 根因
> 说清**机制**，不只是"这样写就好了"。

Windows 中文系统的控制台默认代码页是 **GBK(936)**。
Python 在启动时会读取这个代码页，作为标准输出 `sys.stdout` 的编码。
`print` 时字符串要编码成 GBK 才能写出，而 GBK **装不下** emoji 或某些字符，
于是抛 `UnicodeEncodeError`。

关键点：**这跟你的 .py 文件是什么编码无关**。文件是 UTF-8 也好、
字符串内容对不对也好，问题都出在"往外写的最后一步"。

## 正确写法

在脚本最前面（任何 `print` 之前）改掉标准输出的编码：

```python
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:      # Python < 3.7 没有 reconfigure
    pass
```

- `encoding="utf-8"`：按 UTF-8 输出，中文和 emoji 都能写
- `errors="replace"`：万一输出被重定向到不支持 UTF-8 的地方，
  宁可显示问号 **也不要让程序崩** —— 打印日志不该中断业务逻辑

**另一种做法**（全局设环境变量，不用改代码）：

```powershell
$env:PYTHONIOENCODING = 'utf-8'      # 只对当前窗口有效
```

缺点是不写进代码、换台机器或换个终端就失效，所以**推荐写进脚本**。

## 为什么容易踩

- 在 Linux/macOS 上完全不会遇到（那些系统默认 UTF-8），
  所以从网上抄的代码、教程里的代码都不带这个处理
- 只 `print` 英文时也不会报错，等到加了中文/emoji 才突然崩
- 报错信息指向的是"字符 U+2705 编不出来"，看起来像是字符串本身有问题，
  容易往"我的字符串是不是坏了"的方向查，而真实原因是**终端编码**

## 一行速查

```
UnicodeEncodeError gbk → 控制台编码是 GBK → sys.stdout.reconfigure(encoding="utf-8")
```

## 关联
- [[Python 环境用 uv 搭建]]
- [[Python 三引号嵌套会提前闭合字符串]]
