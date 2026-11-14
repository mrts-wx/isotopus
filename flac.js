const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function readExact(file, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) return null;
    offset += bytesRead;
  }
  return buffer;
}

function imageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

async function findMissingPictureMimes(file, size) {
  const handle = await fs.open(file, 'r');
  try {
    const signature = await readExact(handle, 4, 0);
    if (!signature || signature.toString('ascii') !== 'fLaC') return [];
    const edits = [];
    let position = 4;
    let last = false;
    while (!last && position + 4 <= size) {
      const header = await readExact(handle, 4, position);
      if (!header) return [];
      last = Boolean(header[0] & 0x80);
      const type = header[0] & 0x7f;
      const length = header.readUIntBE(1, 3);
      const payload = position + 4;
      if (payload + length > size) return [];
      if (type === 6 && length >= 32) {
        const prefix = await readExact(handle, 8, payload);
        if (!prefix) return [];
        const mimeLength = prefix.readUInt32BE(4);
        if (mimeLength === 0) {
          const descriptionLengthBytes = await readExact(handle, 4, payload + 8);
          if (!descriptionLengthBytes) return [];
          const descriptionLength = descriptionLengthBytes.readUInt32BE(0);
          const dataLengthOffset = payload + 28 + descriptionLength;
          if (dataLengthOffset + 4 > payload + length) { position = payload + length; continue; }
          const dataLengthBytes = await readExact(handle, 4, dataLengthOffset);
          if (!dataLengthBytes) return [];
          const dataLength = dataLengthBytes.readUInt32BE(0);
          const dataOffset = dataLengthOffset + 4;
          if (dataLength > payload + length - dataOffset) { position = payload + length; continue; }
          const imageHeader = await readExact(handle, Math.min(dataLength, 12), dataOffset);
          const mime = imageHeader && imageMime(imageHeader);
          if (mime && length + Buffer.byteLength(mime, 'ascii') <= 0xffffff) {
            edits.push({ position, length, mime });
          }
        }
      }
      position = payload + length;
    }
    return edits;
  } finally { await handle.close(); }
}

async function copyRange(source, target, start, end) {
  let position = start;
  while (position < end) {
    const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, end - position));
    const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new Error('Unexpected end of FLAC while repairing picture metadata');
    let written = 0;
    while (written < bytesRead) {
      const result = await target.write(buffer, written, bytesRead - written);
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
}

async function writeRepairCopy(sourcePath, targetPath, edits, size) {
  const source = await fs.open(sourcePath, 'r');
  const target = await fs.open(targetPath, 'wx', 0o600);
  try {
    let sourcePosition = 0;
    for (const edit of edits) {
      await copyRange(source, target, sourcePosition, edit.position);
      const header = await readExact(source, 4, edit.position);
      const nextBlockLength = edit.length + Buffer.byteLength(edit.mime, 'ascii');
      header.writeUIntBE(nextBlockLength, 1, 3);
      await target.writeFile(header);
      const pictureType = await readExact(source, 4, edit.position + 4);
      await target.writeFile(pictureType);
      const mime = Buffer.from(edit.mime, 'ascii');
      const mimeLength = Buffer.alloc(4);
      mimeLength.writeUInt32BE(mime.length);
      await target.writeFile(mimeLength);
      await target.writeFile(mime);
      sourcePosition = edit.position + 12;
    }
    await copyRange(source, target, sourcePosition, size);
    await target.sync();
  } finally {
    await source.close();
    await target.close();
  }
}

async function repairFlacPictureMime(file, cacheDirectory, stableId, signature) {
  if (path.extname(file).toLowerCase() !== '.flac' || !cacheDirectory) return '';
  const stat = await fs.stat(file);
  const edits = await findMissingPictureMimes(file, stat.size);
  if (!edits.length) return '';
  const signatureHash = crypto.createHash('sha256').update(signature).digest('hex').slice(0, 16);
  const directory = path.join(cacheDirectory, 'playable');
  const targetPath = path.join(directory, `${stableId}-${signatureHash}.flac`);
  try { await fs.access(targetPath); return targetPath; } catch {}
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeRepairCopy(file, tempPath, edits, stat.size);
    try { await fs.rename(tempPath, targetPath); }
    catch (error) {
      try { await fs.access(targetPath); await fs.rm(tempPath, { force: true }); }
      catch { throw error; }
    }
    return targetPath;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { repairFlacPictureMime };
