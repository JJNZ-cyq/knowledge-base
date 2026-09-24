#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_inventory.py -- 合并 PDF 元数据与 CrossRef 结果，输出文献清单

用法：
    python tools/build_inventory.py <pdfmeta.json> <crossref.json> <out.tsv>

输出 TSV 列：
    idx  分组  年份  期刊  被引  标题  DOI  文件名
"""
import json
import sys


def main():
    meta = json.load(open(sys.argv[1], encoding='utf-8-sig'))
    cross = json.load(open(sys.argv[2], encoding='utf-8-sig'))
    dst = sys.argv[3]

    rows = []
    for r in meta:
        doi = (r.get('doi') or '').lower()
        c = cross.get(doi, {})
        title = c.get('title') or r.get('pdf_title') or '(无标题)'
        # CrossRef 偶尔会带 HTML 实体
        title = title.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        rows.append({
            'dir': r.get('dir', ''),
            'file': r.get('file', ''),
            'doi': doi,
            'year': c.get('year') or r.get('year') or '',
            'journal': c.get('journal', ''),
            'title': title,
            'cited': c.get('cited_by', ''),
            'author': c.get('first_author', ''),
        })

    # 按期刊+年份排序，方便人工核对
    rows.sort(key=lambda x: (x['dir'], x['journal'], x['year'], x['title']))

    with open(dst, 'w', encoding='utf-8') as f:
        f.write('idx\tgroup\tyear\tjournal\tcited\ttitle\tdoi\tfile\n')
        for i, r in enumerate(rows, 1):
            f.write('\t'.join([
                str(i),
                r['dir'],
                str(r['year']),
                r['journal'] or '-',
                str(r['cited']),
                r['title'],
                r['doi'] or '-',
                r['file'],
            ]) + '\n')

    sys.stderr.write(f'wrote {len(rows)} rows to {dst}\n')
    missing = [r['title'] for r in rows if r['title'] == '(无标题)']
    sys.stderr.write(f'no-title: {len(missing)}\n')
    for m in missing:
        sys.stderr.write(f'  {m}\n')


if __name__ == '__main__':
    main()
