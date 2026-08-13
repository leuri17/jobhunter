export {
  SUPPORTED_SOURCE_TYPES,
  SourceTypeSchema,
  detectSourceTypeFromPath,
  mimeTypeFor,
  type SourceType,
} from './source-types.js';

export {
  SourceUnreadableError,
  UnsupportedSourceFormatError,
  ExtractionFailedError,
  OcrRequiredError,
  InvalidArgumentCountError,
  ProfileSourceStorageError,
  ProfileImportError,
} from './errors.js';

export { hashFileContents, hashString, type ByteStream } from './hashing.js';
export {
  normalizeExtractedText,
  hashExtractedText,
  calculateExtractedTextStats,
  type ExtractedTextStats,
} from './text-normalize.js';

export {
  resolveExtractor,
  isSuccessfulExtraction,
  type ExtractionResult,
  type Extractor,
} from './extractors/index.js';

export {
  ProfileImportService,
  noopLogger,
  type ImportedSource,
  type ProfileImportResult,
  type ProfileImportCounts,
  type ProfileImportStatus,
  type ProfileImportLogger,
  type ProfileImportServiceOptions,
} from './importer.js';

export { createDefaultBinaryFileSystem, type BinaryFileSystem } from './file-system.js';

export {
  copySourceFileToStorage,
  defaultFilenameFor,
  resolveSourceStoragePath,
} from './file-copy.js';
