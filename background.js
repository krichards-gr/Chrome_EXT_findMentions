// Background script for CSV Link Reviewer extension

// Keep service worker alive
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

// Handle extension icon clicks to open sidebar
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Open the side panel
    await chrome.sidePanel.open({ windowId: tab.windowId });
    
    // Notify sidebar that it was opened
    chrome.runtime.sendMessage({ action: 'sidebarOpened' });
  } catch (error) {
    console.error('Error opening sidebar:', error);
  }
});

// Handle tab updates for the extension
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Inject content script when page is complete if needed
  if (changeInfo.status === 'complete' && tab.url) {
    // The content script is already automatically injected via manifest
    // This is just for additional handling if needed
  }
});

// Enable side panel on all tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await chrome.sidePanel.setOptions({
      tabId: activeInfo.tabId,
      enabled: true
    });
  } catch (error) {
    // Side panel might not be available on all tabs
    console.log('Side panel not available on this tab');
  }
});

// Message passing between components
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle any background-specific messages if needed
  if (request.action === 'backgroundTask') {
    // Perform background tasks
    sendResponse({ success: true });
  }
  
  if (request.action === 'sidebarOpened') {
    // Handle sidebar opening logic
    sendResponse({ success: true });
  }
  
  return true; // Keep message channel open
});

// Handle extension lifecycle
chrome.runtime.onSuspend.addListener(() => {
  console.log('CSV Link Reviewer extension suspending');
});

// Error handling
chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      console.error('Port disconnected:', chrome.runtime.lastError);
    }
  });
});// Background script for CSV Link Reviewer extension

// Keep service worker alive
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

// Handle tab updates for the extension
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Inject content script when page is complete if needed
  if (changeInfo.status === 'complete' && tab.url) {
    // The content script is already automatically injected via manifest
    // This is just for additional handling if needed
  }
});

// Handle extension icon clicks
chrome.action.onClicked.addListener((tab) => {
  // This won't trigger since we have a popup, but keeping for reference
  console.log('Extension icon clicked');
});

// Message passing between components
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle any background-specific messages if needed
  if (request.action === 'backgroundTask') {
    // Perform background tasks
    sendResponse({ success: true });
  }
  
  return true; // Keep message channel open
});

// Handle extension lifecycle
chrome.runtime.onSuspend.addListener(() => {
  console.log('CSV Link Reviewer extension suspending');
});

// Error handling
chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      console.error('Port disconnected:', chrome.runtime.lastError);
    }
  });
});