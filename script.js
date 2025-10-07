"use strict";

// Hologram Converter - Offline only
// - Supported inputs: MP4, JPG, PNG, GIF
// - Output: single .bin Blob following a simple custom header + raw RGBA pixel data
// - This is a SIMPLIFIED demo format, not a specific vendor's .bin

(function () {
  /**
   * Simple .bin header (little-endian):
   * [0..3]   magic bytes: 'HOGN'
   * [4]      version: 1
   * [5]      mediaType: 1=image, 2=video, 3=raw
   * [6..7]   width (Uint16)
   * [8..9]   height (Uint16)
   * [10..11] frames (Uint16), 1 for images
   * [12..13] fps (Uint16), 0 for images
   * [14]     pixelFormat: 2=RGBA
   * [15]     reserved
   * [16..]   payload bytes (frames * width * height * 4)
   */
  const HEADER_SIZE = 16;
  const MAGIC = [0x48, 0x4f, 0x47, 0x4e]; // 'HOGN'
  const MEDIA = { IMAGE: 1, VIDEO: 2, RAW: 3 };
  const PIXEL_FORMAT = { RGBA: 2 };

  const ACCEPTED_MIME = new Set([
    "video/mp4",
    "image/jpeg",
    "image/png",
    "image/gif",
  ]);

  const elements = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    resolution: document.getElementById("resolution"),
    removeBg: document.getElementById("removeBg"),
    convertBtn: document.getElementById("convertBtn"),
    progressWrap: document.getElementById("progressWrap"),
    progress: document.getElementById("progress"),
    progressLabel: document.getElementById("progressLabel"),
    queue: document.getElementById("queue"),
    results: document.getElementById("results"),
  };

  /** Selected files waiting for conversion */
  let selectedFiles = [];

  // Wire up UI events
  elements.fileInput.addEventListener("change", (e) => {
    pushFiles([...e.target.files]);
  });

  // Drag & drop
  ["dragenter", "dragover"].forEach((evt) => {
    elements.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      elements.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    elements.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (evt === "drop") {
        const files = [...(e.dataTransfer?.files || [])];
        pushFiles(files);
      }
      elements.dropzone.classList.remove("dragover");
    });
  });

  // Click to open file chooser
  elements.dropzone.addEventListener("click", () => elements.fileInput.click());

  // Convert button
  elements.convertBtn.addEventListener("click", async () => {
    if (selectedFiles.length === 0) return;
    disableUI(true);
    resetProgress();
    setProgress("Starting conversion…", 0);

    const dim = parseInt(elements.resolution.value, 10) || 512;
    const removeBg = elements.removeBg.checked;

    // Process sequentially to simplify progress UX
    elements.results.innerHTML = "";

    let fileIndex = 0;
    for (const file of selectedFiles) {
      fileIndex++;
      const fileLabel = `${file.name} (${fileIndex}/${selectedFiles.length})`;
      setProgress(`Converting ${fileLabel}`, Math.round(((fileIndex - 1) / selectedFiles.length) * 100));

      try {
        const result = await convertFileToBin(file, dim, removeBg, (ratio, note) => {
          // Per-file frame progress
          const overall = ((fileIndex - 1) + ratio) / selectedFiles.length;
          setProgress(`Converting ${fileLabel}${note ? ` – ${note}` : ""}`, Math.round(overall * 100));
        });
        addResultCard(file, result.blob, result.meta);
      } catch (err) {
        console.error(err);
        addErrorCard(file, err);
      }
    }

    setProgress("Done", 100);
    disableUI(false);
    // clear queue but keep selectedFiles; user can reconvert or add more
  });

  function pushFiles(files) {
    const valid = files.filter((f) => ACCEPTED_MIME.has(f.type));
    const skipped = files.filter((f) => !ACCEPTED_MIME.has(f.type));

    selectedFiles.push(...valid);

    if (selectedFiles.length > 0) {
      elements.convertBtn.disabled = false;
    }

    const labels = selectedFiles.map((f) => f.name).join(", ");
    elements.queue.textContent = labels
      ? `In queue: ${labels}`
      : "";

    if (skipped.length) {
      const names = skipped.map((f) => f.name).join(", ");
      toast(`Skipped unsupported: ${names}`);
    }
  }

  function disableUI(disabled) {
    elements.fileInput.disabled = disabled;
    elements.resolution.disabled = disabled;
    elements.removeBg.disabled = disabled;
    elements.convertBtn.disabled = disabled;
  }

  function resetProgress() {
    elements.progressWrap.classList.remove("hidden");
    elements.progress.value = 0;
    elements.progressLabel.textContent = "";
  }

  function setProgress(label, value) {
    elements.progress.value = Math.max(0, Math.min(100, value || 0));
    elements.progressLabel.textContent = label || "";
  }

  function toast(msg) {
    elements.queue.textContent = msg;
    setTimeout(() => {
      if (elements.queue.textContent === msg) elements.queue.textContent = "";
    }, 4000);
  }

  function addResultCard(file, blob, meta) {
    const url = URL.createObjectURL(blob);
    const sizeKB = Math.round(blob.size / 1024);
    const el = document.createElement("div");
    el.className = "card";

    const name = `${stripExt(file.name)}_${meta.width}x${meta.height}${meta.frames > 1 ? `_${meta.frames}f@${meta.fps}` : ""}.bin`;

    el.innerHTML = `
      <h3>${escapeHtml(file.name)}</h3>
      <div class="meta">${meta.label}</div>
      <div class="actions">
        <a class="button" href="${url}" download="${name}">Download .bin (${sizeKB} KB)</a>
      </div>
    `;

    elements.results.prepend(el);
  }

  function addErrorCard(file, error) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3>${escapeHtml(file.name)}</h3>
      <div class="meta" style="color:#f87171;">Error: ${escapeHtml(String(error.message || error))}</div>
    `;
    elements.results.prepend(el);
  }

  function stripExt(name) {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function convertFileToBin(file, dim, removeBg, onProgress) {
    const mime = file.type;

    if (mime.startsWith("image/")) {
      const img = await loadImage(file);
      // Draw image onto a square canvas of the selected resolution.
      const { imageData, width, height } = drawImageToSquareCanvas(img, dim);

      // Optional JPG background removal: simple border-color similarity keying.
      if (removeBg && mime === "image/jpeg") {
        applySimpleBgRemoval(imageData, { tolerance: 28, sampleBorder: 8 });
      }

      const payload = imageData.data; // RGBA
      const header = createHeader({
        mediaType: MEDIA.IMAGE,
        width,
        height,
        frames: 1,
        fps: 0,
        pixelFormat: PIXEL_FORMAT.RGBA,
      });

      const blob = new Blob([header, payload], { type: "application/octet-stream" });
      onProgress?.(1, "image");
      return { blob, meta: { width, height, frames: 1, fps: 0, label: `Image → ${width}×${height} RGBA` } };
    }

    if (mime === "video/mp4") {
      // Extract frames at a small FPS to keep sizes reasonable.
      const fps = 6; // Adjust FPS here to trade off smoothness vs file size
      const maxFrames = 90; // Safety cap
      const { frames, width, height, actualFps } = await sampleVideoFrames(file, dim, fps, maxFrames, onProgress);

      const header = createHeader({
        mediaType: MEDIA.VIDEO,
        width,
        height,
        frames: frames.length,
        fps: actualFps,
        pixelFormat: PIXEL_FORMAT.RGBA,
      });

      const parts = [header, ...frames.map((f) => f.data.buffer)];
      const blob = new Blob(parts, { type: "application/octet-stream" });
      onProgress?.(1, `${frames.length} frames`);
      return { blob, meta: { width, height, frames: frames.length, fps: actualFps, label: `Video → ${width}×${height}, ${frames.length}f@${actualFps}` } };
    }

    if (mime === "image/gif") {
      // Browser canvas will paint the currently displayed frame.
      const img = await loadImage(file);
      const { imageData, width, height } = drawImageToSquareCanvas(img, dim);

      const header = createHeader({
        mediaType: MEDIA.IMAGE,
        width,
        height,
        frames: 1,
        fps: 0,
        pixelFormat: PIXEL_FORMAT.RGBA,
      });
      const blob = new Blob([header, imageData.data], { type: "application/octet-stream" });
      onProgress?.(1, "gif first frame");
      return { blob, meta: { width, height, frames: 1, fps: 0, label: `GIF (first frame) → ${width}×${height}` } };
    }

    // Fallback: raw bytes wrapped as RAW mediaType
    const raw = new Uint8Array(await file.arrayBuffer());
    const header = createHeader({
      mediaType: MEDIA.RAW,
      width: 0,
      height: 0,
      frames: 1,
      fps: 0,
      pixelFormat: PIXEL_FORMAT.RGBA,
    });
    const blob = new Blob([header, raw], { type: "application/octet-stream" });
    onProgress?.(1, "raw");
    return { blob, meta: { width: 0, height: 0, frames: 1, fps: 0, label: `Raw bytes (${raw.byteLength} B)` } };
  }

  function createHeader({ mediaType, width, height, frames, fps, pixelFormat }) {
    const buff = new ArrayBuffer(HEADER_SIZE);
    const view = new DataView(buff);
    // Magic
    MAGIC.forEach((b, i) => view.setUint8(i, b));
    view.setUint8(4, 1); // version
    view.setUint8(5, mediaType);
    view.setUint16(6, width, true);
    view.setUint16(8, height, true);
    view.setUint16(10, frames, true);
    view.setUint16(12, fps, true);
    view.setUint8(14, pixelFormat);
    view.setUint8(15, 0);
    return buff;
  }

  function drawImageToSquareCanvas(img, dim) {
    // Choose how the image fits into the square canvas.
    // For LED fans, a square makes sense; we use "contain" to preserve aspect ratio and pad with transparency.
    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Clear with transparent background. If your device expects black background, fillRect with black.
    ctx.clearRect(0, 0, dim, dim);

    const scale = Math.min(dim / img.naturalWidth, dim / img.naturalHeight);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const x = Math.floor((dim - w) / 2);
    const y = Math.floor((dim - h) / 2);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x, y, w, h);

    const imageData = ctx.getImageData(0, 0, dim, dim);
    return { imageData, width: dim, height: dim };
  }

  function applySimpleBgRemoval(imageData, { tolerance = 28, sampleBorder = 8 } = {}) {
    // Very basic chroma-like key: sample border pixels to estimate background color, then zero alpha for similar pixels.
    // This works for simple white/near-solid backgrounds typical of JPG product photos.
    const { data, width, height } = imageData;
    const samples = [];

    // Sample pixels from the four borders
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 50))) {
      for (let x = 0; x < sampleBorder; x++) samples.push(readPixel(data, width, x, y));
      for (let x = width - sampleBorder; x < width; x++) samples.push(readPixel(data, width, x, y));
    }
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 50))) {
      for (let y = 0; y < sampleBorder; y++) samples.push(readPixel(data, width, x, y));
      for (let y = height - sampleBorder; y < height; y++) samples.push(readPixel(data, width, x, y));
    }

    const bg = averageColor(samples);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const dr = data[idx] - bg.r;
        const dg = data[idx + 1] - bg.g;
        const db = data[idx + 2] - bg.b;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist <= tolerance) {
          data[idx + 3] = 0; // make transparent
        }
      }
    }
  }

  function readPixel(data, width, x, y) {
    const i = (y * width + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  }

  function averageColor(colors) {
    if (!colors.length) return { r: 255, g: 255, b: 255 };
    let r = 0, g = 0, b = 0;
    for (const c of colors) { r += c.r; g += c.g; b += c.b; }
    r = Math.round(r / colors.length);
    g = Math.round(g / colors.length);
    b = Math.round(b / colors.length);
    return { r, g, b };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  }

  async function sampleVideoFrames(file, dim, targetFps, maxFrames, onProgress) {
    // Draw frames to a square canvas, preserving aspect ratio with transparent padding.
    // NOTE: Without a dedicated encoder, we store raw RGBA frames.
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    // Some browsers require a play-pause sequence to fully decode frames.
    await videoLoadedMetadata(video);

    const duration = Math.max(0, video.duration || 0);
    const fps = Math.max(1, Math.min(targetFps, 24));
    const totalDesiredFrames = duration ? Math.min(Math.ceil(duration * fps), maxFrames) : Math.min(1, maxFrames);

    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Pre-calc draw rectangle
    const naturalW = video.videoWidth || 1;
    const naturalH = video.videoHeight || 1;
    const scale = Math.min(dim / naturalW, dim / naturalH);
    const w = Math.round(naturalW * scale);
    const h = Math.round(naturalH * scale);
    const x = Math.floor((dim - w) / 2);
    const y = Math.floor((dim - h) / 2);

    const frames = [];

    // If no duration (rare), grab a single frame at t=0 after play-seek.
    if (!duration || totalDesiredFrames <= 1) {
      await seekSafely(video, 0);
      ctx.clearRect(0, 0, dim, dim);
      ctx.drawImage(video, x, y, w, h);
      frames.push(ctx.getImageData(0, 0, dim, dim));
      onProgress?.(1, "1 frame");
      URL.revokeObjectURL(url);
      return { frames, width: dim, height: dim, actualFps: 1 };
    }

    for (let i = 0; i < totalDesiredFrames; i++) {
      const t = (i / fps);
      await seekSafely(video, Math.min(t, duration - 0.001));
      ctx.clearRect(0, 0, dim, dim);
      ctx.drawImage(video, x, y, w, h);
      frames.push(ctx.getImageData(0, 0, dim, dim));
      const ratio = (i + 1) / totalDesiredFrames;
      onProgress?.(Math.min(0.95, ratio), `${i + 1}/${totalDesiredFrames} frames`);
    }

    URL.revokeObjectURL(url);
    return { frames, width: dim, height: dim, actualFps: fps };
  }

  function videoLoadedMetadata(video) {
    return new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Failed to load video metadata"));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onErr);
      };
      if (video.readyState >= 1) return resolve();
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onErr);
    });
  }

  function seekSafely(video, time) {
    return new Promise((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Video seek failed"));
      };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onErr);
      };

      try {
        video.currentTime = time;
      } catch (e) {
        cleanup();
        reject(new Error("Cannot seek video"));
        return;
      }

      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onErr);
    });
  }
})();
