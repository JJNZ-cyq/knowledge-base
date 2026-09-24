#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
extract_pdf_meta.py -- 批量提取 PDF 元数据，供文献分类使用

为什么需要它：档案里的文件名是被截断的（..._2025_Applied.pdf），
光看文件名分类不可靠。本脚本用 PyMuPDF 从 PDF 第一页取出真实标题、
DOI、期刊、年份，作为分类依据。

用法（在 Anaconda python 下）：
    python tools/extract_pdf_meta.py "E:/文献收集" > out.json
"""
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

DOI_RE = re.compile(r'\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)', re.I)
DOI_TAIL = re.compile(r'[.,;:)\]]+$')
YEAR_RE = re.compile(r'\b(19|20)\d{2}\b')


def clean(s):
    if not s:
        return ''
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def norm_doi(raw):
    if not raw:
        return ''
    d = DOI_TAIL.sub('', raw)
    # 有些 PDF 会在 DOI 后粘上 &domain=pdf 之类的参数
    d = d.split('&')[0].split('?')[0]
    return d.lower()


def extract(path):
    rec = {'file': path.name, 'dir': path.parent.name, 'ok': False}
    try:
        doc = fitz.open(path)
    except Exception as e:
        rec['error'] = f'open failed: {e}'
        return rec

    try:
        meta = doc.metadata or {}
        rec['pdf_title'] = clean(meta.get('title', ''))
        rec['pdf_subject'] = clean(meta.get('subject', ''))
        rec['pdf_author'] = clean(meta.get('author', ''))
        rec['pages'] = doc.page_count

        # 取前两页的文本：标题、DOI、期刊、年份基本都在这里
        text = ''
        for i in range(min(2, doc.page_count)):
            text += doc.load_page(i).get_text('text')
        text = clean(text)
        rec['head'] = text[:900]

        # DOI：优先含 doi.org 的上下文，其次第一个匹配
        m = re.search(r'(?:doi\.org/|doi:\s*)(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)', text, re.I)
        rec['doi'] = norm_doi(m.group(1)) if m else ''

        # 标题启发式：第一页文本的前几行里，最长的一行通常就是标题
        lines = [clean(x) for x in text.split('  ') if clean(x)]
        cand = [x for x in lines[:40] if 25 <= len(x) <= 220]
        rec['title_guess'] = max(cand, key=len) if cand else ''

        # 年份：优先 pdf_subject / 页面里的 © 20xx
        ym = re.search(r'©\s*((?:19|20)\d{2})', text)
        rec['year'] = ym.group(1) if ym else ''
        if not rec['year']:
            ys = YEAR_RE.findall(rec['pdf_subject'])
            rec['year'] = ys[-1] if ys else ''

        rec['ok'] = True
    except Exception as e:
        rec['error'] = f'extract failed: {e}'
    finally:
        doc.close()
    return rec


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else 'E:/文献收集')
    pdfs = sorted(p for p in root.rglob('*.pdf'))
    sys.stderr.write(f'found {len(pdfs)} pdfs\n')

    out = []
    for i, p in enumerate(pdfs, 1):
        rec = extract(p)
        rec['full'] = str(p).replace('\\', '/')
        out.append(rec)
        if i % 10 == 0:
            sys.stderr.write(f'  {i}/{len(pdfs)}\n')

    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stderr.write('done\n')


if __name__ == '__main__':
    main()
