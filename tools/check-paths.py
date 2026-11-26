#!/usr/bin/env python3
"""Fail if a shipped file still points at a shepherdr data folder.

The code under mods/ is this package's own now (it began as a copy of Shepherdr, MIT, see THIRD_PARTY.md).
It is edited here directly and is not refreshed from any upstream.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEXT_EXT = {".js", ".py", ".sh", ".md", ".json", ".ts", ".swift", ".txt", ""}



def walk_text(top):
    for dirpath, dirs, files in os.walk(top):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__")]
        for name in files:
            ext = os.path.splitext(name)[1]
            if ext not in TEXT_EXT and name not in ("herdr-task", "herdr-artifact", "herdr-browser", "herdr-secret"):
                continue
            yield os.path.join(dirpath, name)


def check():
    bad = []
    roots = [os.path.join(ROOT, p) for p in ("mods", "bin", "templates", "lib")]
    needles = (".config/shepherdr", ".local/share/shepherdr", ".local/state/shepherdr",
               ".cache/shepherdr", ", \"shepherdr\")", "}/shepherdr", "SHEPHERDR_HOME")
    for top in roots:
        if not os.path.isdir(top):
            continue
        for path in walk_text(top):
            # attribution and comments may name the project; data folders may not
            try:
                text = open(path, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            for needle in needles:
                if needle in text:
                    bad.append(f"{os.path.relpath(path, ROOT)}: {needle}")
    if bad:
        print("shepherdr data paths still present:", file=sys.stderr)
        print("\n".join(bad[:40]), file=sys.stderr)
        sys.exit(1)
    print("paths ok")


if __name__ == "__main__":
    check()
