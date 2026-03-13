import QRCode from "qrcode";
import { splitFile, encodePacket, type ChunkPacket } from "./chunk";

export function initSender(container: HTMLElement) {
  container.innerHTML = `
    <div class="sender-page">
      <h2>📤 發送檔案</h2>
      <div id="upload-area" class="upload-area">
        <p>點擊或拖曳檔案至此處</p>
        <input type="file" id="file-input" />
      </div>
      <div id="file-info" class="file-info hidden"></div>
      <div id="qr-player" class="qr-player hidden">
        <div class="qr-left">
          <canvas id="qr-canvas"></canvas>
          <div class="qr-controls">
            <button id="btn-slower">⏪ 慢速</button>
            <button id="btn-play-pause">⏸ 暫停</button>
            <span id="speed-label">500ms</span>
            <button id="btn-faster">快速 ⏩</button>
          </div>
          <p id="qr-progress"></p>
        </div>
        <div id="sender-chunk-grid" class="chunk-grid sender-chunk-grid"></div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector<HTMLInputElement>("#file-input")!;
  const uploadArea = container.querySelector<HTMLDivElement>("#upload-area")!;
  const fileInfo = container.querySelector<HTMLDivElement>("#file-info")!;
  const qrPlayer = container.querySelector<HTMLDivElement>("#qr-player")!;
  const qrCanvas = container.querySelector<HTMLCanvasElement>("#qr-canvas")!;
  const qrProgress =
    container.querySelector<HTMLParagraphElement>("#qr-progress")!;
  const speedLabel = container.querySelector<HTMLSpanElement>("#speed-label")!;
  const btnSlower = container.querySelector<HTMLButtonElement>("#btn-slower")!;
  const btnFaster = container.querySelector<HTMLButtonElement>("#btn-faster")!;
  const btnPlayPause =
    container.querySelector<HTMLButtonElement>("#btn-play-pause")!;
  const btnExitFs = container.querySelector<HTMLButtonElement>("#btn-exit-fs")!;
  const senderChunkGrid =
    container.querySelector<HTMLDivElement>("#sender-chunk-grid")!;

  // Use an inline Web Worker for the animation timer so it keeps firing
  // even when this browser tab is in the background (regular setInterval
  // gets throttled to ≥1 s in hidden tabs, breaking multi-device scanning).
  let animWorker: Worker | null = null;
  let intervalMs = 600;
  let currentFrame = 0;
  let qrDataUrls: string[] = [];
  let isPlaying = false;

  function createAnimWorker(): Worker {
    const code = `
      let timerId = null;
      self.onmessage = function(e) {
        if (e.data.type === 'start') {
          if (timerId) clearInterval(timerId);
          var frame = e.data.startFrame || 0;
          var total = e.data.total;
          var ms    = e.data.ms;
          timerId = setInterval(function() {
            frame = (frame + 1) % total;
            self.postMessage(frame);
          }, ms);
        } else if (e.data.type === 'stop') {
          if (timerId) clearInterval(timerId);
        } else if (e.data.type === 'setMs') {
          if (timerId) clearInterval(timerId);
          var f = e.data.frame;
          var t = e.data.total;
          var m = e.data.ms;
          timerId = setInterval(function() {
            f = (f + 1) % t;
            self.postMessage(f);
          }, m);
        }
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  }

  // Drag & drop
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("dragover");
  });
  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("dragover");
  });
  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("dragover");
    if (e.dataTransfer?.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) {
      handleFile(fileInput.files[0]);
    }
  });

  btnSlower.addEventListener("click", () => {
    intervalMs = Math.min(2000, intervalMs + 100);
    speedLabel.textContent = `${intervalMs}ms`;
    if (animWorker && qrDataUrls.length > 0) {
      animWorker.postMessage({
        type: "setMs",
        ms: intervalMs,
        frame: currentFrame,
        total: qrDataUrls.length,
      });
    }
  });

  btnFaster.addEventListener("click", () => {
    intervalMs = Math.max(200, intervalMs - 100);
    speedLabel.textContent = `${intervalMs}ms`;
    if (animWorker && qrDataUrls.length > 0) {
      animWorker.postMessage({
        type: "setMs",
        ms: intervalMs,
        frame: currentFrame,
        total: qrDataUrls.length,
      });
    }
  });

  btnPlayPause.addEventListener("click", () => {
    if (isPlaying) {
      animWorker?.postMessage({ type: "stop" });
      isPlaying = false;
      btnPlayPause.textContent = "▶ 播放";
    } else {
      isPlaying = true;
      btnPlayPause.textContent = "⏸ 暫停";
      startAnimation();
    }
  });

  async function handleFile(file: File) {
    fileInfo.classList.remove("hidden");
    fileInfo.innerHTML = `<p>📄 ${file.name} (${formatSize(file.size)})</p><p>正在產生 QR Code…</p>`;
    qrPlayer.classList.add("hidden");

    try {
      const packets: ChunkPacket[] = await splitFile(file);
      fileInfo.innerHTML = `<p>📄 ${file.name} (${formatSize(file.size)}) — 共 ${packets.length} 個分片</p>`;

      // Generate QR code data URLs
      qrDataUrls = [];
      for (const pkt of packets) {
        const payload = encodePacket(pkt);
        const dataUrl = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: "L",
          margin: 2,
          width: 400,
        });
        qrDataUrls.push(dataUrl);
      }

      // Build sender chunk grid
      buildSenderChunkGrid(packets.length);

      // Start animation
      qrPlayer.classList.remove("hidden");
      currentFrame = 0;
      isPlaying = true;
      btnPlayPause.textContent = "⏸ 暫停";
      speedLabel.textContent = `${intervalMs}ms`;
      startAnimation();
    } catch (err) {
      fileInfo.innerHTML = `<p class="error">❌ 錯誤：${(err as Error).message}</p>`;
    }
  }

  function startAnimation() {
    if (animWorker) {
      animWorker.postMessage({ type: "stop" });
      animWorker.terminate();
    }
    animWorker = createAnimWorker();
    animWorker.onmessage = (e: MessageEvent<number>) => {
      currentFrame = e.data;
      renderFrame();
    };
    renderFrame(); // show first frame immediately
    animWorker.postMessage({
      type: "start",
      startFrame: currentFrame,
      total: qrDataUrls.length,
      ms: intervalMs,
    });
  }

  function renderFrame() {
    // Draw QR data URL directly onto canvas
    const img = new Image();
    img.onload = () => {
      qrCanvas.width = img.width;
      qrCanvas.height = img.height;
      const ctx = qrCanvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
    };
    img.src = qrDataUrls[currentFrame];
    qrProgress.textContent = `分片 ${currentFrame + 1} / ${qrDataUrls.length}`;

    // Highlight active chunk cell
    senderChunkGrid
      .querySelectorAll<HTMLDivElement>(".chunk-cell")
      .forEach((cell, i) => {
        cell.classList.toggle("active", i === currentFrame);
      });
  }

  function buildSenderChunkGrid(total: number) {
    senderChunkGrid.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      cell.className = "chunk-cell";
      cell.dataset.index = String(i);
      cell.title = `分片 ${i + 1}`;
      cell.textContent = String(i + 1);
      cell.addEventListener("click", () => {
        currentFrame = i;
        if (isPlaying) {
          // Restart from the selected frame (terminates old worker to clear
          // any queued messages that could overwrite currentFrame).
          startAnimation();
        } else {
          // Paused: just show that frame without resuming playback.
          renderFrame();
        }
      });
      senderChunkGrid.appendChild(cell);
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
