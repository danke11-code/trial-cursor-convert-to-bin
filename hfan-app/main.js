// Hologram Fan Media Converter - browser-only implementation
// Single-file module for UI + core logic

const ui = {
  tabToBin: document.getElementById('tab-to-bin'),
  tabFromBin: document.getElementById('tab-from-bin'),
  panelToBin: document.getElementById('panel-to-bin'),
  panelFromBin: document.getElementById('panel-from-bin'),

  inputMedia: document.getElementById('input-media'),
  inputWidth: document.getElementById('input-width'),
  inputHeight: document.getElementById('input-height'),
  presetRes: document.getElementById('preset-res'),
  inputFps: document.getElementById('input-fps'),
  inputPixFmt: document.getElementById('input-pixfmt'),

  toggleBg: document.getElementById('toggle-bg'),
  inputKeyColor: document.getElementById('input-keycolor'),
  inputTolerance: document.getElementById('input-tolerance'),
  labelTolerance: document.getElementById('label-tolerance'),
  btnEyeDrop: document.getElementById('btn-eyedrop'),

  btnPreview: document.getElementById('btn-preview'),
  btnConvert: document.getElementById('btn-convert'),

  canvasPreview: document.getElementById('canvas-preview'),
  metaOut: document.getElementById('meta-out'),

  inputBin: document.getElementById('input-bin'),
  btnParseBin: document.getElementById('btn-parse-bin'),
  btnExportWebM: document.getElementById('btn-export-webm'),
  btnExportPNGs: document.getElementById('btn-export-pngs'),
  canvasBin: document.getElementById('canvas-bin'),
  metaBin: document.getElementById('meta-bin'),
};

ui.tabToBin.addEventListener('click', () => switchTab('to'));
ui.tabFromBin.addEventListener('click', () => switchTab('from'));
ui.presetRes.addEventListener('change', () => {
  const [w, h] = ui.presetRes.value.split('x').map(Number);
  ui.inputWidth.value = String(w);
  ui.inputHeight.value = String(h);
});
ui.inputTolerance.addEventListener('input', () => {
  ui.labelTolerance.textContent = String(ui.inputTolerance.value);
});
ui.btnEyeDrop.addEventListener('click', async () => {
  if (!('EyeDropper' in window)) {
    alert('EyeDropper API not supported. Use the color input.');
    return;
  }
  try {
    const eye = new window.EyeDropper();
    const result = await eye.open();
    ui.inputKeyColor.value = result.sRGBHex;
  } catch {}
});

ui.btnPreview.addEventListener('click', async () => {
  const file = ui.inputMedia.files?.[0];
  if (!file) return alert('Select a media file first.');
  const width = clampInt(ui.inputWidth.value, 16, 4096, 720);
  const height = clampInt(ui.inputHeight.value, 16, 4096, 720);
  const fps = clampInt(ui.inputFps.value, 1, 120, 30);

  try {
    const { frames } = await extractFramesAuto(file, width, height, fps, getBgOptions(file));
    if (frames.length === 0) throw new Error('No frames decoded');
    drawFrameToCanvas(ui.canvasPreview, frames[0], width, height);
    ui.metaOut.textContent = `Previewing 1/${frames.length} frame(s) at ${width}×${height}`;
  } catch (err) {
    console.error(err);
    alert('Failed to decode/preview this file. See console for details.');
  }
});

ui.btnConvert.addEventListener('click', async () => {
  const file = ui.inputMedia.files?.[0];
  if (!file) return alert('Select a media file first.');
  const width = clampInt(ui.inputWidth.value, 16, 4096, 720);
  const height = clampInt(ui.inputHeight.value, 16, 4096, 720);
  const fps = clampInt(ui.inputFps.value, 1, 120, 30);
  const pixelFormat = ui.inputPixFmt.value; // 'rgba8888' | 'rgb888' | 'rgb565'

  freezeUI(true);
  try {
    const { frames, derivedFps } = await extractFramesAuto(file, width, height, fps, getBgOptions(file));
    const useFps = derivedFps ?? fps;

    const binBuffer = packHfanBin(frames, width, height, useFps, pixelFormat);
    const outName = file.name.replace(/\.[^.]+$/, '') + `.bin`;
    downloadBlob(new Blob([binBuffer], { type: 'application/octet-stream' }), outName);

    drawFrameToCanvas(ui.canvasPreview, frames[0], width, height);
    ui.metaOut.textContent = `Packed ${frames.length} frame(s), ${width}×${height} at ${useFps} FPS`;
  } catch (err) {
    console.error(err);
    alert('Conversion failed. See console for details.');
  } finally {
    freezeUI(false);
  }
});

ui.btnParseBin.addEventListener('click', async () => {
  const file = ui.inputBin.files?.[0];
  if (!file) return alert('Select a .bin file first.');
  try {
    const ab = await file.arrayBuffer();
    const parsed = unpackHfanBin(ab);
    drawFrameToCanvas(ui.canvasBin, parsed.frames[0], parsed.width, parsed.height);
    ui.metaBin.textContent = `Parsed ${parsed.frames.length} frame(s), ${parsed.width}×${parsed.height} at ${parsed.fps} FPS — pixfmt ${parsed.pixelFormat}`;
    ui.canvasBin.width = parsed.width; ui.canvasBin.height = parsed.height;
    ui.btnExportWebM.disabled = false;
    ui.btnExportPNGs.disabled = false;
    window.__parsedBin = parsed; // stash for export actions
  } catch (err) {
    console.error(err);
    alert('Failed to parse .bin. See console for details.');
  }
});

ui.btnExportWebM.addEventListener('click', async () => {
  const parsed = window.__parsedBin;
  if (!parsed) return alert('Parse a .bin first.');
  freezeUI(true);
  try {
    const webm = await framesToWebM(parsed.frames, parsed.width, parsed.height, parsed.fps);
    downloadBlob(webm, 'export.webm');
  } catch (err) {
    console.error(err);
    alert('WebM export failed. See console for details.');
  } finally {
    freezeUI(false);
  }
});

ui.btnExportPNGs.addEventListener('click', async () => {
  const parsed = window.__parsedBin;
  if (!parsed) return alert('Parse a .bin first.');
  freezeUI(true);
  try {
    await exportFramesAsPNGs(parsed.frames, parsed.width, parsed.height, 'frame');
  } catch (err) {
    console.error(err);
    alert('PNG export failed. See console for details.');
  } finally {
    freezeUI(false);
  }
});

function switchTab(which) {
  const to = which === 'to';
  ui.tabToBin.classList.toggle('active', to);
  ui.tabFromBin.classList.toggle('active', !to);
  ui.panelToBin.classList.toggle('active', to);
  ui.panelFromBin.classList.toggle('active', !to);
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function freezeUI(locked) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = locked));
}

function getBgOptions(file) {
  const isJpeg = /jpeg/.test(file.type) || /\.jpe?g$/i.test(file.name);
  const enabled = ui.toggleBg.checked && isJpeg;
  const keyColor = hexToRgb(ui.inputKeyColor.value || '#00ff00');
  const tolerance = clampInt(ui.inputTolerance.value, 0, 100, 20);
  return enabled ? { enabled, keyColor, tolerance } : { enabled: false };
}

// ------------------------ BIN PACK / UNPACK ------------------------
const BIN_MAGIC = 0x4846414e; // 'HFAN'
const BIN_VERSION = 1;
const PIXFMT = {
  rgba8888: 0,
  rgb888: 1,
  rgb565: 2,
};

function bytesPerPixelFor(pixelFormat) {
  switch (pixelFormat) {
    case 'rgb565': return 2;
    case 'rgb888': return 3;
    case 'rgba8888':
    default: return 4;
  }
}

function packHfanBin(frames, width, height, fps, pixelFormat = 'rgba8888') {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('No frames to pack');
  const pixfmtCode = PIXFMT[pixelFormat] ?? 0;
  const bpp = bytesPerPixelFor(pixelFormat);
  const headerSize = 32; // fixed header size
  const frameBytes = width * height * bpp;
  const totalSize = headerSize + frameBytes * frames.length;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, BIN_MAGIC, true); offset += 4;
  view.setUint8(offset++, BIN_VERSION);
  view.setUint8(offset++, pixfmtCode);
  view.setUint8(offset++, 0); // reserved
  view.setUint8(offset++, 0); // reserved
  view.setUint16(offset, width, true); offset += 2;
  view.setUint16(offset, height, true); offset += 2;
  view.setUint16(offset, fps, true); offset += 2;
  view.setUint32(offset, frames.length, true); offset += 4;
  view.setUint32(offset, headerSize, true); offset += 4; // frame data offset
  view.setUint32(offset, 0, true); offset += 4; // reserved
  view.setUint16(offset, 0, true); offset += 2; // pad to 32
  view.setUint16(offset, 0, true); offset += 2; // pad to 32

  // Write frames
  let writePtr = headerSize;
  for (const frame of frames) {
    if (!(frame instanceof Uint8ClampedArray)) throw new Error('Frame must be Uint8ClampedArray');
    if (frame.length !== width * height * 4) throw new Error('Frame data must be RGBA8888');
    if (pixelFormat === 'rgba8888') {
      new Uint8Array(buffer, writePtr, frame.length).set(frame);
      writePtr += frame.length;
    } else if (pixelFormat === 'rgb888') {
      const dest = new Uint8Array(buffer, writePtr, frameBytes);
      for (let i = 0, j = 0; i < frame.length; i += 4, j += 3) {
        dest[j] = frame[i]; // R
        dest[j + 1] = frame[i + 1]; // G
        dest[j + 2] = frame[i + 2]; // B
      }
      writePtr += frameBytes;
    } else if (pixelFormat === 'rgb565') {
      const dest = new DataView(buffer, writePtr, frameBytes);
      let j = 0;
      for (let i = 0; i < frame.length; i += 4) {
        const r = frame[i] >> 3;   // 5 bits
        const g = frame[i + 1] >> 2; // 6 bits
        const b = frame[i + 2] >> 3; // 5 bits
        const v = (r << 11) | (g << 5) | b;
        dest.setUint16(j, v, true);
        j += 2;
      }
      writePtr += frameBytes;
    }
  }
  return buffer;
}

function unpackHfanBin(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  const magic = view.getUint32(offset, true); offset += 4;
  if (magic !== BIN_MAGIC) throw new Error('Invalid magic');
  const version = view.getUint8(offset++);
  if (version !== BIN_VERSION) throw new Error(`Unsupported version ${version}`);
  const pixfmtCode = view.getUint8(offset++);
  const pixelFormat = Object.keys(PIXFMT).find((k) => PIXFMT[k] === pixfmtCode) || 'rgba8888';
  offset += 2; // reserved
  const width = view.getUint16(offset, true); offset += 2;
  const height = view.getUint16(offset, true); offset += 2;
  const fps = view.getUint16(offset, true); offset += 2;
  const numFrames = view.getUint32(offset, true); offset += 4;
  const dataOffset = view.getUint32(offset, true); offset += 4;
  offset += 6; // reserved padding to 32

  const bpp = bytesPerPixelFor(pixelFormat);
  const frameBytes = width * height * bpp;
  const frames = [];

  let readPtr = dataOffset;
  for (let i = 0; i < numFrames; i++) {
    if (pixelFormat === 'rgba8888') {
      const bytes = new Uint8ClampedArray(buffer.slice(readPtr, readPtr + frameBytes));
      frames.push(bytes);
    } else if (pixelFormat === 'rgb888') {
      const src = new Uint8Array(buffer, readPtr, frameBytes);
      const dest = new Uint8ClampedArray(width * height * 4);
      for (let s = 0, d = 0; s < src.length; s += 3, d += 4) {
        dest[d] = src[s];
        dest[d + 1] = src[s + 1];
        dest[d + 2] = src[s + 2];
        dest[d + 3] = 255;
      }
      frames.push(dest);
    } else if (pixelFormat === 'rgb565') {
      const src = new DataView(buffer, readPtr, frameBytes);
      const dest = new Uint8ClampedArray(width * height * 4);
      let d = 0;
      for (let s = 0; s < frameBytes; s += 2) {
        const v = src.getUint16(s, true);
        const r = (v >> 11) & 0x1f;
        const g = (v >> 5) & 0x3f;
        const b = v & 0x1f;
        dest[d++] = (r << 3) | (r >> 2);
        dest[d++] = (g << 2) | (g >> 4);
        dest[d++] = (b << 3) | (b >> 2);
        dest[d++] = 255;
      }
      frames.push(dest);
    }
    readPtr += frameBytes;
  }

  return { width, height, fps, frames, pixelFormat };
}

// ------------------------ MEDIA DECODE ------------------------
async function extractFramesAuto(file, targetWidth, targetHeight, fps, bgOptions) {
  if (file.type.startsWith('video/')) {
    const frames = await extractFramesFromVideo(file, targetWidth, targetHeight, fps, bgOptions);
    return { frames };
  }
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    const { frames, derivedFps } = await extractFramesFromGif(file, targetWidth, targetHeight);
    return { frames, derivedFps };
  }
  if (file.type.startsWith('image/')) {
    const frame = await renderImageFileToFrame(file, targetWidth, targetHeight, bgOptions);
    return { frames: [frame] };
  }
  throw new Error(`Unsupported file type: ${file.type}`);
}

async function extractFramesFromVideo(file, targetWidth, targetHeight, fps, bgOptions) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  await waitForEvent(video, 'loadedmetadata');

  const duration = video.duration || 0;
  const totalFrames = Math.max(1, Math.floor(duration * fps));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth; canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const frames = [];
  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min((i / fps), Math.max(0, duration - 0.001));
    await seekVideo(video, t);
    drawSized(ctx, video, targetWidth, targetHeight);
    let imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    if (bgOptions?.enabled) {
      imageData = chromaKey(imageData, bgOptions.keyColor, bgOptions.tolerance);
      ctx.putImageData(imageData, 0, 0);
    }
    frames.push(imageData.data);
  }

  URL.revokeObjectURL(url);
  return frames;
}

async function extractFramesFromGif(file, targetWidth, targetHeight) {
  const frames = [];
  let derivedFps = undefined;
  if ('ImageDecoder' in window) {
    const ab = await file.arrayBuffer();
    const decoder = new ImageDecoder({ data: ab, type: 'image/gif' });
    await decoder.tracks.ready;
    const track = decoder.tracks.selected;
    const frameCount = track.frameCount;

    // Estimate FPS from average frame duration
    let totalMs = 0;
    for (let i = 0; i < frameCount; i++) {
      const { image, complete } = await decoder.decode({ frameIndex: i });
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth; canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      drawSized(ctx, image, targetWidth, targetHeight);
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      frames.push(imageData.data);
      const ms = image.duration?.milliseconds ?? image.duration ?? 0; // browser dependent
      totalMs += ms;
      image.close?.();
    }
    if (frameCount > 1 && totalMs > 0) {
      derivedFps = Math.round((frameCount * 1000) / totalMs);
    }
  } else {
    // Fallback: draw static first frame only
    const one = await renderImageFileToFrame(file, targetWidth, targetHeight, { enabled: false });
    frames.push(one);
  }
  return { frames, derivedFps };
}

async function renderImageFileToFrame(file, targetWidth, targetHeight, bgOptions) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth; canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  drawSized(ctx, bmp, targetWidth, targetHeight);
  let imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  if (bgOptions?.enabled) {
    imageData = chromaKey(imageData, bgOptions.keyColor, bgOptions.tolerance);
    ctx.putImageData(imageData, 0, 0);
  }
  return imageData.data;
}

function drawSized(ctx, source, targetWidth, targetHeight) {
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  // Fit, preserving aspect ratio, letterbox to target
  const sAspect = sw / sh;
  const tAspect = targetWidth / targetHeight;
  let dw = targetWidth, dh = targetHeight, dx = 0, dy = 0;
  if (sAspect > tAspect) {
    dh = Math.round(targetWidth / sAspect);
    dy = Math.floor((targetHeight - dh) / 2);
  } else {
    dw = Math.round(targetHeight * sAspect);
    dx = Math.floor((targetWidth - dw) / 2);
  }
  ctx.drawImage(source, dx, dy, dw, dh);
}

async function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => { cleanup(); reject(new Error('Video seek error')); };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    try { video.currentTime = time; } catch (e) { cleanup(); reject(e); }
  });
}

function waitForEvent(target, event) {
  return new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
}

// ------------------------ BACKGROUND REMOVAL ------------------------
function chromaKey(imageData, keyColor, tolerance) {
  const data = imageData.data;
  const key = keyColor; // {r,g,b}
  const threshold = Math.max(1, Math.floor((tolerance / 100) * 255));
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - key.r;
    const dg = data[i + 1] - key.g;
    const db = data[i + 2] - key.b;
    // Weighted distance to account for perceived brightness
    const distance = Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
    if (distance <= threshold) {
      data[i + 3] = 0; // make transparent
    }
  }
  return imageData;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  if (h.length === 6) {
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  } else if (h.length === 3) {
    return { r: ((bigint >> 8) & 15) * 17, g: ((bigint >> 4) & 15) * 17, b: (bigint & 15) * 17 };
  }
  return { r: 0, g: 255, b: 0 };
}

// ------------------------ RENDER / EXPORT ------------------------
function drawFrameToCanvas(canvas, rgba, width, height) {
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
}

async function framesToWebM(frames, width, height, fps) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(Math.min(60, Math.max(1, fps)));
  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8'
  });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => recorder.onstop = resolve);
  recorder.start();

  const frameDelay = Math.round(1000 / fps);
  const imageData = new ImageData(width, height);
  for (let i = 0; i < frames.length; i++) {
    imageData.data.set(frames[i]);
    ctx.putImageData(imageData, 0, 0);
    await sleep(frameDelay);
  }
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}

async function exportFramesAsPNGs(frames, width, height, baseName = 'frame') {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(width, height);
  for (let i = 0; i < frames.length; i++) {
    imageData.data.set(frames[i]);
    ctx.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    downloadBlob(blob, `${baseName}_${String(i + 1).padStart(4, '0')}.png`);
    await sleep(50); // throttle downloads
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Expose helpers for debugging
window.__HFAN__ = { packHfanBin, unpackHfanBin };
