"""Cache-busting for the no-build app: maps every JS module to ?v=<content hash> via an
import map in index.html, and adds that import map's hash to the CSP. Run after edits:
    python3 app/stamp.py
"""
import hashlib, base64, json, os, re
root = os.path.dirname(os.path.abspath(__file__))
idx = os.path.join(root, "index.html")
imports = {}
for d, _, files in os.walk(os.path.join(root, "js")):
    for f in sorted(files):
        if f.endswith(".js") and f != "theme-boot.js":
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            h = hashlib.sha1(open(p, "rb").read()).hexdigest()[:8]
            imports["./" + rel] = f"./{rel}?v={h}"
css = os.path.join(root, "css", "app.css")
css_v = hashlib.sha1(open(css, "rb").read()).hexdigest()[:8]
body = json.dumps({"imports": imports}, indent=1)
digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
s = open(idx).read()
s = re.sub(r'<script type="importmap">.*?</script>\n?', "", s, flags=re.S)
s = s.replace('<script type="module"', f'<script type="importmap">{body}</script>\n<script type="module"', 1)
s = re.sub(r'src="js/main\.js[^"]*"', f'src="{imports["./js/main.js"]}"', s)
s = re.sub(r'href="css/app\.css[^"]*"', f'href="css/app.css?v={css_v}"', s)
s = re.sub(r"script-src 'self'( 'sha256-[^']*')?", f"script-src 'self' 'sha256-{digest}'", s)
open(idx, "w").write(s)
print("stamped", len(imports), "modules")
