export type {
  ReviewComment,
  ReviewCommentsFile,
  CommentSeverity,
} from './lib/types.js';
export {
  commentDirPath,
  commentFilePath,
  readComments,
  appendComment,
  updateComment,
  removeComment,
} from './lib/comment-store.js';
export {
  postReviewComments,
  renderCommentBody,
  type PostContext,
} from './lib/comment-poster.js';
export {
  AGENT_ATTRIBUTION,
  AGENT_FOOTER,
  CONVENTIONAL_DECORATIONS,
  CONVENTIONAL_LABELS,
  N10_URL,
  commentBodyParts,
  conventionalForSeverity,
  conventionalSeverity,
  formatConventionalComment,
  moreSevere,
  resolveComment,
  parseConventionalComment,
  splitAgentFooter,
  withAgentFooter,
  type CommentBodyParts,
  type ConventionalComment,
  type ConventionalLabel,
  type ResolvedComment,
} from './lib/conventional.js';
export type {
  AnnotatedLine,
  CommentPositionInfo,
} from './lib/comment-renderer.js';
export {
  interleaveComments,
  getCommentPositions,
} from './lib/comment-renderer.js';
export type {
  InsertionMap,
  RemoteInsertionMap,
} from './lib/comment-placement.js';
export {
  computeInsertionMap,
  computeRemoteInsertionMap,
} from './lib/comment-placement.js';
export type {
  RowMap,
  RowMapEntry,
  BuildRowMapInputs,
} from './lib/comment-rows.js';
export {
  segmentCommentBody,
  collectImageUrls,
  imageToken,
} from './lib/comment-images.js';
export type {
  BodyBlock,
  CommentImageLayout,
  CommentImageLayouts,
} from './lib/comment-images.js';
export {
  buildRowMap,
  estimateBodyRows,
  estimateCardRows,
  estimateLocalCardRows,
  REPLY_INPUT_ROWS,
  estimateReplyInputRows,
  EDIT_INPUT_SLACK_ROWS,
} from './lib/comment-rows.js';
export { handleUtilCommand } from './lib/util-command.js';
