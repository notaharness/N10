// `n10 util …`. main.ts imports this module on demand; Nx forbids
// lazy-loading a library the TUI imports statically, and a local module
// gives the same chunk without Ink, React or Electron.
export { handleUtilCommand as runUtil } from '@n10/review-comments';
