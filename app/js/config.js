export const DB_NAME = 'junk-drawer';
export const DB_VERSION = 1;
export const PAGE_DB_PREFIX = 'junk-drawer:page:';  // + pageId + ':' + the page's own name
export const CACHE_PREFIX = 'junk-drawer-shell-';   // + build
export const PAGE_PATH = 'p/';                      // <scope>p/<pageId>/
export const BUILD_PATH = '__jd/build';             // sw answers {"build":"…"}
export const HOST_GLOBAL = '__junkDrawerHost';
export const LOCAL_QUOTA_CHARS = 5_000_000;         // per page, keys + values
export const EVENTS = {
  libraryChanged: 'jd:library-changed',  // pages or settings changed; library re-reads
  openPage: 'jd:open-page',              // detail: { id }
  addPage: 'jd:add-page',                // the "add new page" button
  replaceFile: 'jd:replace-file',        // detail: { id }
  viewerClosed: 'jd:viewer-closed',
  exportLibrary: 'jd:export-library',    // the library's "export library" button
  importLibrary: 'jd:import-library',    // the library's "import library" button
  exportPage: 'jd:export-page',          // detail: { id }; the viewer's "export" button
};
export const SETTINGS = {
  sort: 'library.sort',
  deleteBroken: 'deleteOriginal.broken',  // true once deleting has failed for a reason other than the owner saying no
  deleteLast: 'deleteOriginal.last',      // last position of the "delete the downloaded file" switch
  fsaBroken: 'picker.fsaBroken',          // true: use the plain file input (set when showOpenFilePicker fails outright, or by the owner in the footer)
  pickerLastError: 'picker.lastError',    // text of the last picker error, for diagnostics
};
