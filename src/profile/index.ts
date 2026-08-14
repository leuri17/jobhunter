// Existing TASK-007 surface (CV import flow).

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

// TASK-008 surface (OpenAI profile extraction).

export {
  PROFILE_SCHEMA_VERSION,
  ProfessionalProfileSchema,
  YearMonthSchema,
  SkillCategorySchema,
  SkillProficiencySchema,
  LanguageLevelSchema,
  SeniorityLevelSchema,
  SkillEvidenceSourceTypeSchema,
  SourceReferenceSchema,
  WorkExperienceSchema,
  SkillEvidenceSchema,
  SkillSchema,
  LanguageSchema,
  EducationSchema,
  CertificationSchema,
  ProjectSchema,
  ProfileBasicsSchema,
  ProfileDerivedSchema,
  DerivedValueSchema,
  SKILL_CATEGORIES,
  SKILL_PROFICIENCIES,
  LANGUAGE_LEVELS,
  SENIORITY_LEVELS,
  SKILL_EVIDENCE_SOURCE_TYPES,
  type ProfessionalProfile,
  type ProfileBasics,
  type ProfileDerived,
  type SkillCategory,
  type SkillProficiency,
  type LanguageLevel,
  type SeniorityLevel,
  type SkillEvidenceSourceType,
  type SourceReference,
  type WorkExperience,
  type SkillEvidence,
  type Skill,
  type Language,
  type Education,
  type Certification,
  type Project,
} from './schema.js';

export { normalizeSkillName, normalizeLanguageName } from './name-normalize.js';
export { parseYearMonth, isValidYearMonth, calculateDurationMonths } from './dates.js';
export { detectProfileConflicts, type DetectedConflict } from './conflicts.js';
export { calculateProfileContentHash } from './content-hash.js';
export {
  postProcessExtractionResponse,
  type PostProcessInputs,
  type PostProcessResult,
} from './post-process.js';
export {
  ProfileExtractionService,
  noopProfileExtractionLogger,
  type ProfileExtractionLogger,
  type ProfileExtractionSourceInput,
  type ProfileExtractionConfig,
  type ProfileExtractionStatus,
  type ProfileExtractionServiceOptions,
} from './extraction-service.js';

// Re-export the entire OpenAI surface so consumers can pull the full
// extraction API from `src/profile/index.js` without reaching into the
// `openai/` submodule.
export * from './openai/index.js';

// TASK-009 surface (review / approval / rejection lifecycle).

// Typed lifecycle errors (TASK-009 Task 10).
export {
  ProfileLifecycleError,
  InvalidProfileIdentifierError,
  InvalidProfilePayloadError,
  InvalidProfileStateError,
  BlockingConflictsUnresolvedError,
  UserCancelledApprovalError,
  UserCancelledRejectionError,
} from './errors.js';

// Profile CLI identifier resolution (TASK-009 Task 1).
export { resolveProfileVersionId } from './identifier-resolution.js';

// Pure review helpers (TASK-009 Task 2).
export * from './review/index.js';

// Application services (TASK-009 Tasks 6, 7, 8, 9).
export {
  ProfileReviewService,
  type ProfileListEntry,
  type ProfileShowPayload,
} from './review-service.js';
export {
  ProfileApprovalService,
  type ProfileApprovalPrompts,
  type ProfileApprovalServiceOptions,
  type ProfileApprovalSummary,
} from './approval-service.js';
export {
  ProfileRejectionService,
  type ProfileRejectionPrompts,
  type ProfileRejectionServiceOptions,
  type ProfileRejectionResult,
} from './rejection-service.js';
export {
  ProfileEditingService,
  type EditOutcome,
  type DerivedDraftResult,
  type ProfileEditingServiceOptions,
} from './editing-service.js';

// Editor surface (TASK-009 Tasks 4 + 5).
export * from './editing/index.js';
