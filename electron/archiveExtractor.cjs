const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

const SUPPORTED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif']);

/**
 * Validates magic bytes for common image types.
 */
function detectImageMimeType(buffer) {
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mimeType: 'image/bmp', extension: 'bmp' };
  }
  if (buffer.length >= 12 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70 &&
      (buffer[8] === 0x61 || buffer[8] === 0x41) &&
      (buffer[9] === 0x76 || buffer[9] === 0x56) &&
      (buffer[10] === 0x69 || buffer[10] === 0x49) &&
      (buffer[11] === 0x66 || buffer[11] === 0x46)) {
    return { mimeType: 'image/avif', extension: 'avif' };
  }
  return null;
}

/**
 * Extracts supported image files from a ZIP or CBZ archive streamingly.
 * Includes Zip Slip path traversal protection and decompression bomb safeguards.
 * 
 * @param {string} zipFilePath - Path to the .zip or .cbz file on disk.
 * @param {string} destDir - Destination folder to extract images into.
 * @param {object} [options]
 * @param {number} [options.maxTotalBytes=2147483648] - Max cumulative uncompressed size (2 GB).
 * @param {number} [options.maxRatio=100] - Max expansion ratio per entry.
 * @returns {Promise<{ pages: Array<{ id: string, originalIndex: number, filename: string, extension: string, mimeType: string, sizeBytes: number, filePath: string }>, totalExtracted: number, skippedNonImages: number }>}
 */
function extractArchive(zipFilePath, destDir, options = {}) {
  const maxTotalBytes = options.maxTotalBytes || 2 * 1024 * 1024 * 1024; // 2GB
  const maxRatio = options.maxRatio || 100;

  return new Promise((resolve, reject) => {
    // Ensure destination directory exists and resolve canonical root
    fs.mkdirSync(destDir, { recursive: true });
    const canonicalDestDir = path.resolve(destDir);

    yauzl.open(zipFilePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) {
        return reject(new Error(`Failed to open archive: ${err.message}`));
      }

      const extractedEntries = [];
      let totalUncompressedBytes = 0;
      let skippedNonImages = 0;

      zipfile.on('error', (zipErr) => {
        reject(new Error(`Archive processing error: ${zipErr.message}`));
      });

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const rawFileName = entry.fileName;

        // 1. Skip directories
        if (/\/$/.test(rawFileName) || /\\$/.test(rawFileName)) {
          zipfile.readEntry();
          return;
        }

        // 2. Prune OS junk, hidden files, and __MACOSX metadata
        const normalized = rawFileName.replace(/\\/g, '/');
        const segments = normalized.split('/');
        const baseName = segments[segments.length - 1];

        if (
          normalized.includes('__MACOSX/') ||
          baseName.startsWith('.') ||
          baseName.toLowerCase() === 'thumbs.db' ||
          baseName.toLowerCase() === 'desktop.ini'
        ) {
          zipfile.readEntry();
          return;
        }

        // 3. Filter for supported image extensions
        const extMatch = baseName.match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : '';

        if (!ext || !SUPPORTED_IMAGE_EXTS.has(ext)) {
          skippedNonImages++;
          zipfile.readEntry();
          return;
        }

        // 4. Decompression bomb ratio check
        if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > maxRatio) {
          return reject(
            new Error(
              `Decompression bomb rejected: Entry "${rawFileName}" expansion ratio exceeds ${maxRatio}:1.`
            )
          );
        }

        // 5. Total uncompressed size limit check
        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > maxTotalBytes) {
          return reject(
            new Error(
              `Archive exceeds maximum size limit of ${Math.round(maxTotalBytes / (1024 * 1024))} MB.`
            )
          );
        }

        // 6. Zip Slip Protection: Validate path resolution
        const cleanBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
        // Prefix with index hash to ensure subfolder duplicates don't collide
        const uniqueDiskName = `${String(extractedEntries.length + 1).padStart(4, '0')}_${cleanBaseName}`;
        const targetPath = path.resolve(canonicalDestDir, uniqueDiskName);

        if (!targetPath.startsWith(canonicalDestDir + path.sep)) {
          return reject(
            new Error(
              `Security Exception: Entry "${rawFileName}" attempted directory traversal outside destination.`
            )
          );
        }

        // 7. Streaming extraction with byte guard
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            return reject(new Error(`Failed to read entry "${rawFileName}": ${streamErr.message}`));
          }

          const writeStream = fs.createWriteStream(targetPath);
          let bytesWritten = 0;

          readStream.on('data', (chunk) => {
            bytesWritten += chunk.length;
            if (bytesWritten > entry.uncompressedSize + 1024 * 64) {
              readStream.destroy();
              writeStream.destroy();
              reject(
                new Error(
                  `Decompression guard triggered: Entry "${rawFileName}" exceeded declared size.`
                )
              );
            }
          });

          readStream.on('error', (rErr) => {
            writeStream.destroy();
            reject(new Error(`Error decompressing "${rawFileName}": ${rErr.message}`));
          });

          writeStream.on('error', (wErr) => {
            readStream.destroy();
            reject(new Error(`Error writing "${targetPath}": ${wErr.message}`));
          });

          writeStream.on('finish', () => {
            try {
              // Read first 16 bytes for magic byte validation
              const headerBuf = Buffer.alloc(16);
              const fd = fs.openSync(targetPath, 'r');
              const bytesRead = fs.readSync(fd, headerBuf, 0, 16, 0);
              fs.closeSync(fd);

              const detected = detectImageMimeType(headerBuf.subarray(0, bytesRead));
              const mimeType = detected?.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
              const finalExt = detected?.extension || ext;

              extractedEntries.push({
                rawOriginalPath: normalized,
                uniqueDiskName,
                filePath: targetPath,
                sizeBytes: bytesWritten,
                extension: finalExt,
                mimeType,
              });

              zipfile.readEntry();
            } catch (inspectErr) {
              reject(new Error(`Failed to validate extracted image: ${inspectErr.message}`));
            }
          });

          readStream.pipe(writeStream);
        });
      });

      zipfile.on('end', () => {
        // Natural alphanumeric sort strictly based on original archive relative path
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        extractedEntries.sort((a, b) => collator.compare(a.rawOriginalPath, b.rawOriginalPath));

        // Rename files sequentially on disk to maintain clean 001.ext, 002.ext layout
        const finalPages = [];
        for (let i = 0; i < extractedEntries.length; i++) {
          const item = extractedEntries[i];
          const seqIndex = i + 1;
          const seqName = `${String(seqIndex).padStart(3, '0')}.${item.extension}`;
          const finalPath = path.join(canonicalDestDir, seqName);

          try {
            if (item.filePath !== finalPath) {
              if (fs.existsSync(finalPath)) {
                fs.unlinkSync(finalPath);
              }
              fs.renameSync(item.filePath, finalPath);
            }
          } catch {
            // Keep existing path if rename fails
          }

          finalPages.push({
            id: `drive-page-${Date.now()}-${seqIndex}-${Math.random().toString(36).substring(2, 7)}`,
            originalIndex: seqIndex,
            filename: seqName,
            extension: item.extension,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes,
            filePath: fs.existsSync(finalPath) ? finalPath : item.filePath,
          });
        }

        resolve({
          pages: finalPages,
          totalExtracted: finalPages.length,
          skippedNonImages,
        });
      });
    });
  });
}

module.exports = {
  extractArchive,
  detectImageMimeType,
  SUPPORTED_IMAGE_EXTS,
};
