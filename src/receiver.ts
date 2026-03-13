import jsQR from "jsqr";
import { decodePacket, type ChunkPacket } from "./chunk";

export function initReceiver(container: HTMLElement) {
  container.innerHTML = `
    <div class="receiver-page">
      <h2>📥 接收檔案</h2>
      <div class="source-select">
        <button id="btn-camera" class="primary">📷 使用相機</button>
        <button id="btn-screen" class="primary">🖥️ 螢幕擷取</button>
      </div>
      <div class="receiver-main">
        <div id="video-container" class="video-container hidden">
          <video id="video" autoplay playsinline muted></video>
          <canvas id="scan-canvas" class="hidden-canvas"></canvas>
          <span id="scan-indicator" class="scan-indicator waiting">🔍 等待 QR Code...</span>
        </div>
        <div class="receiver-right">
          <div id="receive-status" class="receive-status hidden">
            <p id="file-name-label"></p>
            <div id="progress-bar-wrapper" class="progress-bar-wrapper">
              <div id="progress-bar" class="progress-bar"></div>
            </div>
            <p id="progress-label"></p>
            <div id="chunk-grid" class="chunk-grid"></div>
          </div>
          <div id="download-section" class="download-section hidden">
            <p>✅ 所有分片接收完成！</p>
            <button id="btn-download" class="primary">💾 下載檔案</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const btnCamera = container.querySelector<HTMLButtonElement>("#btn-camera")!;
  const btnScreen = container.querySelector<HTMLButtonElement>("#btn-screen")!;
  const videoContainer =
    container.querySelector<HTMLDivElement>("#video-container")!;
  const video = container.querySelector<HTMLVideoElement>("#video")!;
  const scanCanvas =
    container.querySelector<HTMLCanvasElement>("#scan-canvas")!;
  const receiveStatus =
    container.querySelector<HTMLDivElement>("#receive-status")!;
  const fileNameLabel =
    container.querySelector<HTMLParagraphElement>("#file-name-label")!;
  const progressBar = container.querySelector<HTMLDivElement>("#progress-bar")!;
  const progressLabel =
    container.querySelector<HTMLParagraphElement>("#progress-label")!;
  const chunkGrid = container.querySelector<HTMLDivElement>("#chunk-grid")!;
  const downloadSection =
    container.querySelector<HTMLDivElement>("#download-section")!;
  const btnDownload =
    container.querySelector<HTMLButtonElement>("#btn-download")!;

  let scanning = false;
  let scanTimerId: ReturnType<typeof setInterval> | null = null;
  let scanCtx: CanvasRenderingContext2D | null = null;
  let lastDecodedData = "";
  let lastScanActivity = 0; // timestamp of last successful QR detection
  let receivedChunks: Map<number, Uint8Array> = new Map();
  let fileMeta: {
    fileHash: string;
    fileName: string;
    totalChunks: number;
  } | null = null;

  btnCamera.addEventListener("click", () => startCamera());
  btnScreen.addEventListener("click", () => startScreenCapture());
  btnDownload.addEventListener("click", () => downloadFile());

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      beginScanning(stream);
    } catch (err) {
      alert("無法存取相機：" + (err as Error).message);
    }
  }

  async function startScreenCapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      beginScanning(stream);
    } catch (err) {
      alert("無法擷取螢幕：" + (err as Error).message);
    }
  }

  function beginScanning(stream: MediaStream) {
    video.srcObject = stream;
    videoContainer.classList.remove("hidden");
    scanning = true;
    // Reset dedup cache so previously-seen QR data doesn't block re-detection
    // when scanning is restarted (e.g. user clicks camera button again).
    lastDecodedData = "";

    // Explicitly play the video (required on some browsers)
    video.play().catch(() => {});

    // Initialise canvas context once (willReadFrequently must be set first time)
    scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });

    // Use setInterval so scanning keeps running even in background / split-view tabs
    scanTimerId = setInterval(scanFrame, 150);

    // Handle stream ending (user stops sharing)
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", () => stopScanning());
    });
  }

  function stopScanning() {
    scanning = false;
    if (scanTimerId !== null) {
      clearInterval(scanTimerId);
      scanTimerId = null;
    }
  }

  function updateScanIndicator() {
    const indicator =
      container.querySelector<HTMLSpanElement>("#scan-indicator");
    if (!indicator) return;
    const age = Date.now() - lastScanActivity;
    if (lastScanActivity === 0) {
      indicator.textContent = "🔍 等待 QR Code...";
      indicator.className = "scan-indicator waiting";
    } else if (age < 500) {
      indicator.textContent = "✅ 偵測到 QR Code";
      indicator.className = "scan-indicator active";
    } else {
      indicator.textContent = `⚠️ ${(age / 1000).toFixed(0)}s 未偵測到 QR Code`;
      indicator.className = "scan-indicator inactive";
    }
  }

  function scanFrame() {
    if (!scanning || !scanCtx) return;
    if (video.readyState < video.HAVE_ENOUGH_DATA) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;

    // Only resize canvas when dimensions actually change
    if (scanCanvas.width !== w || scanCanvas.height !== h) {
      scanCanvas.width = w;
      scanCanvas.height = h;
    }

    scanCtx.drawImage(video, 0, 0, w, h);
    const imageData = scanCtx.getImageData(0, 0, w, h);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code?.data) {
      lastScanActivity = Date.now();
      // Only skip if the data is identical to the immediately previous frame
      // (avoids reprocessing the same static QR, but does not block cycling)
      if (code.data !== lastDecodedData) {
        lastDecodedData = code.data;
        try {
          const packet = decodePacket(code.data);
          handlePacket(packet);
        } catch {
          // Not a valid QIR packet, ignore
        }
      }
    }
    updateScanIndicator();
  }

  function handlePacket(packet: ChunkPacket) {
    // Initialize meta on first packet
    if (!fileMeta) {
      fileMeta = {
        fileHash: packet.fileHash,
        fileName: packet.fileName,
        totalChunks: packet.totalChunks,
      };
      receivedChunks = new Map();
      receiveStatus.classList.remove("hidden");
      fileNameLabel.textContent = `📄 ${packet.fileName}`;
      buildChunkGrid(packet.totalChunks);
    }

    // Verify same file
    if (packet.fileHash !== fileMeta.fileHash) return;

    // Store chunk if not already received
    if (!receivedChunks.has(packet.chunkIndex)) {
      receivedChunks.set(packet.chunkIndex, packet.data);
      updateProgress();
    }
  }

  function buildChunkGrid(total: number) {
    chunkGrid.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      cell.className = "chunk-cell";
      cell.dataset.index = String(i);
      cell.title = `分片 ${i + 1}`;
      cell.textContent = String(i + 1);
      chunkGrid.appendChild(cell);
    }
  }

  function updateProgress() {
    if (!fileMeta) return;
    const received = receivedChunks.size;
    const total = fileMeta.totalChunks;
    const pct = Math.round((received / total) * 100);

    progressBar.style.width = `${pct}%`;
    progressLabel.textContent = `已接收 ${received} / ${total} 分片 (${pct}%)`;

    // Update grid cells
    for (const [idx] of receivedChunks) {
      const cell = chunkGrid.querySelector<HTMLDivElement>(
        `[data-index="${idx}"]`,
      );
      if (cell) cell.classList.add("received");
    }

    // All done?
    if (received === total) {
      stopScanning();
      downloadSection.classList.remove("hidden");

      // Stop video tracks
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    }
  }

  function downloadFile() {
    if (!fileMeta) return;
    // Reassemble file
    const totalSize = Array.from(receivedChunks.values()).reduce(
      (s, c) => s + c.length,
      0,
    );
    const assembled = new Uint8Array(totalSize);
    let offset = 0;
    for (let i = 0; i < fileMeta.totalChunks; i++) {
      const chunk = receivedChunks.get(i)!;
      assembled.set(chunk, offset);
      offset += chunk.length;
    }

    const blob = new Blob([assembled]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileMeta.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
