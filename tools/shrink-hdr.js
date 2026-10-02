/* Shrinks the Poly Haven sky photos in assets/src/*.hdr to small copies
   in assets/hdri/ for lighting and reflections (the visible sky is drawn
   separately, so these only need to be sharp enough for car paint).
     node tools/shrink-hdr.js                                             */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SIZES = { sky_day: 512, sky_night: 256 };          // output width

function readHDR(buf){
  let p = 0, line = '', w = 0, h = 0;
  for (;;){                                             // header ends at the -Y line
    const c = buf[p++];
    if (c !== 10){ line += String.fromCharCode(c); continue; }
    const m = /^-Y (\d+) \+X (\d+)$/.exec(line);
    if (m){ h = +m[1]; w = +m[2]; break; }
    line = '';
  }
  const px = new Float32Array(w * h * 3), row = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++){
    if (buf[p] === 2 && buf[p+1] === 2 && !(buf[p+2] & 0x80)){
      p += 4;                                           // new-style RLE, channel by channel
      for (let ch = 0; ch < 4; ch++){
        let x = 0;
        while (x < w){
          let n = buf[p++];
          if (n > 128){ n -= 128; const v = buf[p++]; while (n--) row[(x++)*4 + ch] = v; }
          else while (n--) row[(x++)*4 + ch] = buf[p++];
        }
      }
    } else { buf.copy(Buffer.from(row.buffer), 0, p, p + w*4); p += w*4; }
    for (let x = 0; x < w; x++){
      const e = row[x*4+3], f = e ? Math.pow(2, e - 136) : 0, o = (y*w + x)*3;
      px[o] = row[x*4] * f; px[o+1] = row[x*4+1] * f; px[o+2] = row[x*4+2] * f;
    }
  }
  return { w, h, px };
}

function shrink(img, W){
  const k = img.w / W, H = Math.round(img.h / k), out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(y*k); yy < Math.floor((y+1)*k); yy++)
      for (let xx = Math.floor(x*k); xx < Math.floor((x+1)*k); xx++){
        const o = (yy*img.w + xx)*3; r += img.px[o]; g += img.px[o+1]; b += img.px[o+2]; n++;
      }
    const o = (y*W + x)*3; out[o] = r/n; out[o+1] = g/n; out[o+2] = b/n;
  }
  return { w:W, h:H, px:out };
}

function writeHDR(img){
  const parts = [Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ' + img.h + ' +X ' + img.w + '\n', 'latin1')];
  const row = new Uint8Array(img.w * 4);
  for (let y = 0; y < img.h; y++){
    for (let x = 0; x < img.w; x++){
      const o = (y*img.w + x)*3, m = Math.max(img.px[o], img.px[o+1], img.px[o+2]);
      if (m < 1e-32){ row.fill(0, x*4, x*4 + 4); continue; }
      const e = Math.ceil(Math.log2(m) + 1e-9), f = Math.pow(2, 8 - e);
      row[x*4] = Math.min(255, img.px[o]*f); row[x*4+1] = Math.min(255, img.px[o+1]*f);
      row[x*4+2] = Math.min(255, img.px[o+2]*f); row[x*4+3] = e + 128;
    }
    const enc = [2, 2, img.w >> 8, img.w & 255];        // RLE, plain chunks only
    for (let ch = 0; ch < 4; ch++)
      for (let x = 0; x < img.w; x += 128){
        const n = Math.min(128, img.w - x); enc.push(n);
        for (let i = 0; i < n; i++) enc.push(row[(x+i)*4 + ch]);
      }
    parts.push(Buffer.from(enc));
  }
  return Buffer.concat(parts);
}

fs.mkdirSync(path.join(ROOT, 'assets', 'hdri'), { recursive:true });
for (const [name, W] of Object.entries(SIZES)){
  const src = path.join(ROOT, 'assets', 'src', name + '.hdr');
  if (!fs.existsSync(src)){ console.log('missing ' + src + ' - run tools/fetch-lighting.js'); continue; }
  const out = writeHDR(shrink(readHDR(fs.readFileSync(src)), W));
  fs.writeFileSync(path.join(ROOT, 'assets', 'hdri', name + '.hdr'), out);
  console.log((out.length/1024).toFixed(0).padStart(5) + ' kB  assets/hdri/' + name + '.hdr');
}
