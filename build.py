"""src/ のファイルをつなげて、配布用の index.html を作る。

使い方:  python build.py          index.html を作り直す
         python build.py --check  index.html が src/ と合っているかだけ確かめる（合っていなければ終了コード 1）

アプリは index.html 1つで動く（オフライン保存や配布がそのまま使える）。直すときは src/ を直して、これを実行する。
JavaScript は src/js/ の番号順につなげる。
"""
import glob, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def build():
    css = read('src', 'css', 'app.css').rstrip('\n')
    js = ''.join(read(p) for p in sorted(glob.glob(os.path.join(ROOT, 'src', 'js', '*.js')))).rstrip('\n')
    tpl = read('src', 'index.template.html')
    assert tpl.count('/* @css */') == 1 and tpl.count('/* @js */') == 1
    return tpl.replace('/* @css */', css).replace('/* @js */', js)


if __name__ == '__main__':
    out, path = build(), os.path.join(ROOT, 'index.html')
    if '--check' in sys.argv:
        ok = os.path.exists(path) and read('index.html') == out
        print('index.html is up to date' if ok else 'index.html is STALE: run python build.py')
        sys.exit(0 if ok else 1)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)
    print('wrote index.html (%d bytes)' % len(out.encode('utf-8')))
