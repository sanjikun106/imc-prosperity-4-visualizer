const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_END_OF_CENTRAL_DIRECTORY_SEARCH = 0xffff + 22;

interface ZipEntry {
  compressionMethod: number;
  compressedSize: number;
  fileName: string;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  const startOffset = Math.max(0, view.byteLength - MAX_END_OF_CENTRAL_DIRECTORY_SEARCH);

  for (let offset = view.byteLength - 22; offset >= startOffset; offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('Zip archive is invalid.');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support zip extraction. Upload the .log file directly.');
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function extractEntryText(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<string> {
  if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Zip entry ${entry.fileName} is invalid.`);
  }

  const fileNameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraFieldLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressedData = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  let data: Uint8Array;
  if (entry.compressionMethod === 0) {
    data = compressedData;
  } else if (entry.compressionMethod === 8) {
    data = await inflateRaw(compressedData);
  } else {
    throw new Error(`Zip entry ${entry.fileName} uses an unsupported compression method.`);
  }

  return new TextDecoder().decode(data);
}

export async function extractLogFromZip(file: File): Promise<{ fileName: string; contents: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder();

  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(view);
  const centralDirectorySize = view.getUint32(endOfCentralDirectoryOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOfCentralDirectoryOffset + 16, true);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  const logEntries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  while (offset < centralDirectoryEnd) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error('Zip archive is invalid.');
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    if (!fileName.endsWith('/') && fileName.toLowerCase().endsWith('.log')) {
      logEntries.push({
        compressionMethod,
        compressedSize,
        fileName,
        localHeaderOffset,
      });
    }

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  if (logEntries.length === 0) {
    throw new Error('Zip archive does not contain a .log file.');
  }

  const entry = logEntries[0];
  return {
    fileName: entry.fileName.split('/').pop() || entry.fileName,
    contents: await extractEntryText(bytes, view, entry),
  };
}
