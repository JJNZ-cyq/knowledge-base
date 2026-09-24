#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_crossref.py -- 用 DOI 从 CrossRef 拉取权威元数据

为什么用它：PDF 文件名被截断，内嵌标题又不可靠（子集字体）。
DOI 是唯一稳定标识，CrossRef 是 DOI 的官方注册库，返回的标题/期刊/年份可直接用。

用法：
    python tools/fetch_crossref.py "$env:TEMP/pdfmeta.json" "$env:TEMP\crossref.json"
"""
import json
import sys
import time
import urllib.request
import urllib.error

API = 'https://api.crossref.org/works'
# CrossRef 要求带 mailto 进入 "polite pool"，能显著降低被限流的概率
UA = 'knowledge-base-setup/1.0 (mailto:3104851265@qq.com)'


def fetch_batch(dois):
    url = API + '?filter=' + ','.join(f'doi:{d}' for d in dois) + '&rows=100'
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def pick(item):
    def first(k):
        v = item.get(k)
        return v[0] if isinstance(v, list) and v else (v or '')

    issued = item.get('issued', {}).get('date-parts', [['']])
    year = str(issued[0][0]) if issued and issued[0] else ''
    authors = item.get('author', []) or []
    first_author = ''
    if authors:
        a = authors[0]
        first_author = (a.get('family') or a.get('name') or '').strip()
    return {
        'title': first('title').strip(),
        'journal': (first('container-title') or '').strip(),
        'year': year,
        'first_author': first_author,
        'author_count': len(authors),
        'type': item.get('type', ''),
        'cited_by': item.get('is-referenced-by-count', 0),
    }


def main():
    src, dst = sys.argv[1], sys.argv[2]
    # utf-8-sig：容忍 BOM。Windows PowerShell 的 Out-File/-Encoding utf8 会写 BOM，
    # 而 json.load 遇 BOM 直接抛错。utf-8-sig 有 BOM 就去掉，没有也照常读。
    recs = json.load(open(src, encoding='utf-8-sig'))
    dois = sorted({r['doi'] for r in recs if r.get('doi')})
    sys.stderr.write(f'{len(dois)} dois to resolve\n')

    out = {}
    B = 50
    for i in range(0, len(dois), B):
        batch = dois[i:i + B]
        try:
            data = fetch_batch(batch)
        except urllib.error.HTTPError as e:
            sys.stderr.write(f'  HTTP {e.code} on batch {i//B}, falling back to单条\n')
            data = {'message': {'items': []}}
        for it in data.get('message', {}).get('items', []):
            d = (it.get('DOI') or '').lower()
            if d:
                out[d] = pick(it)
        sys.stderr.write(f'  batch {i//B + 1}: resolved {len(out)}/{len(dois)}\n')
        time.sleep(1)

    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    sys.stderr.write(f'done: {len(out)} resolved\n')


if __name__ == '__main__':
    main()
