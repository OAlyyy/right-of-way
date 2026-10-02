/* Bundles the project into single self-contained HTML files.
   node build.js
     dist/kreuzungstrainer.html  - standalone, open it anywhere, works offline
     dist/artifact.html          - body-only version for publishing as an Artifact
*/
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css  = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

/* a closing script tag inside JS text would end the inline block early */
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (!scripts.length) throw new Error('no script tags found in index.html');

const jsBundle = scripts
  .map(src => '/* ---------- ' + src + ' ---------- */\n' +
              safe(fs.readFileSync(path.join(root, src), 'utf8')))
  .join('\n');

const title    = (html.match(/<title>([\s\S]*?)<\/title>/) || [,'Kreuzungstrainer'])[1];
const fontLink = (html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/) || [''])[0];
const preconn  = [...html.matchAll(/<link rel="preconnect"[^>]*>/g)].map(m => m[0]).join('\n');

/* the icons travel inside the single file, so "Add to Home Screen" and the
   browser tab still show them when it is opened from disk */
const b64 = f => fs.readFileSync(path.join(root, f)).toString('base64');
const icons =
  '<link rel="apple-touch-icon" href="data:image/png;base64,' + b64('assets/icons/apple-touch-icon.png') + '">\n' +
  '<link rel="icon" href="data:image/png;base64,' + b64('assets/icons/favicon-32.png') + '" sizes="32x32" type="image/png">';

/* everything between <body> and the first script tag */
let body = html.split(/<body>/)[1].split(/<script src=/)[0];
body = body.replace(/\s*$/, '');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

/* ---------- 1. standalone ---------- */
const standalone = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#131210">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Kreuzung">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
${icons}
<title>${title}</title>
${preconn}
${fontLink}
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${jsBundle}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'dist', 'kreuzungstrainer.html'), standalone, 'utf8');

/* ---------- 2. artifact body ---------- */
const artifact = `<title>${title}</title>
${preconn}
${fontLink}
<style>
${css}
</style>
${body}
<script>
${jsBundle}
</script>
`;
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), artifact, 'utf8');

const kb = f => (fs.statSync(path.join(root, 'dist', f)).size / 1024).toFixed(0) + ' kB';
console.log('dist/kreuzungstrainer.html  ' + kb('kreuzungstrainer.html'));
console.log('dist/artifact.html          ' + kb('artifact.html'));
console.log('bundled ' + scripts.length + ' scripts + stylesheet');
