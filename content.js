// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageContent') {
    try {
      // Get the page content
      const content = document.documentElement.outerHTML;
      
      // Clean up the content (remove scripts, etc.)
      const cleanContent = cleanPageContent(content);
      
      sendResponse({ content: cleanContent });
    } catch (error) {
      console.error('Error getting page content:', error);
      sendResponse({ error: 'Failed to get page content' });
    }
  }
  
  return true; // Keep message channel open for async response
});

function cleanPageContent(content) {
  // Create a temporary DOM element to parse and clean the content
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content;
  
  // Remove scripts
  const scripts = tempDiv.querySelectorAll('script');
  scripts.forEach(script => script.remove());
  
  // Remove event handlers from elements
  const allElements = tempDiv.querySelectorAll('*');
  allElements.forEach(element => {
    // Remove common event attributes
    const eventAttributes = ['onclick', 'onload', 'onmouseover', 'onmouseout', 'onchange', 'onsubmit'];
    eventAttributes.forEach(attr => {
      element.removeAttribute(attr);
    });
  });
  
  // Add a note that this is cached content
  const body = tempDiv.querySelector('body');
  if (body) {
    const cacheNote = document.createElement('div');
    cacheNote.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background-color: #4285f4;
      color: white;
      padding: 8px;
      text-align: center;
      font-size: 14px;
      z-index: 10000;
    `;
    cacheNote.textContent = '📱 Cached Content - Viewing Offline';
    body.insertBefore(cacheNote, body.firstChild);
  }
  
  return tempDiv.innerHTML;
}
