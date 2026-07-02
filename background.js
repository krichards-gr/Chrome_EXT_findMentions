// Background script for CSV Link Reviewer extension

chrome.runtime.onStartup.addListener(() => {
  console.log('CSV Link Reviewer extension started');
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('CSV Link Reviewer extension installed');
  } else if (details.reason === 'update') {
    console.log('CSV Link Reviewer extension updated');
  }
});

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('Error opening sidebar:', error);
  }
});

// Enable the side panel on every tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await chrome.sidePanel.setOptions({ tabId: activeInfo.tabId, enabled: true });
  } catch (error) {
    // Side panel not available on all tab types (e.g. chrome://)
  }
});

// Error handling for port disconnects
chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      console.error('Port disconnected:', chrome.runtime.lastError);
    }
  });
});
