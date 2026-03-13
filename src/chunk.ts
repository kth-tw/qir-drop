/**
 * Each QR code frame contains a binary packet:
 *
 * Header (fixed part):
 *   [0..7]   8 bytes  - file hash (first 8 bytes of SHA-256)
 *   [8]      1 byte   - filename length (N)
 *   [9..8+N] N bytes  - filename (UTF-8)
 *
 * Header (after filename):
 *   [2 bytes] - chunk index (uint16 big-endian)
 *   [2 bytes] - total chunks (uint16 big-endian)
 *
 * Payload:
 *   remaining bytes - chunk data
 *
 * For QR code we encode the entire packet as base64
 * to stay within alphanumeric-friendly territory.
 */

export interface ChunkMeta {
  fileHash: string; // hex string (16 chars = 8 bytes)
  fileName: string;
  chunkIndex: number;
  totalChunks: number;
}

export interface ChunkPacket extends ChunkMeta {
  data: Uint8Array;
}

/** Max bytes we target per QR code (binary payload before base64).
 *  Keeping this at 700 raw bytes → ~933 base64 chars → QR version ~22,
 *  which is compact enough to be reliably scanned from a screen capture. */
export const MAX_RAW_CHUNK_BYTES = 700;

/**
 * Compute SHA-256 of a file and return the first 8 bytes as hex (16 chars).
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Split a file into chunk packets.
 */
export async function splitFile(file: File): Promise<ChunkPacket[]> {
  const fileHash = await computeFileHash(file);
  const fileName = file.name;

  // calculate effective data size per chunk (subtract header overhead)
  const fileNameBytes = new TextEncoder().encode(fileName);
  const headerSize = 8 + 1 + fileNameBytes.length + 2 + 2; // hash + fnLen + fn + idx + total
  const dataPerChunk = MAX_RAW_CHUNK_BYTES - headerSize;
  if (dataPerChunk <= 0) {
    throw new Error("Filename is too long for QR chunk header");
  }

  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const totalChunks = Math.ceil(fileBuffer.length / dataPerChunk);
  const packets: ChunkPacket[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * dataPerChunk;
    const end = Math.min(start + dataPerChunk, fileBuffer.length);
    packets.push({
      fileHash,
      fileName,
      chunkIndex: i,
      totalChunks,
      data: fileBuffer.slice(start, end),
    });
  }

  return packets;
}

/**
 * Serialize a ChunkPacket to a base64 string for embedding in a QR code.
 */
export function encodePacket(packet: ChunkPacket): string {
  const fileNameBytes = new TextEncoder().encode(packet.fileName);
  const hashBytes = hexToBytes(packet.fileHash);

  const totalLen = 8 + 1 + fileNameBytes.length + 2 + 2 + packet.data.length;
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  // file hash (8 bytes)
  buf.set(hashBytes, offset);
  offset += 8;

  // filename length + filename
  buf[offset++] = fileNameBytes.length;
  buf.set(fileNameBytes, offset);
  offset += fileNameBytes.length;

  // chunk index (uint16 BE)
  buf[offset++] = (packet.chunkIndex >> 8) & 0xff;
  buf[offset++] = packet.chunkIndex & 0xff;

  // total chunks (uint16 BE)
  buf[offset++] = (packet.totalChunks >> 8) & 0xff;
  buf[offset++] = packet.totalChunks & 0xff;

  // payload
  buf.set(packet.data, offset);

  return uint8ArrayToBase64(buf);
}

/**
 * Decode a base64 QR payload back into a ChunkPacket.
 */
export function decodePacket(base64: string): ChunkPacket {
  const buf = base64ToUint8Array(base64);
  let offset = 0;

  const hashBytes = buf.slice(offset, offset + 8);
  offset += 8;
  const fileHash = bytesToHex(hashBytes);

  const fileNameLen = buf[offset++];
  const fileNameBytes = buf.slice(offset, offset + fileNameLen);
  offset += fileNameLen;
  const fileName = new TextDecoder().decode(fileNameBytes);

  const chunkIndex = (buf[offset] << 8) | buf[offset + 1];
  offset += 2;

  const totalChunks = (buf[offset] << 8) | buf[offset + 1];
  offset += 2;

  const data = buf.slice(offset);

  return { fileHash, fileName, chunkIndex, totalChunks, data };
}

// ── helpers ──

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
