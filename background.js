// Chromium focuses the address bar whenever a tab opens on the new tab page,
// and navigating that same tab afterwards leaves the address bar focused.
// Workaround: open a fresh tab straight at this extension's page (the browser
// doesn't focus the address bar for those), then close the original empty tab.

const NEWTAB_PATTERN = /^(chrome|brave):\/\/newtab\/?/i;
const OWN_PAGE = chrome.runtime.getURL("newtab.html");

function isNewTab(tab) {
  return NEWTAB_PATTERN.test(tab.pendingUrl || "") || NEWTAB_PATTERN.test(tab.url || "");
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!isNewTab(tab)) return;
  try {
    await chrome.tabs.create({
      url: OWN_PAGE,
      windowId: tab.windowId,
      index: tab.index,
      active: true
    });
    await chrome.tabs.remove(tab.id);
  } catch (err) {
    // If anything goes wrong, fall back to loading the page in the original tab
    chrome.tabs.update(tab.id, { url: OWN_PAGE }).catch(() => {});
  }
});
