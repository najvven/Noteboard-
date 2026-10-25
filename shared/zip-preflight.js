export const MAX_ZIP_ENTRY_COUNT = 4_096;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 65_557;

const toBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error('ZIP archive input is invalid.');
};

const safeNumber = (value, label) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds supported limits.`);
  }
  return Number(value);
};

const findEndOfCentralDirectory = (view) => {
  const minimum = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new Error('ZIP central directory was not found.');
};

const readDirectoryMetadata = (view, eocdOffset) => {
  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  if (disk !== 0 || centralDisk !== 0) {
    throw new Error('Multi-disk ZIP archives are not supported.');
  }
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (
    entryCount !== 0xffff &&
    centralSize !== 0xffffffff &&
    centralOffset !== 0xffffffff
  ) {
    return { entryCount, centralSize, centralOffset };
  }

  const locatorOffset = eocdOffset - 20;
  if (
    locatorOffset < 0 ||
    view.getUint32(locatorOffset, true) !== ZIP64_LOCATOR_SIGNATURE
  ) {
    throw new Error('ZIP64 central directory locator is missing.');
  }
  const zip64Offset = safeNumber(
    view.getBigUint64(locatorOffset + 8, true),
    'ZIP64 directory offset',
  );
  if (
    zip64Offset + 56 > view.byteLength ||
    view.getUint32(zip64Offset, true) !== ZIP64_EOCD_SIGNATURE
  ) {
    throw new Error('ZIP64 central directory is invalid.');
  }
  return {
    entryCount: safeNumber(
      view.getBigUint64(zip64Offset + 32, true),
      'ZIP entry count',
    ),
    centralSize: safeNumber(
      view.getBigUint64(zip64Offset + 40, true),
      'ZIP central directory size',
    ),
    centralOffset: safeNumber(
      view.getBigUint64(zip64Offset + 48, true),
      'ZIP central directory offset',
    ),
  };
};

export function assertSafeZipDirectory(input, options = {}) {
  const bytes = toBytes(input);
  if (bytes.byteLength < 22) throw new Error('ZIP archive is incomplete.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const metadata = readDirectoryMetadata(view, eocdOffset);
  const maxEntries = options.maxEntries ?? MAX_ZIP_ENTRY_COUNT;
  if (metadata.entryCount > maxEntries) {
    throw new Error(`ZIP archive has too many entries (maximum ${maxEntries}).`);
  }
  const centralEnd = metadata.centralOffset + metadata.centralSize;
  if (
    metadata.centralOffset < 0 ||
    centralEnd > eocdOffset ||
    centralEnd > bytes.byteLength
  ) {
    throw new Error('ZIP central directory bounds are invalid.');
  }
  let cursor = metadata.centralOffset;
  let scannedEntries = 0;
  while (cursor < centralEnd) {
    if (
      cursor + 46 > centralEnd ||
      view.getUint32(cursor, true) !== CENTRAL_FILE_SIGNATURE
    ) {
      throw new Error('ZIP central directory entry is invalid.');
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    cursor += 46 + nameLength + extraLength + commentLength;
    scannedEntries += 1;
    if (scannedEntries > maxEntries) {
      throw new Error(`ZIP archive has too many entries (maximum ${maxEntries}).`);
    }
  }
  if (cursor !== centralEnd || scannedEntries !== metadata.entryCount) {
    throw new Error('ZIP central directory entry count is inconsistent.');
  }
  return { entryCount: scannedEntries };
}
