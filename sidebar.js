class CSVReviewer {
  constructor() {
    this.csvData = [];
    this.topicData = [];
    this.variationsData = [];
    this.currentIndex = 0;
    this.currentSentiment = '';
    this.preloadedTabs = new Map(); // Store preloaded tabs
    this.isProcessing = false; // Guard against race conditions
    this.selectedCompanies = []; // Companies selected for entries with no corporation
    this._skipCount = 0; // Used to skip past duplicate rows after multi-company tagging
    this.detectedCompanies = []; // Companies detected on page when no company assigned
    // Column name mapping — detected from the loaded file's headers
    this.cols = {
      company: 'corporation',
      sentiment: 'Sentiment',
      topic: 'Topic',
      subtopic: 'Sub-topic',
      date: 'Date',
      keepDelete: 'KEEP/DELETE'
    };
    this.initializeEventListeners();
    this.loadState();
    this.updateStepIndicators();
  }

  initializeEventListeners() {
    document.getElementById('loadCsv').addEventListener('click', () => this.loadCSV());
    document.getElementById('loadTopics').addEventListener('click', () => this.loadTopics());
    document.getElementById('loadVariations').addEventListener('click', () => this.loadVariations());
    document.getElementById('startProcessing').addEventListener('click', () => this.startProcessing());
    document.getElementById('keepBtn').addEventListener('click', () => this.tagEntry('KEEP'));
    document.getElementById('deleteBtn').addEventListener('click', () => this.tagEntry('DELETE'));
    document.getElementById('prevMatch').addEventListener('click', () => this.navigateMatch('prev'));
    document.getElementById('nextMatch').addEventListener('click', () => this.navigateMatch('next'));
    document.getElementById('downloadCsv').addEventListener('click', () => this.downloadCSV());
    document.getElementById('clearAllData').addEventListener('click', () => this.clearAllData());

    // Sentiment buttons
    document.getElementById('sentimentPositive').addEventListener('click', () => this.setSentiment('Positive'));
    document.getElementById('sentimentNeutral').addEventListener('click', () => this.setSentiment('Neutral'));
    document.getElementById('sentimentNegative').addEventListener('click', () => this.setSentiment('Negative'));

    // Topic dropdowns
    document.getElementById('topicSelect').addEventListener('change', () => this.updateSubtopics());
    document.getElementById('subtopicSelect').addEventListener('change', () => this.saveTopicSelection());

    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // Close button
    document.getElementById('closeBtn').addEventListener('click', () => this.cleanExit());
  }

  handleKeyboard(e) {
    // Only handle shortcuts when review section is visible
    if (document.getElementById('reviewSection').style.display === 'none') return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.navigateMatch('prev');
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.navigateMatch('next');
        break;
      case 'k':
      case 'K':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.tagEntry('KEEP');
        }
        break;
      case 'd':
      case 'D':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.tagEntry('DELETE');
        }
        break;
      case '1':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setSentiment('Positive');
        }
        break;
      case '2':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setSentiment('Neutral');
        }
        break;
      case '3':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setSentiment('Negative');
        }
        break;
      case 'p':
      case 'P':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.goToPreviousEntry();
        }
        break;
    }
  }

  async loadCSV() {
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];

    if (!file) {
      this.showStatus('csvStatus', 'Please select a data file', 'warning');
      return;
    }

    try {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

      if (isExcel) {
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const sheetNames = this.getXLSXSheetNames(arrayBuffer);

        let selectedSheet = sheetNames[0];
        if (sheetNames.length > 1) {
          selectedSheet = await this.promptSheetSelection(sheetNames);
          if (!selectedSheet) {
            this.showStatus('csvStatus', 'Sheet selection cancelled', 'warning');
            return;
          }
        }

        this.csvData = this.parseXLSX(arrayBuffer, selectedSheet);
        this.showStatus('csvStatus', `Loading sheet: "${selectedSheet}"...`, 'info');
      } else {
        const text = await this.readFileAsText(file);
        this.csvData = this.parseCSV(text);
      }

      if (this.csvData.length === 0) {
        this.showStatus('csvStatus', 'CSV file is empty or invalid', 'warning');
        return;
      }

      // Detect original column names from the file's headers
      const firstRow = this.csvData[0];
      const keys = Object.keys(firstRow);

      // Company column
      const companyCol = keys.find(k => k === 'company') || keys.find(k => k === 'corporation');
      if (!companyCol || !('link' in firstRow)) {
        this.showStatus('csvStatus', 'File must have "company" (or "corporation") and "link" columns', 'warning');
        return;
      }
      this.cols.company = companyCol;

      // Detect existing column names for sentiment, topic, subtopic, date
      this.cols.sentiment = keys.find(k => k === 'sentiment') || keys.find(k => k === 'Sentiment') || 'Sentiment';
      this.cols.topic = keys.find(k => k === 'topic') || keys.find(k => k === 'Topic') || 'Topic';
      this.cols.subtopic = keys.find(k => k === 'sub_topic') || keys.find(k => k === 'Sub-topic') || keys.find(k => k === 'Subtopic') || 'Sub-topic';
      this.cols.date = keys.find(k => k === 'date') || keys.find(k => k === 'Date') || 'Date';

      console.log('Detected column mapping:', this.cols);

      // Initialize missing columns with defaults
      this.csvData.forEach(row => {
        if (!row[this.cols.keepDelete]) row[this.cols.keepDelete] = '';
        if (row[this.cols.sentiment] === undefined) {
          row[this.cols.sentiment] = '';
        } else if (row[this.cols.sentiment]) {
          // Normalize sentiment to title case (e.g. "positive" -> "Positive")
          const s = row[this.cols.sentiment].trim();
          row[this.cols.sentiment] = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        }
        if (row[this.cols.topic] === undefined) row[this.cols.topic] = '';
        if (row[this.cols.subtopic] === undefined) row[this.cols.subtopic] = '';
        // Normalize date values
        if (row[this.cols.date] === undefined) {
          row[this.cols.date] = '';
        } else {
          const rawDate = row[this.cols.date];
          if (rawDate) {
            const d = new Date(rawDate);
            if (!isNaN(d.getTime())) {
              row[this.cols.date] = d.toISOString().split('T')[0];
            }
          }
        }
      });

      await this.saveState();
      this.showStatus('csvStatus', `✅ Loaded ${this.csvData.length} entries successfully`, 'success');
      document.getElementById('startProcessing').disabled = false;
      document.getElementById('downloadCsv').disabled = false;
      this.updateStepIndicators();

    } catch (error) {
      this.showStatus('csvStatus', `❌ Error loading CSV: ${error.message}`, 'warning');
    }
  }

  async loadTopics() {
    const fileInput = document.getElementById('topicFile');
    const file = fileInput.files[0];

    if (!file) {
      this.showStatus('topicStatus', 'Please select a topics CSV file', 'warning');
      return;
    }

    try {
      const text = await this.readFileAsText(file);
      const parsedData = this.parseCSV(text);

      if (parsedData.length === 0) {
        this.showStatus('topicStatus', 'Topics CSV file is empty or invalid', 'warning');
        return;
      }

      // Expected format: Topic, Sub columns (or Topic, Sub-topic)
      const firstRow = parsedData[0];
      if (!firstRow.Topic && !firstRow.topic) {
        this.showStatus('topicStatus', 'Topics CSV must have a "Topic" column', 'warning');
        return;
      }

      this.topicData = parsedData.map(row => ({
        topic: row.Topic || row.topic || '',
        subtopic: row.Sub || row['Sub-topic'] || row.Subtopic || row.subtopic || row.sub || row['sub-topic'] || row['sub_topic'] || ''
      }));

      console.log('Loaded topic data:', this.topicData); // Debug log

      // Build topic hierarchy
      this.buildTopicHierarchy();
      await this.saveState();

      this.showStatus('topicStatus', `✅ Loaded ${this.topicData.length} topic entries`, 'success');
      document.getElementById('topicControls').style.display = 'block';

    } catch (error) {
      this.showStatus('topicStatus', `❌ Error loading topics: ${error.message}`, 'warning');
    }
  }

  async loadVariations() {
    const fileInput = document.getElementById('variationsFile');
    const file = fileInput.files[0];

    if (!file) {
      this.showStatus('variationsStatus', 'Please select a company variations CSV file', 'warning');
      return;
    }

    try {
      const text = await this.readFileAsText(file);
      const parsedData = this.parseCSV(text);

      if (parsedData.length === 0) {
        this.showStatus('variationsStatus', 'Variations CSV file is empty or invalid', 'warning');
        return;
      }

      // Build variations mapping - first column is company name, second is variation
      this.variationsMap = {};

      parsedData.forEach(row => {
        const values = Object.values(row);
        if (values.length >= 2) {
          const company = values[0].trim();
          const variation = values[1].trim();

          if (company && variation) {
            if (!this.variationsMap[company]) {
              this.variationsMap[company] = [];
            }
            this.variationsMap[company].push(variation);
          }
        }
      });

      await this.saveState();

      const totalVariations = Object.values(this.variationsMap).reduce((sum, variations) => sum + variations.length, 0);
      this.showStatus('variationsStatus', `✅ Loaded variations for ${Object.keys(this.variationsMap).length} companies (${totalVariations} total variations)`, 'success');

    } catch (error) {
      this.showStatus('variationsStatus', `❌ Error loading variations: ${error.message}`, 'warning');
    }
  }

  // ========== SEARCH TERM GENERATION - START LOOKING HERE FOR SEARCH ISSUES ==========
  getSearchTermsForCompany(company) {
    // Start with the original company name
    const searchTerms = [company];

    // Add variations if available
    if (this.variationsMap && this.variationsMap[company]) {
      searchTerms.push(...this.variationsMap[company]);
    }

    return [...new Set(searchTerms)]; // Remove duplicates
  }

  // NEW: Generate comprehensive regex pattern for company name matching
  generateCompanyRegexPattern(company) {
    const allTerms = [];

    // Add main company name
    allTerms.push(company);

    // Add variations if available  
    if (this.variationsMap && this.variationsMap[company]) {
      allTerms.push(...this.variationsMap[company]);
    }

    // Clean and prepare terms for regex
    const cleanedTerms = allTerms.map(term => {
      // Escape special regex characters
      return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

    // Create comprehensive pattern with word boundaries
    // This finds any of the company name variations as complete words or parts of words
    const pattern = `\\b(?:${cleanedTerms.join('|')})\\b`;

    console.log(`🔍 Generated regex pattern for ${company}: ${pattern}`);
    console.log(`🔍 Searching for variations: ${allTerms.join(', ')}`);

    return {
      pattern: pattern,
      flags: 'gi', // Global, case-insensitive
      terms: allTerms
    };
  }
  // ========== SEARCH TERM GENERATION - END ==========

  buildTopicHierarchy() {
    const topics = new Set();
    this.topicHierarchy = {};

    this.topicData.forEach(item => {
      // Handle both 'Sub-topic' and 'Sub' column names
      const topic = item.topic.trim();
      const subtopic = (item.subtopic || item.Sub || '').trim();

      if (topic) {
        topics.add(topic);
        if (!this.topicHierarchy[topic]) {
          this.topicHierarchy[topic] = new Set();
        }
        if (subtopic) {
          this.topicHierarchy[topic].add(subtopic);
        }
      }
    });

    // Populate topic dropdown
    const topicSelect = document.getElementById('topicSelect');
    topicSelect.innerHTML = '<option value="">Select Topic...</option>';

    Array.from(topics).sort().forEach(topic => {
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      topicSelect.appendChild(option);
    });

    console.log('Topic hierarchy built:', this.topicHierarchy); // Debug log
  }

  getUniqueCompanies() {
    const companies = new Set();
    const col = this.cols.company;
    this.csvData.forEach(row => {
      const corp = (row[col] || '').trim();
      if (corp) companies.add(corp);
    });
    // Also include companies from the variations map so the checklist
    // and page scan work even when no rows have a company value yet
    if (this.variationsMap) {
      Object.keys(this.variationsMap).forEach(company => companies.add(company));
    }
    return Array.from(companies).sort();
  }

  buildCompanyChecklist() {
    const checklist = document.getElementById('companyChecklist');
    checklist.innerHTML = '';
    this.selectedCompanies = [];

    const companies = this.getUniqueCompanies();
    companies.forEach(company => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = company;
      checkbox.addEventListener('change', () => this.updateCompanySelection());

      const span = document.createElement('span');
      span.textContent = company;

      label.appendChild(checkbox);
      label.appendChild(span);
      checklist.appendChild(label);
    });
  }

  updateCompanySelection() {
    const checkboxes = document.querySelectorAll('#companyChecklist input[type="checkbox"]:checked');
    this.selectedCompanies = Array.from(checkboxes).map(cb => cb.value);

    const countEl = document.getElementById('companySelectedCount');
    if (this.selectedCompanies.length === 0) {
      countEl.textContent = 'No companies selected';
      countEl.style.color = '#e53e3e';
    } else {
      countEl.textContent = `${this.selectedCompanies.length} company(ies) selected: ${this.selectedCompanies.join(', ')}`;
      countEl.style.color = '#276749';
    }

    // Save first selected company for search purposes
    if (this.csvData.length > 0 && this.currentIndex < this.csvData.length) {
      this.csvData[this.currentIndex][this.cols.company] = this.selectedCompanies[0] || '';
      this.updateCurrentEntryDisplay();
    }
  }

  updateSubtopics() {
    const selectedTopic = document.getElementById('topicSelect').value;
    const subtopicSelect = document.getElementById('subtopicSelect');

    console.log('Selected topic:', selectedTopic); // Debug log
    console.log('Available topics in hierarchy:', Object.keys(this.topicHierarchy)); // Debug log

    subtopicSelect.innerHTML = '<option value="">Select Sub-topic...</option>';

    if (selectedTopic && this.topicHierarchy && this.topicHierarchy[selectedTopic]) {
      const subtopics = Array.from(this.topicHierarchy[selectedTopic]).sort();
      console.log('Subtopics for', selectedTopic, ':', subtopics); // Debug log

      subtopics.forEach(subtopic => {
        if (subtopic) { // Only add non-empty subtopics
          const option = document.createElement('option');
          option.value = subtopic;
          option.textContent = subtopic;
          subtopicSelect.appendChild(option);
        }
      });
    }

    this.saveTopicSelection();
  }

  saveDateSelection() {
    if (this.csvData.length > 0 && this.currentIndex < this.csvData.length) {
      const date = document.getElementById('dateInput').value;

      this.csvData[this.currentIndex][this.cols.date] = date;
      this.saveState();

      // Immediately update the display
      this.updateCurrentEntryDisplay();

      console.log(`📅 Date saved: ${date} for entry ${this.currentIndex + 1}`);
    }
  }

  clearDate() {
    if (this.csvData.length > 0 && this.currentIndex < this.csvData.length) {
      document.getElementById('dateInput').value = '';
      this.csvData[this.currentIndex][this.cols.date] = '';
      this.saveState();

      // Immediately update the display
      this.updateCurrentEntryDisplay();

      console.log(`📅 Date cleared for entry ${this.currentIndex + 1}`);
    }
  }

  saveTopicSelection() {
    if (this.csvData.length > 0 && this.currentIndex < this.csvData.length) {
      const topic = document.getElementById('topicSelect').value;
      const subtopic = document.getElementById('subtopicSelect').value;

      this.csvData[this.currentIndex][this.cols.topic] = topic;
      this.csvData[this.currentIndex][this.cols.subtopic] = subtopic;
      this.saveState();

      // Immediately update the display
      this.updateCurrentEntryDisplay();
    }
  }

  setSentiment(sentiment) {
    this.currentSentiment = sentiment;

    // Update visual feedback immediately
    document.querySelectorAll('.sentiment-btn').forEach(btn => {
      btn.classList.remove('selected');
    });

    document.getElementById('sentiment' + sentiment).classList.add('selected');

    // Save to current entry and update display immediately
    if (this.csvData.length > 0 && this.currentIndex < this.csvData.length) {
      this.csvData[this.currentIndex][this.cols.sentiment] = sentiment;
      this.saveState();

      // Immediately update the display
      this.updateCurrentEntryDisplay();
    }
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  parseXLSX(arrayBuffer, selectedSheetName) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = selectedSheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // Convert to array of objects (header row becomes keys)
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return data;
  }

  getXLSXSheetNames(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    return workbook.SheetNames;
  }

  promptSheetSelection(sheetNames) {
    return new Promise((resolve) => {
      const container = document.getElementById('sheetSelectorContainer');
      const select = document.getElementById('sheetSelect');
      const confirmBtn = document.getElementById('sheetConfirmBtn');
      const cancelBtn = document.getElementById('sheetCancelBtn');

      // Populate options
      select.innerHTML = '';
      sheetNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });

      container.style.display = 'block';

      const cleanup = () => {
        container.style.display = 'none';
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
      };

      const onConfirm = () => {
        cleanup();
        resolve(select.value);
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length >= headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        data.push(row);
      }
    }

    return data;
  }

  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim().replace(/"/g, ''));
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim().replace(/"/g, ''));
    return result;
  }

  async startProcessing() {
    if (this.csvData.length === 0) {
      this.showStatus('processingStatus', 'No CSV data loaded', 'warning');
      return;
    }

    // Find first entry that isn't fully filled
    let startIndex = this.csvData.findIndex(row => !this.isEntryFullyFilled(row));
    if (startIndex === -1) {
      this.showStatus('processingStatus', '🎉 All entries are already complete!', 'success');
      return;
    }

    this.currentIndex = startIndex;
    this.updateStepIndicators();
    await this.processCurrentEntry();
  }

  isEntryFullyFilled(entry) {
    return !!(
      entry[this.cols.keepDelete] &&
      entry[this.cols.sentiment] &&
      entry[this.cols.topic] &&
      entry[this.cols.subtopic] &&
      entry[this.cols.date] &&
      (entry[this.cols.company] || '').trim()
    );
  }

  async processCurrentEntry() {
    // Skip over records that already have all fields filled
    while (this.currentIndex < this.csvData.length && this.isEntryFullyFilled(this.csvData[this.currentIndex])) {
      console.log(`Skipping fully filled entry at index ${this.currentIndex}`);
      this.currentIndex++;
    }

    if (this.currentIndex >= this.csvData.length) {
      this.showStatus('processingStatus', '🎉 All entries processed!', 'success');
      this.updateStepIndicators();
      return;
    }

    const entry = this.csvData[this.currentIndex];
    const link = entry.link;
    const corporation = entry[this.cols.company];

    if (!link) {
      this.showStatus('processingStatus', '⚠️ Invalid entry - missing link', 'warning');
      return;
    }

    // If no corporation, still navigate to the page but skip searching
    const hasCorporation = !!(corporation && corporation.trim());

    try {
      // Check if we have a preloaded tab for this URL
      const preloadedTab = this.preloadedTabs.get(link);
      let tab;

      if (preloadedTab) {
        // Use the preloaded tab and activate it
        tab = preloadedTab;
        await chrome.tabs.update(tab.id, { active: true });
        this.preloadedTabs.delete(link); // Remove from preload cache

        this.showStatus('processingStatus', `⚡ Using preloaded page: ${this.truncateUrl(link)}`, 'info');
        this.updateLoadingIndicator('loading', hasCorporation ? 'Searching...' : 'Scanning for companies...');

        // Small delay then search immediately (reduced delay for preloaded pages)
        setTimeout(async () => {
          try {
            await this.ensureContentScript(tab.id);
            if (hasCorporation) {
              const searchTerms = this.getSearchTermsForCompany(corporation);
              await this.searchAndHighlightMultiple(tab.id, searchTerms);
            } else {
              await this.scanAndPreselectCompanies(tab.id);
              this.autoDetectDate(tab.id);
            }
            this.showReviewSection();

            // Start preloading next pages
            this.preloadNextPages();
          } catch (error) {
            console.error('Error in searchAndHighlight:', error);
            this.showStatus('processingStatus', `❌ Error searching page: ${error.message}`, 'warning');
            this.updateLoadingIndicator('ready', 'Error - Try again');
            this.showReviewSection(); // Still show review so UI isn't stuck
          }
        }, 300); // Reduced from 500ms

      } else {
        // No preloaded tab, load normally
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = activeTab;

        // Navigate to the link
        await chrome.tabs.update(tab.id, { url: link });

        // Wait for page to load, then inject content script
        const loadHandler = async (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(loadHandler);

            this.updateLoadingIndicator('loading', hasCorporation ? 'Searching...' : 'Scanning for companies...');

            // Small delay to ensure page is fully loaded
            setTimeout(async () => {
              try {
                await this.ensureContentScript(tab.id);
                if (hasCorporation) {
                  const searchTerms = this.getSearchTermsForCompany(corporation);
                  await this.searchAndHighlightMultiple(tab.id, searchTerms);
                } else {
                  await this.scanAndPreselectCompanies(tab.id);
                  this.autoDetectDate(tab.id);
                }
                this.showReviewSection();

                // Start preloading next pages
                this.preloadNextPages();
              } catch (error) {
                console.error('Error in searchAndHighlight:', error);
                this.showStatus('processingStatus', '❌ Error searching page', 'warning');
                this.updateLoadingIndicator('ready', 'Error - Try again');
              }
            }, 1000); // Reduced from 1500ms
          }
        };

        chrome.tabs.onUpdated.addListener(loadHandler);
        this.showStatus('processingStatus', `🔄 Loading: ${this.truncateUrl(link)}`, 'info');
        this.updateLoadingIndicator('loading', 'Loading page...');
      }

      this.updateProgressInfo();

      this.updateProgressInfo();

    } catch (error) {
      this.showStatus('processingStatus', `❌ Error: ${error.message}`, 'warning');
      // On error, we must unlock the UI so component doesn't get stuck
      this.isProcessing = false;
      this.setProcessingState(false);
    }
  }

  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  }

  async ensureContentScript(tabId) {
    try {
      // Ping the content script to see if it's loaded
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (e) {
      // Content script not loaded — inject it
      console.log('Content script not found, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css']
      });
    }
  }

  // Build scan data for all known companies (used when no company is assigned)
  buildAllCompanyScanData() {
    const companies = this.getUniqueCompanies();
    return companies.map(company => {
      const regexInfo = this.generateCompanyRegexPattern(company);
      return { name: company, pattern: regexInfo.pattern };
    });
  }

  // Scan page for all companies, highlight matches, and store found companies for pre-selection
  async scanAndPreselectCompanies(tabId) {
    this.detectedCompanies = []; // Reset

    const scanData = this.buildAllCompanyScanData();
    if (scanData.length === 0) {
      this.updateMatchInfo(0, 0, '(no companies to scan for)');
      return;
    }

    this.updateLoadingIndicator('loading', 'Scanning for companies...');

    try {
      const results = await chrome.tabs.sendMessage(tabId, {
        action: 'scanForCompanies',
        companies: scanData
      });

      if (results && results.foundCompanies && results.foundCompanies.length > 0) {
        this.detectedCompanies = results.foundCompanies;

        this.updateMatchInfo(
          results.matchCount,
          results.currentMatch,
          results.foundCompanies.join(' | ')
        );
      } else {
        this.updateMatchInfo(0, 0, '(no company mentions found)');
      }
    } catch (error) {
      console.error('Error scanning for companies:', error);
      this.updateMatchInfo(0, 0, '(scan failed)');
    }
  }

  // ========== SEARCH EXECUTION LOGIC - MAIN SEARCH ISSUE AREA ==========
  async searchAndHighlightMultiple(tabId, searchTerms) {
    try {
      let totalMatches = 0;
      let bestResult = null;

      // OLD METHOD: Try each search term individually (PROBLEMATIC)
      // This often misses matches and doesn't find the best terms

      // NEW METHOD: Use regex pattern for comprehensive matching
      const company = this.csvData[this.currentIndex][this.cols.company];
      const regexInfo = this.generateCompanyRegexPattern(company);

      console.log(`🔍 OLD METHOD: Would search for individual terms: ${searchTerms.join(', ')}`);
      console.log(`🔍 NEW METHOD: Using regex pattern: ${regexInfo.pattern}`);

      try {
        const results = await chrome.tabs.sendMessage(tabId, {
          action: 'searchAndHighlightRegex',
          pattern: regexInfo.pattern,
          flags: regexInfo.flags,
          originalTerms: regexInfo.terms
        });

        if (results) {
          this.updateMatchInfo(results.matchCount, results.currentMatch, regexInfo.terms.join(' | '));

          // NEW: Automatically check for date
          this.autoDetectDate(tabId);

          return;
        }
      } catch (error) {
        console.log(`❌ NEW REGEX METHOD FAILED: ${error.message}`);
        console.log(`⚠️ FALLING BACK TO OLD METHOD...`);
      }

      // FALLBACK: Old method if regex fails
      for (const term of searchTerms) {
        try {
          const results = await chrome.tabs.sendMessage(tabId, {
            action: 'searchAndHighlight',
            searchTerm: term
          });

          if (results && results.matchCount > totalMatches) {
            totalMatches = results.matchCount;
            bestResult = results;
            bestResult.searchTerm = term;
          }
        } catch (error) {
          console.log(`Search failed for term: ${term}`, error);
        }
      }

      if (bestResult) {
        this.updateMatchInfo(bestResult.matchCount, bestResult.currentMatch, bestResult.searchTerm);
      } else {
        this.updateMatchInfo(0, 0, searchTerms[0]);
      }
    } catch (error) {
      console.error('Error in searchAndHighlightMultiple:', error);
      this.showStatus('processingStatus', '❌ Error searching page', 'warning');
    }
  }
  // ========== SEARCH EXECUTION LOGIC - END ==========

  updateMatchInfo(matchCount, currentMatch, searchTerm = '') {
    const termInfo = searchTerm ? ` (searching for: ${searchTerm})` : '';
    const info = matchCount > 0
      ? `🔍 Found ${matchCount} matches (showing match ${currentMatch})${termInfo}`
      : `⚠️ No matches found on this page${termInfo}`;
    document.getElementById('matchInfo').textContent = info;

    // Update loading indicator based on search results
    this.updateLoadingIndicator('ready', matchCount > 0 ? `Ready (${matchCount} matches)` : 'Ready (no matches)');
  }

  isDateRecent(dateStr) {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return false;
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      return date >= twoYearsAgo;
    } catch (e) {
      return false;
    }
  }

  async autoDetectDate(tabId) {
    const existingDate = this.csvData[this.currentIndex][this.cols.date];

    // If the existing date is within the past two years, keep it and skip detection
    if (existingDate && this.isDateRecent(existingDate)) {
      console.log(`📅 Existing date ${existingDate} is recent, keeping it`);
      return;
    }

    try {
      console.log('📅 Requesting date scan...');
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'scanForDate'
      });

      let finalDate = '';

      if (result && result.date && this.isDateRecent(result.date)) {
        // Page has a recent date — use it
        finalDate = result.date;
        console.log(`📅 Using page-detected date: ${finalDate} (source: ${result.source})`);
      } else if (existingDate) {
        // Existing date is too old and page date is also old or missing — clear it
        console.log(`📅 Existing date ${existingDate} is too old and no recent date found on page — clearing`);
      }

      // Update the date field (may be setting or clearing)
      document.getElementById('dateInput').value = finalDate;
      this.csvData[this.currentIndex][this.cols.date] = finalDate;
      this.saveState();

      if (finalDate) {
        const dateInput = document.getElementById('dateInput');
        dateInput.style.backgroundColor = '#e8f0fe';
        setTimeout(() => {
          dateInput.style.backgroundColor = 'white';
        }, 2000);
      }

      this.updateCurrentEntryDisplay();
    } catch (error) {
      console.log('Error auto-detecting date:', error);
    }
  }

  updateProgressInfo() {
    const processed = this.csvData.filter(row => this.isEntryFullyFilled(row)).length;
    const total = this.csvData.length;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

    document.getElementById('progressInfo').innerHTML = `
      📊 Progress: ${processed}/${total} entries processed (${percentage}%)<br>
      🔍 Current: Entry ${this.currentIndex + 1} of ${total}
    `;

    // Update Previous Entry button state
    this.updatePreviousEntryButton();
  }

  updatePreviousEntryButton() {
    const prevBtn = document.getElementById('prevEntryBtn');
    if (prevBtn) {
      // Enable/disable based on whether we can go back
      if (this.currentIndex > 0) {
        prevBtn.disabled = false;
        prevBtn.textContent = `← Previous Entry (${this.currentIndex})`;
      } else {
        prevBtn.disabled = true;
        prevBtn.textContent = '← Previous Entry';
      }
    }
  }

  async goToPreviousEntry() {
    console.log(`🔙 goToPreviousEntry called. Current index: ${this.currentIndex}`);

    if (this.isProcessing) return;
    if (this.currentIndex <= 0) {
      console.log(`⚠️ Cannot go back - already at first entry`);
      this.showStatus('processingStatus', '⚠️ Already at first entry', 'warning');
      return;
    }

    try {
      this.isProcessing = true;
      this.setProcessingState(true);

      console.log(`🔙 Going from entry ${this.currentIndex + 1} to entry ${this.currentIndex}`);

      // Clean up any preloaded tabs
      this.cleanupUnusedPreloadedTabs();

      // Get current tab to close it after loading previous entry
      let currentTab = null;
      try {
        [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log(`🔙 Current tab ID: ${currentTab ? currentTab.id : 'none'}`);
      } catch (e) {
        console.log('Error getting current tab:', e);
      }

      // Move to previous entry
      this.currentIndex--;
      console.log(`🔙 New index: ${this.currentIndex}`);

      this.showStatus('processingStatus', `⏪ Going back to entry ${this.currentIndex + 1}`, 'info');

      // Process the previous entry (this will load the page and show review section)
      console.log(`🔙 Processing entry: ${this.csvData[this.currentIndex]?.[this.cols.company]} - ${this.csvData[this.currentIndex]?.link}`);

      // processCurrentEntry will eventually call showReviewSection which unlocks UI
      await this.processCurrentEntry();

      // Close the tab we came from after a short delay
      if (currentTab) {
        setTimeout(async () => {
          try {
            await chrome.tabs.remove(currentTab.id);
            console.log(`🔙 Closed previous tab ${currentTab.id} when going back to entry ${this.currentIndex + 1}`);
          } catch (error) {
            console.log('🔙 Previous tab may have already been closed:', error);
          }
        }, 1000);
      }

    } catch (error) {
      console.error('❌ Error going to previous entry:', error);
      this.showStatus('processingStatus', `❌ Error: ${error.message}`, 'warning');
      this.isProcessing = false;
      this.setProcessingState(false);
    }
  }

  updateStepIndicators() {
    // Reset all steps
    document.querySelectorAll('.step-number').forEach(step => {
      step.classList.remove('completed', 'active');
    });

    // Step 1: CSV loaded
    if (this.csvData.length > 0) {
      document.getElementById('step1').classList.add('completed');
    }

    // Step 2: Processing started
    if (this.csvData.length > 0) {
      document.getElementById('step2').classList.add('completed');
    }

    // Step 3: Currently reviewing
    if (document.getElementById('reviewSection').style.display !== 'none') {
      document.getElementById('step3').classList.add('active');
    }

    // Step 4: Available for download
    if (this.csvData.length > 0) {
      document.getElementById('step4').classList.add('completed');
    }
  }

  async navigateMatch(direction) {
    if (this.isProcessing) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
      const results = await chrome.tabs.sendMessage(tab.id, {
        action: 'navigateMatch',
        direction: direction
      });

      if (results) {
        this.updateMatchInfo(results.matchCount, results.currentMatch);
      }
    } catch (error) {
      console.error('Error navigating matches:', error);
    }
  }

  updateCurrentEntryDisplay() {
    const entry = this.csvData[this.currentIndex];
    const status = entry[this.cols.keepDelete];
    const sentiment = entry[this.cols.sentiment];
    const topic = entry[this.cols.topic];
    const subtopic = entry[this.cols.subtopic];
    const date = entry[this.cols.date];

    const statusBadge = status === 'KEEP' ? '✅ KEEP' : status === 'DELETE' ? '❌ DELETE' : '⏳ Not reviewed';
    const sentimentBadge = sentiment ? `😊 ${sentiment}` : '😐 No sentiment';
    const topicBadge = topic ? `📂 ${topic}${subtopic ? ` > ${subtopic}` : ''}` : '📂 No topic';
    const dateBadge = date ? `📅 ${date}` : '📅 No date';

    const corpDisplay = (entry[this.cols.company] || '').trim()
      ? entry[this.cols.company]
      : (this.selectedCompanies.length > 0
        ? `<span style="color: var(--primary-teal-dark); font-style: italic;">${this.selectedCompanies.join(', ')}</span>`
        : '<span style="color: #e53e3e; font-style: italic;">⚠ No company — select below</span>');

    document.getElementById('currentEntry').innerHTML = `
      <strong>Corporation:</strong> ${corpDisplay}<br>
      <strong>Link:</strong> <a href="${entry.link}" target="_blank">${this.truncateUrl(entry.link, 60)}</a><br>
      <strong>Status:</strong> <span style="font-weight: bold; color: ${this.getStatusColor(status)}">${statusBadge}</span><br>
      <strong>Sentiment:</strong> <span style="font-weight: bold; color: ${this.getSentimentColor(sentiment)}">${sentimentBadge}</span><br>
      <strong>Category:</strong> <span style="font-weight: bold; color: #6c757d">${topicBadge}</span><br>
      <strong>Date:</strong> <span style="font-weight: bold; color: #6c757d">${dateBadge}</span>
    `;
  }

  updateLoadingIndicator(state, text = '') {
    const dot = document.getElementById('loadingDot');
    const textEl = document.getElementById('loadingText');

    if (!dot || !textEl) return;

    // Remove all state classes
    dot.classList.remove('loading', 'ready');

    // Add appropriate state
    dot.classList.add(state);

    // Update text
    switch (state) {
      case 'loading':
        textEl.textContent = text || 'Loading...';
        textEl.style.color = '#dc3545';
        break;
      case 'ready':
        textEl.textContent = text || 'Ready';
        textEl.style.color = '#28a745';
        break;
    }
  }

  showReviewSection() {
    const entry = this.csvData[this.currentIndex];
    const sentiment = entry[this.cols.sentiment];
    const topic = entry[this.cols.topic];
    const subtopic = entry[this.cols.subtopic];
    const date = entry[this.cols.date];

    // Show company selector if company is empty
    const companyControls = document.getElementById('companyControls');
    if (!(entry[this.cols.company] || '').trim()) {
      this.buildCompanyChecklist();

      // Pre-check companies that were detected on the page
      if (this.detectedCompanies && this.detectedCompanies.length > 0) {
        const checkboxes = document.querySelectorAll('#companyChecklist input[type="checkbox"]');
        checkboxes.forEach(cb => {
          if (this.detectedCompanies.includes(cb.value)) {
            cb.checked = true;
          }
        });
        this.updateCompanySelection();
        this.detectedCompanies = []; // Clear after applying
      }

      companyControls.style.display = 'block';
    } else {
      companyControls.style.display = 'none';
      this.selectedCompanies = [];
    }

    // Update the display
    this.updateCurrentEntryDisplay();

    // Update sentiment buttons (case-insensitive match)
    document.querySelectorAll('.sentiment-btn').forEach(btn => btn.classList.remove('selected'));
    if (sentiment) {
      const normalized = sentiment.charAt(0).toUpperCase() + sentiment.slice(1).toLowerCase();
      document.getElementById('sentiment' + normalized)?.classList.add('selected');
    }

    // Update topic dropdowns (case-insensitive match against options)
    const topicSelect = document.getElementById('topicSelect');
    if (topic) {
      const matchedTopic = Array.from(topicSelect.options).find(
        opt => opt.value.toLowerCase() === topic.toLowerCase()
      );
      if (matchedTopic) {
        topicSelect.value = matchedTopic.value;
      } else {
        topicSelect.value = topic; // Fallback to exact value
      }
      this.updateSubtopics();
      setTimeout(() => {
        if (subtopic) {
          const subtopicSelect = document.getElementById('subtopicSelect');
          const matchedSub = Array.from(subtopicSelect.options).find(
            opt => opt.value.toLowerCase() === subtopic.toLowerCase()
          );
          if (matchedSub) {
            subtopicSelect.value = matchedSub.value;
          } else {
            subtopicSelect.value = subtopic; // Fallback to exact value
          }
        }
      }, 100); // Small delay to ensure subtopics are populated
    } else {
      topicSelect.value = '';
      document.getElementById('subtopicSelect').innerHTML = '<option value="">Select Sub-topic...</option>';
    }

    // Update date input
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
      dateInput.value = date || '';
    }

    document.getElementById('reviewSection').style.display = 'block';
    this.updateStepIndicators();
    this.updatePreviousEntryButton();

    // Unlock UI after processing is complete
    this.isProcessing = false;
    this.setProcessingState(false);
  }

  setProcessingState(isProcessing) {
    const idsToToggle = [
      'keepBtn', 'deleteBtn', 'prevEntryBtn',
      'prevMatch', 'nextMatch', 'startProcessing',
      'sentimentPositive', 'sentimentNeutral', 'sentimentNegative'
    ];

    idsToToggle.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isProcessing;
    });

    // Also toggle pointers events for div-based buttons like sentiment
    const sentimentBtns = document.querySelectorAll('.sentiment-btn');
    sentimentBtns.forEach(btn => {
      btn.style.pointerEvents = isProcessing ? 'none' : 'auto';
      btn.style.opacity = isProcessing ? '0.7' : '1';
    });
  }

  getStatusColor(status) {
    switch (status) {
      case 'KEEP': return '#28a745';
      case 'DELETE': return '#dc3545';
      default: return '#6c757d';
    }
  }

  getSentimentColor(sentiment) {
    switch (sentiment) {
      case 'Positive': return '#28a745';
      case 'Negative': return '#dc3545';
      case 'Neutral': return '#ffc107';
      default: return '#6c757d';
    }
  }

  async preloadNextPages() {
    const maxPreload = 2; // Preload next 2 pages
    const maxConcurrentPreloads = 6; // Cap total preloaded tabs to avoid memory issues
    if (this.preloadedTabs.size >= maxConcurrentPreloads) return;
    const currentWindow = await chrome.windows.getCurrent();

    for (let i = 1; i <= maxPreload; i++) {
      const nextIndex = this.currentIndex + i;

      if (nextIndex >= this.csvData.length) break; // No more entries to preload

      const nextEntry = this.csvData[nextIndex];
      const nextLink = nextEntry.link;

      if (!nextLink || this.preloadedTabs.has(nextLink)) continue; // Skip if no link or already preloaded

      try {
        // Create a simple background tab (faster than windows)
        const preloadTab = await chrome.tabs.create({
          url: nextLink,
          active: false, // Create in background
          windowId: currentWindow.id
        });

        // Store the preloaded tab
        this.preloadedTabs.set(nextLink, preloadTab);

        console.log(`Preloaded page ${i}: ${this.truncateUrl(nextLink)}`);

        // Clean up old preloaded tabs after a delay (in case they're not used)
        setTimeout(() => {
          if (this.preloadedTabs.has(nextLink)) {
            chrome.tabs.remove(preloadTab.id).catch(() => { }); // Ignore errors
            this.preloadedTabs.delete(nextLink);
            console.log(`Auto-cleaned unused preload: ${this.truncateUrl(nextLink)}`);
          }
        }, 180000); // 3 minute cleanup timeout (reduced from 5)

      } catch (error) {
        console.error(`Failed to preload page ${i}:`, error);
      }
    }
  }

  async tagEntry(tag) {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      this.setProcessingState(true);

      // Handle multi-company duplication
      if (this.selectedCompanies.length > 1) {
        const baseEntry = this.csvData[this.currentIndex];
        baseEntry[this.cols.keepDelete] = tag;
        baseEntry[this.cols.company] = this.selectedCompanies[0];

        // Insert duplicate rows for additional companies right after current
        const duplicates = [];
        for (let i = 1; i < this.selectedCompanies.length; i++) {
          const dup = { ...baseEntry, [this.cols.company]: this.selectedCompanies[i] };
          duplicates.push(dup);
        }
        this.csvData.splice(this.currentIndex + 1, 0, ...duplicates);
        // Skip past the duplicates when advancing (they're already tagged)
        this._skipCount = duplicates.length;
        this.selectedCompanies = [];

        console.log(`📋 Created ${duplicates.length} duplicate row(s) for additional companies`);
      } else if (this.selectedCompanies.length === 1) {
        // Single company selected for a no-company entry
        this.csvData[this.currentIndex][this.cols.company] = this.selectedCompanies[0];
        this.csvData[this.currentIndex][this.cols.keepDelete] = tag;
        this.selectedCompanies = [];
      } else {
        this.csvData[this.currentIndex][this.cols.keepDelete] = tag;
      }

      await this.saveState();

      const emoji = tag === 'KEEP' ? '✅' : '❌';
      const dupCount = this._skipCount || 0;
      if (dupCount > 0) {
        this.showStatus('processingStatus', `${emoji} Tagged as ${tag} — created ${dupCount} duplicate row(s) for additional companies`, 'success');
      } else {
        this.showStatus('processingStatus', `${emoji} Tagged as ${tag}`, 'success');
      }

      // Get the current tab before moving to next entry
      // Use catch to handle potential errors if tab is already gone
      let currentTab = null;
      try {
        [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch (e) {
        console.log('Could not get current tab to close:', e);
      }

      // Clean up any unused preloaded tabs
      this.cleanupUnusedPreloadedTabs();

      // Move to next entry (skip past any duplicates we just inserted)
      const skip = this._skipCount || 0;
      this._skipCount = 0;
      this.currentIndex += 1 + skip;

      if (this.currentIndex < this.csvData.length) {
        // Close the current tab after a brief delay (let user see the tag feedback)
        setTimeout(async () => {
          if (currentTab) {
            try {
              await chrome.tabs.remove(currentTab.id);
              console.log(`Closed tab after tagging: ${this.truncateUrl(this.csvData[this.currentIndex - 1].link)}`);
            } catch (error) {
              console.log('Tab may have already been closed:', error);
            }
          }

          // Process next entry
          // This will eventually call showReviewSection which unlocks the UI
          this.processCurrentEntry();
        }, 800);
      } else {
        this.showStatus('processingStatus', '🎉 All entries completed!', 'success');
        document.getElementById('reviewSection').style.display = 'none';
        this.updateStepIndicators();

        // Unlock since we are done
        this.isProcessing = false;
        this.setProcessingState(false);

        // Close the final tab and clean up all remaining preloaded tabs
        setTimeout(async () => {
          if (currentTab) {
            try {
              await chrome.tabs.remove(currentTab.id);
            } catch (error) {
              console.log('Final tab may have already been closed:', error);
            }
          }
          this.cleanupAllPreloadedTabs();
        }, 1000);
      }
    } catch (error) {
      console.error('Error in tagEntry:', error);
      this.showStatus('processingStatus', `❌ Error: ${error.message}`, 'warning');
      this.isProcessing = false;
      this.setProcessingState(false);
    }
  }

  cleanupUnusedPreloadedTabs() {
    // Remove preloaded tabs that we've passed (won't be used)
    for (const [link, tab] of this.preloadedTabs.entries()) {
      // If this preloaded tab is for a URL we've already processed, clean it up
      const linkIndex = this.csvData.findIndex(entry => entry.link === link);
      if (linkIndex !== -1 && linkIndex < this.currentIndex) {
        chrome.tabs.remove(tab.id).catch(() => { }); // Remove tab
        this.preloadedTabs.delete(link);
        console.log(`Cleaned up unused preloaded tab: ${this.truncateUrl(link)}`);
      }
    }
  }

  cleanupAllPreloadedTabs() {
    // Clean up all remaining preloaded tabs
    for (const [link, tab] of this.preloadedTabs.entries()) {
      chrome.tabs.remove(tab.id).catch(() => { }); // Remove tab
      console.log(`Cleaned up preloaded tab: ${this.truncateUrl(link)}`);
    }
    this.preloadedTabs.clear();
  }

  downloadCSV() {
    if (this.csvData.length === 0) {
      this.showStatus('processingStatus', 'No data to download', 'warning');
      return;
    }

    const headers = Object.keys(this.csvData[0]);
    const csvContent = [
      headers.join(','),
      ...this.csvData.map(row =>
        headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `processed_entries_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showStatus('processingStatus', '📄 CSV downloaded successfully!', 'success');
  }

  async clearAllData() {
    // Show confirmation dialog
    const confirmed = confirm(`🗑️ Clear All Data & Start Fresh?

This will permanently delete:
• All loaded CSV data and progress
• All topic/subtopic configurations  
• All company variation mappings
• Current review progress

Are you sure you want to continue?`);

    if (!confirmed) return;

    try {
      // Clean up any preloaded tabs first
      this.cleanupAllPreloadedTabs();

      // Clear all stored data
      await chrome.storage.local.clear();

      // Reset all instance variables
      this.csvData = [];
      this.topicData = [];
      this.variationsData = [];
      this.topicHierarchy = {};
      this.variationsMap = {};
      this.currentIndex = 0;
      this.currentSentiment = '';
      this.preloadedTabs.clear();

      // Reset UI elements
      this.resetUI();

      // Show success message
      this.showStatus('processingStatus', '✅ All data cleared successfully! You can now start fresh.', 'success');

      console.log('All extension data cleared successfully');

    } catch (error) {
      console.error('Error clearing data:', error);
      this.showStatus('processingStatus', `❌ Error clearing data: ${error.message}`, 'warning');
    }
  }

  async cleanExit() {
    console.log('🛑 Clean exit requested');

    // Stop processing flag
    this.isProcessing = false;

    // Save state
    await this.saveState();

    // Clean up any preloaded tabs
    this.cleanupAllPreloadedTabs();

    // Close the sidebar window
    window.close();
  }

  resetUI() {
    // Clear file inputs
    document.getElementById('csvFile').value = '';
    document.getElementById('topicFile').value = '';
    document.getElementById('variationsFile').value = '';

    // Clear all status messages
    document.getElementById('csvStatus').textContent = '';
    document.getElementById('csvStatus').className = '';
    document.getElementById('topicStatus').textContent = '';
    document.getElementById('topicStatus').className = '';
    document.getElementById('variationsStatus').textContent = '';
    document.getElementById('variationsStatus').className = '';
    document.getElementById('progressInfo').textContent = '';

    // Reset buttons
    document.getElementById('startProcessing').disabled = true;
    document.getElementById('downloadCsv').disabled = true;

    // Hide sections
    document.getElementById('reviewSection').style.display = 'none';
    document.getElementById('topicControls').style.display = 'none';
    document.getElementById('companyControls').style.display = 'none';
    document.getElementById('companyChecklist').innerHTML = '';
    this.selectedCompanies = [];

    // Clear sentiment selection
    document.querySelectorAll('.sentiment-btn').forEach(btn => {
      btn.classList.remove('selected');
    });

    // Reset topic dropdowns
    document.getElementById('topicSelect').innerHTML = '<option value="">Select Topic...</option>';
    document.getElementById('subtopicSelect').innerHTML = '<option value="">Select Sub-topic...</option>';

    // Clear current entry display
    document.getElementById('currentEntry').innerHTML = '';
    document.getElementById('matchInfo').textContent = '';

    // Reset date input
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
      dateInput.value = '';
    }

    // Reset loading indicator
    this.updateLoadingIndicator('loading', 'Ready to start');

    // Update Previous Entry button
    this.updatePreviousEntryButton();

    // Reset step indicators
    this.updateStepIndicators();
  }

  async saveState() {
    try {
      await chrome.storage.local.set({
        csvData: this.csvData,
        topicData: this.topicData,
        topicHierarchy: this.topicHierarchy,
        variationsMap: this.variationsMap,
        currentIndex: this.currentIndex,
        cols: this.cols
      });
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  async loadState() {
    try {
      const result = await chrome.storage.local.get([
        'csvData', 'topicData', 'topicHierarchy', 'variationsMap', 'currentIndex', 'cols'
      ]);

      if (result.cols) {
        this.cols = result.cols;
      }

      if (result.csvData) {
        this.csvData = result.csvData;
        this.currentIndex = result.currentIndex || 0;

        if (this.csvData.length > 0) {
          document.getElementById('startProcessing').disabled = false;
          document.getElementById('downloadCsv').disabled = false;
          this.showStatus('csvStatus', `🔄 Restored ${this.csvData.length} entries from previous session`, 'info');
          this.updateProgressInfo();
        }
      }

      if (result.topicData && result.topicHierarchy) {
        this.topicData = result.topicData;
        this.topicHierarchy = result.topicHierarchy;
        this.buildTopicHierarchy();
        document.getElementById('topicControls').style.display = 'block';
        this.showStatus('topicStatus', `🔄 Restored ${this.topicData.length} topic entries`, 'info');
      }

      if (result.variationsMap) {
        this.variationsMap = result.variationsMap;
        const totalVariations = Object.values(this.variationsMap).reduce((sum, variations) => sum + variations.length, 0);
        this.showStatus('variationsStatus', `🔄 Restored variations for ${Object.keys(this.variationsMap).length} companies (${totalVariations} total)`, 'info');
      }
    } catch (error) {
      console.error('Error loading state:', error);
    }
  }

  showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.className = `status ${type}`;

    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
      setTimeout(() => {
        if (element.className.includes('success')) {
          element.textContent = '';
          element.className = '';
        }
      }, 3000);
    }
  }
}

// Initialize when sidebar opens
document.addEventListener('DOMContentLoaded', () => {
  new CSVReviewer();
});

// Handle sidebar opening/closing
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sidebarOpened') {
    // Refresh data when sidebar is opened
    const reviewer = new CSVReviewer();
    sendResponse({ success: true });
  }
});