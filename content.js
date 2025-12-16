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

        case 'clearHighlights':
          this.clearHighlights();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
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