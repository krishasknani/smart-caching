document.addEventListener('DOMContentLoaded', function() {
  const cacheButton = document.getElementById('cacheButton');
  const cachedPagesList = document.getElementById('cachedPagesList');
  
  // Get current tab info and load cached pages
  loadCurrentTab();
  loadCachedPages();
  
  // Cache button click handler
  cacheButton.addEventListener('click', function() {
    cacheCurrentPage();
  });
  
  async function loadCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        // Check if page is already cached
        const cachedPages = await getCachedPages();
        const isCached = cachedPages.some(page => page.url === tab.url);
        
        cacheButton.disabled = isCached;
        cacheButton.textContent = isCached ? 'Already Cached' : 'Cache This Page';
      }
    } catch (error) {
      console.error('Error loading current tab:', error);
    }
  }
  
  async function cacheCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url) {
        alert('Unable to get current page information');
        return;
      }
      
      // Send message to content script to get page content
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
      
      if (response && response.content) {
        const pageData = {
          url: tab.url,
          title: tab.title || 'Untitled',
          content: response.content,
          timestamp: Date.now(),
          favicon: tab.favIconUrl || ''
        };
        
        // Save to storage
        await saveCachedPage(pageData);
        
        // Update UI
        cacheButton.disabled = true;
        cacheButton.textContent = 'Already Cached';
        loadCachedPages();
        
        alert('Page cached successfully!');
      } else {
        alert('Unable to cache page content');
      }
    } catch (error) {
      console.error('Error caching page:', error);
      alert('Error caching page. Please try again.');
    }
  }
  
  async function getCachedPages() {
    try {
      const result = await chrome.storage.local.get(['cachedPages']);
      return result.cachedPages || [];
    } catch (error) {
      console.error('Error getting cached pages:', error);
      return [];
    }
  }
  
  async function saveCachedPage(pageData) {
    try {
      const cachedPages = await getCachedPages();
      cachedPages.push(pageData);
      await chrome.storage.local.set({ cachedPages });
    } catch (error) {
      console.error('Error saving cached page:', error);
    }
  }
  
  async function loadCachedPages() {
    try {
      const cachedPages = await getCachedPages();
      
      if (cachedPages.length === 0) {
        cachedPagesList.innerHTML = '<div class="empty-state">No pages cached yet</div>';
        return;
      }
      
      cachedPagesList.innerHTML = cachedPages.map(page => `
        <div class="cached-page">
          <div class="page-info">
            <div class="page-title">${escapeHtml(page.title)}</div>
            <div class="page-url">${escapeHtml(page.url)}</div>
          </div>
          <button class="view-button" onclick="viewCachedPage('${page.url}')">View</button>
          <button class="delete-button" onclick="deleteCachedPage('${page.url}')">Delete</button>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error loading cached pages:', error);
    }
  }
  
  // Global functions for button clicks
  window.viewCachedPage = async function(url) {
    try {
      const cachedPages = await getCachedPages();
      const page = cachedPages.find(p => p.url === url);
      
      if (page) {
        // Open cached page in new tab
        const newTab = await chrome.tabs.create({
          url: `data:text/html;charset=utf-8,${encodeURIComponent(page.content)}`,
          active: true
        });
      }
    } catch (error) {
      console.error('Error viewing cached page:', error);
    }
  };
  
  window.deleteCachedPage = async function(url) {
    try {
      const cachedPages = await getCachedPages();
      const filteredPages = cachedPages.filter(p => p.url !== url);
      await chrome.storage.local.set({ cachedPages: filteredPages });
      loadCachedPages();
    } catch (error) {
      console.error('Error deleting cached page:', error);
    }
  };
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
