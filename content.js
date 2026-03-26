// ========== PAGE SEARCH AND HIGHLIGHT LOGIC - MAIN SEARCH ISSUE LOCATION ==========

class PageSearcher {
  constructor() {
    this.matches = [];
    this.currentMatchIndex = 0;
    this.searchTerm = '';
    this.highlightClass = 'csv-reviewer-highlight';
    this.currentHighlightClass = 'csv-reviewer-current-highlight';

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async response
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'searchAndHighlight':
          const searchResults = await this.searchAndHighlight(request.searchTerm);
          sendResponse(searchResults);
          break;

        // NEW: Handle regex-based search
        case 'searchAndHighlightRegex':
          const regexResults = await this.searchAndHighlightRegex(request.pattern, request.flags, request.originalTerms);
          sendResponse(regexResults);
          break;

        case 'navigateMatch':
          const navResults = await this.navigateMatch(request.direction);
          sendResponse(navResults);
          break;

        case 'scanForDate':
          const dateResult = this.findDate();
          sendResponse(dateResult);
          break;

        case 'scanForCompanies':
          const scanResults = await this.scanForCompanies(request.companies);
          sendResponse(scanResults);
          break;

        case 'clearHighlights':
          this.clearHighlights();
          sendResponse({ success: true });
          break;

        case 'ping':
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  // ========== DATE DETECTION LOGIC ==========
  findDate() {
    try {
      console.log('📅 Scanning page for dates...');
      let foundDate = null;

      // correct date format YYYY-MM-DD
      const formatDate = (dateStr) => {
        try {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return null;
          return date.toISOString().split('T')[0];
        } catch (e) {
          return null;
        }
      };

      // 1. Check meta tags (highest confidence)
      const metaSelectors = [
        'meta[property="article:published_time"]',
        'meta[name="article:published_time"]',
        'meta[property="og:published_time"]',
        'meta[name="pubdate"]',
        'meta[name="date"]',
        'meta[name="citation_date"]',
        'meta[name="DC.date.issued"]'
      ];

      for (const selector of metaSelectors) {
        const element = document.querySelector(selector);
        if (element && element.content) {
          foundDate = formatDate(element.content);
          if (foundDate) {
            console.log(`📅 Found date in meta tag ${selector}: ${foundDate}`);
            return { date: foundDate, source: 'meta' };
          }
        }
      }

      // 2. Check time elements
      const timeElements = document.getElementsByTagName('time');
      for (const timeEl of timeElements) {
        const datetime = timeEl.getAttribute('datetime');
        if (datetime) {
          foundDate = formatDate(datetime);
          if (foundDate) {
            // Basic check to see if it's likely a publish date (e.g. not in footer, near top)
            // For now, accept the first valid time element as a good guess
            console.log(`📅 Found date in <time> element: ${foundDate}`);
            return { date: foundDate, source: 'time' };
          }
        }
      }

      // 3. Check JSON-LD data
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          // Helper to check object for date properties
          const checkObj = (obj) => {
            if (!obj) return null;
            if (obj.datePublished) return obj.datePublished;
            if (obj.dateCreated) return obj.dateCreated;
            return null;
          };

          let dateStr = checkObj(data);

          // Handle array of objects or graph
          if (!dateStr && data['@graph'] && Array.isArray(data['@graph'])) {
            const article = data['@graph'].find(item => item['@type'] === 'Article' || item['@type'] === 'NewsArticle' || item['@type'] === 'BlogPosting');
            if (article) {
              dateStr = checkObj(article);
            }
          }

          if (dateStr) {
            foundDate = formatDate(dateStr);
            if (foundDate) {
              console.log(`📅 Found date in JSON-LD: ${foundDate}`);
              return { date: foundDate, source: 'json-ld' };
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      }

      // 4. Regex search in body text (lower confidence, only look at first 2000 chars)
      const dateRegexes = [
        /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/, // 2023-01-30 or 2023/01/30
        /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/i, // 30 Jan 2023
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i // Jan 30, 2023
      ];

      const bodyText = document.body.innerText.substring(0, 3000);

      for (const regex of dateRegexes) {
        const match = bodyText.match(regex);
        if (match) {
          // Try to parse the match
          foundDate = formatDate(match[0]);
          if (foundDate) {
            console.log(`📅 Found date in text via regex: ${foundDate}`);
            return { date: foundDate, source: 'text' };
          }
        }
      }

      console.log('📅 No date found on page.');
      return { date: null, source: null };

    } catch (error) {
      console.error('Error finding date:', error);
      return { error: error.message };
    }
  }

  // ========== OLD SEARCH METHOD - KNOWN ISSUES ==========
  // This method has problems with:
  // 1. Exact string matching (misses partial matches)
  // 2. Case sensitivity issues  
  // 3. Missing variations within the same search
  // 4. Poor handling of punctuation and special characters
  async searchAndHighlight(searchTerm) {
    if (!searchTerm) {
      return { matchCount: 0, currentMatch: 0 };
    }

    console.log(`🔍 OLD SEARCH: Looking for exact term: "${searchTerm}"`);

    this.searchTerm = searchTerm.toLowerCase();
    this.clearHighlights();
    this.matches = [];

    // Wait for page to be fully loaded
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        window.addEventListener('load', resolve);
      });
    }

    // OLD: Search for exact matches in text content (PROBLEMATIC)
    this.searchInElement(document.body);

    // Highlight all matches
    this.highlightMatches();

    // Scroll to first match if any exist
    if (this.matches.length > 0) {
      this.currentMatchIndex = 0;
      this.scrollToCurrentMatch();
    }

    console.log(`🔍 OLD SEARCH RESULT: Found ${this.matches.length} matches for "${searchTerm}"`);

    return {
      matchCount: this.matches.length,
      currentMatch: this.matches.length > 0 ? 1 : 0
    };
  }

  // ========== NEW REGEX-BASED SEARCH METHOD ==========
  // This method fixes the search issues by:
  // 1. Using regex patterns for flexible matching
  // 2. Finding all variations in a single pass
  // 3. Better handling of word boundaries and punctuation
  // 4. More comprehensive search coverage
  async searchAndHighlightRegex(pattern, flags, originalTerms) {
    if (!pattern) {
      return { matchCount: 0, currentMatch: 0 };
    }

    console.log(`🔍 NEW REGEX SEARCH: Pattern: ${pattern}`);
    console.log(`🔍 NEW REGEX SEARCH: Original terms: ${originalTerms.join(', ')}`);

    this.clearHighlights();
    this.matches = [];

    // Wait for page to be fully loaded
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        window.addEventListener('load', resolve);
      });
    }

    try {
      // Create regex object
      const regex = new RegExp(pattern, flags);
      this.currentRegex = regex;

      // Search using regex pattern
      this.searchInElementRegex(document.body, regex);

      // Highlight all matches
      this.highlightMatches();

      // Scroll to first match if any exist
      if (this.matches.length > 0) {
        this.currentMatchIndex = 0;
        this.scrollToCurrentMatch();
      }

      console.log(`🔍 NEW REGEX SEARCH RESULT: Found ${this.matches.length} matches`);
      console.log(`🔍 MATCHES FOUND:`, this.matches.map(m => m.matchedText || 'unknown').slice(0, 10));

      return {
        matchCount: this.matches.length,
        currentMatch: this.matches.length > 0 ? 1 : 0
      };
    } catch (error) {
      console.error('❌ REGEX SEARCH ERROR:', error);
      throw error;
    }
  }

  // Scan the page for all known companies and return which ones were found + highlight them
  async scanForCompanies(companies) {
    // companies = [{ name: "Apple", pattern: "\\b(?:Apple|AAPL)\\b" }, ...]
    if (!companies || companies.length === 0) {
      return { foundCompanies: [], matchCount: 0, currentMatch: 0 };
    }

    console.log(`🔍 Scanning page for ${companies.length} companies...`);

    this.clearHighlights();
    this.matches = [];

    if (document.readyState !== 'complete') {
      await new Promise(resolve => window.addEventListener('load', resolve));
    }

    // Build one combined regex with named-style groups to identify which company matched
    // We use a mapping array: each alternative maps to a company name
    const companyPatterns = [];
    const patternToCompany = [];

    for (const comp of companies) {
      // Each company's pattern is a group; we track the group index
      companyPatterns.push(`(${comp.pattern.replace(/^\\b\(\?:/, '(?:').replace(/\)\\b$/, ')')})`);
      patternToCompany.push(comp.name);
    }

    // Combine all company patterns with word boundaries
    const combinedPattern = companyPatterns.map(p => `\\b${p}\\b`).join('|');
    const regex = new RegExp(combinedPattern, 'gi');

    // Walk the DOM and find matches, tracking which company each match belongs to
    const foundCompanySet = new Set();

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.parentNode && (node.parentNode.tagName === 'SCRIPT' || node.parentNode.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.textContent.trim()) {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent;
      let match;
      regex.lastIndex = 0;

      while ((match = regex.exec(text)) !== null) {
        this.matches.push({
          node: textNode,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          matchedText: match[0]
        });

        // Figure out which capturing group matched to identify the company
        for (let i = 1; i < match.length; i++) {
          if (match[i] !== undefined) {
            foundCompanySet.add(patternToCompany[i - 1]);
            break;
          }
        }

        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }

    // Highlight all matches
    this.highlightMatches();

    if (this.matches.length > 0) {
      this.currentMatchIndex = 0;
      this.scrollToCurrentMatch();
    }

    const foundCompanies = Array.from(foundCompanySet);
    console.log(`🔍 Scan complete: found ${foundCompanies.length} companies with ${this.matches.length} total mentions`);
    console.log(`🔍 Companies found:`, foundCompanies);

    return {
      foundCompanies,
      matchCount: this.matches.length,
      currentMatch: this.matches.length > 0 ? 1 : 0
    };
  }

  // ========== OPTIMIZED SEARCH LOGIC (TreeWalker) ==========
  searchInElementRegex(rootElement, regex) {
    // Use TreeWalker for non-recursive, efficient DOM traversal
    const walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip script and style tags
          if (node.parentNode && (node.parentNode.tagName === 'SCRIPT' || node.parentNode.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip empty or whitespace-only nodes
          if (!node.textContent.trim()) {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      let match;

      // Reset regex lastIndex to start fresh for each node
      regex.lastIndex = 0;

      // Find all matches in this text node
      while ((match = regex.exec(text)) !== null) {
        this.matches.push({
          node: node,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          matchedText: match[0]
        });

        // Prevent infinite loop for zero-length matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }
  }

  // Legacy method kept empty or redirected to new method if needed, 
  // but strictly we are deprecating the non-regex search for this task.
  searchInElement(element) {
    // Deprecated in favor of regex search
    console.warn('searchInElement is deprecated. Use searchInElementRegex instead.');
  }

  // ========== HIGHLIGHTING LOGIC - GENERALLY WORKS BUT CHECK IF ISSUES ==========
  highlightMatches() {
    // Process matches in reverse order to avoid offset issues
    for (let i = this.matches.length - 1; i >= 0; i--) {
      const match = this.matches[i];
      this.highlightMatch(match, i);
    }
  }

  highlightMatch(match, index) {
    const { node, startIndex, endIndex, matchedText } = match;
    const text = node.textContent;

    // Create text nodes for before, match, and after
    const beforeText = text.substring(0, startIndex);
    const matchText = text.substring(startIndex, endIndex);
    const afterText = text.substring(endIndex);

    // Create highlight span
    const highlightSpan = document.createElement('span');
    highlightSpan.className = this.highlightClass;
    highlightSpan.textContent = matchText;
    highlightSpan.dataset.matchIndex = index;

    // Add debugging info
    highlightSpan.title = `Match ${index + 1}: "${matchedText || matchText}"`;

    // Replace the original text node
    const parent = node.parentNode;

    if (beforeText) {
      parent.insertBefore(document.createTextNode(beforeText), node);
    }

    parent.insertBefore(highlightSpan, node);

    if (afterText) {
      parent.insertBefore(document.createTextNode(afterText), node);
    }

    parent.removeChild(node);

    // Update the match reference to point to the highlight span
    this.matches[index].element = highlightSpan;
  }

  // ========== NAVIGATION LOGIC - CHECK IF ISSUES WITH MATCH JUMPING ==========
  navigateMatch(direction) {
    if (this.matches.length === 0) {
      return { matchCount: 0, currentMatch: 0 };
    }

    // Remove current highlight
    const currentElement = this.matches[this.currentMatchIndex]?.element;
    if (currentElement) {
      currentElement.classList.remove(this.currentHighlightClass);
    }

    // Navigate
    if (direction === 'next') {
      this.currentMatchIndex = (this.currentMatchIndex + 1) % this.matches.length;
    } else if (direction === 'prev') {
      this.currentMatchIndex = this.currentMatchIndex > 0
        ? this.currentMatchIndex - 1
        : this.matches.length - 1;
    }

    this.scrollToCurrentMatch();

    return {
      matchCount: this.matches.length,
      currentMatch: this.currentMatchIndex + 1
    };
  }

  scrollToCurrentMatch() {
    if (this.currentMatchIndex >= 0 && this.currentMatchIndex < this.matches.length) {
      const currentElement = this.matches[this.currentMatchIndex].element;

      // Add current highlight class
      currentElement.classList.add(this.currentHighlightClass);

      // Smooth scroll to element
      currentElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  }

  // ========== CLEANUP LOGIC - CHECK IF HIGHLIGHTS AREN'T CLEARING ==========
  clearHighlights() {
    // Remove all highlight elements and restore original text
    const highlights = document.querySelectorAll(`.${this.highlightClass}`);

    highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
      parent.normalize(); // Merge adjacent text nodes
    });

    this.matches = [];
    this.currentMatchIndex = 0;
  }
}

// Initialize the page searcher
const pageSearcher = new PageSearcher();

// ========== END OF SEARCH/HIGHLIGHT LOGIC ==========