"""Template literals in UI positions: `Next in ${n} min` -> trf("Next in {0} min", n)."""
import re

POS = re.compile(r'(\.child\(\s*|\.tooltip\(\s*|accessibility_label\(\s*|\b(?:label|title|placeholder|hint|verb|detail|body|text|about|heading|note|empty|words):\s*)`')


def parse(s, i):
    """s[i-1] is the opening backtick. -> (end index after closing backtick, key, [expr]) or None."""
    key, exprs, n = [], [], 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            key.append(s[i:i + 2]); i += 2; continue
        if c == "`":
            return i + 1, "".join(key), exprs
        if c == "$" and s[i + 1:i + 2] == "{":
            j, depth, q = i + 2, 1, None
            while j < len(s) and depth:
                d = s[j]
                if q:
                    if d == "\\": j += 1
                    elif d == q: q = None
                elif d in "\"'": q = d
                elif d == "`":
                    r = parse(s, j + 1)
                    if r is None: return None
                    j = r[0] - 1
                elif d == "{": depth += 1
                elif d == "}": depth -= 1
                j += 1
            exprs.append(s[i + 2:j - 1].strip())
            key.append("{%d}" % n); n += 1
            i = j; continue
        key.append(c); i += 1
    return None


def find(s):
    """Every UI template literal with placeholders: (start of the backtick, end, key, exprs)."""
    for m in POS.finditer(s):
        r = parse(s, m.end())
        if r and r[2]:
            yield m.end() - 1, r[0], r[1], r[2]
