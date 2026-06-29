class CSVReviewer {
  constructor() {
    this.csvData = [];
    this.topicData = [];
    this.variationsData = [];
    this.currentIndex = 0;
    this.currentSentiment = '';
    this.preloadedTabs = new Map();
    this.isProcessing = false;
    this.selectedCompanies = [];
    this._skipCount = 0;
    this.detectedCompanies = [];
    this.cols = {
      company: 'corporation',
      sentiment: 'Sentiment',
      topic: 'Topic',
      subtopic: 'Sub-topic',
      date: 'Date',
      keepDelete: 'KEEP/DELETE'
    };
    // BigQuery state
    this.bqMode = false;
    this.bqConfig = { projectId: 'sri-benchmarking-databases', datasetId: 'coverage_collector', clientId: '434903546449-umed7pni0pcl0lfoevgbouedqq12hrmc.apps.googleusercontent.com' };
    this.bqToken = null;
    this.bqTokenExpiry = null;

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
    document.getElementById('clearDebugLog').addEventListener('click', () => {
      document.getElementById('debugLog').textContent = '';
    });

    // Sentiment buttons
    document.getElementById('sentimentPositive').addEventListener('click', () => this.setSentiment('Positive'));
    document.getElementById('sentimentNeutral').addEventListener('click', () => this.setSentiment('Neutral'));
    document.getElementById('sentimentNegative').addEventListener('click', () => this.setSentiment('Negative'));

    // Topic dropdowns
    document.getElementById('topicSelect').addEventListener('change', () => {
      // User-initiated topic change — clear any previous sub-topic text so a stale
      // edited value from the previous topic doesn't carry over.
      document.getElementById('subtopicEdit').value = '';
      this.updateSubtopics();
    });
    document.getElementById('subtopicSelect').addEventListener('change', () => this.onSubtopicDropdownChange());
    document.getElementById('subtopicEdit').addEventListener('input', () => this.saveTopicSelection());

    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // Prev/Next entry buttons
    document.getElementById('prevEntryBtn').addEventListener('click', () => this.goToPreviousEntry());
    document.getElementById('nextEntryBtn').addEventListener('click', () => this.goToNextEntry());

    // Mode toggle
    document.getElementById('csvModeBtn').addEventListener('click', () => this.setMode('csv'));
    document.getElementById('bqModeBtn').addEventListener('click', () => this.setMode('bq'));

    // BigQuery buttons
    document.getElementById('bqSaveConfig').addEventListener('click', () => this.bqSaveConfig());
    document.getElementById('bqConnect').addEventListener('click', () => this.bqConnect());
    document.getElementById('bqLoad').addEventListener('click', () => this.bqLoadData());

    // Show extension ID for redirect URI setup
    document.getElementById('bqRedirectUri').textContent =
      `https://${chrome.runtime.id}.chromiumapp.org/`;

    // Scrape article button
    document.getElementById('scrapeArticleBtn').addEventListener('click', () => this.scrapeArticle());

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
      case ',':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.goToPreviousEntry();
        }
        break;
      case '.':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.goToNextEntry();
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
      this.cols.content = keys.find(k => /^(content|full[_ ]?text|article[_ ]?text|body[_ ]?text|text)$/i.test(k)) || null;

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
        if (this.cols.content && row[this.cols.content] === undefined) row[this.cols.content] = '';
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

  // Replace archetype tokens in a sub-topic with user-friendly bracketed placeholders
  // so the editable part is obvious. E.g. "TREATMENT_PRODUCT Development" -> "[Treatment/Product] Development"
  humanizeSubtopic(raw) {
    if (!raw) return '';
    return raw
      .replace(/TREATMENT_PRODUCT/g, '[Treatment/Product]')
      .replace(/LAWSUIT_FOCUS/g, '[Lawsuit Focus]');
  }

  onSubtopicDropdownChange() {
    const selected = document.getElementById('subtopicSelect').value;
    const editField = document.getElementById('subtopicEdit');
    // Populate the edit field with the selected subtopic, converting placeholder tokens
    // into bracketed text the user can easily find and replace.
    editField.value = this.humanizeSubtopic(selected);
    this.saveTopicSelection();
  }

  saveTopicSelection() {
    if (this.csvData.length > 0 && this.currentIndex < this.csvData.length) {
      const topic = document.getElementById('topicSelect').value;
      // The edit field is the source of truth — it starts populated from the dropdown
      // but the user can customize placeholders (e.g. [Treatment/Product] -> Stelara).
      const subtopic = document.getElementById('subtopicEdit').value;

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
    // RFC 4180 compliant parser — handles quoted fields containing commas,
    // newlines, and escaped quotes. Required for article_text multi-line content.
    const rows = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
      const row = [];

      while (i < n) {
        if (text[i] === '"') {
          // Quoted field
          let field = '';
          i++; // skip opening quote
          while (i < n) {
            if (text[i] === '"') {
              if (text[i + 1] === '"') {
                field += '"';
                i += 2; // escaped quote
              } else {
                i++; // skip closing quote
                break;
              }
            } else {
              field += text[i++];
            }
          }
          row.push(field);
        } else {
          // Unquoted field — read until comma or end-of-line
          let field = '';
          while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
            field += text[i++];
          }
          row.push(field.trim());
        }

        if (i < n && text[i] === ',') {
          i++; // consume comma, continue to next field
        } else {
          break; // end of row
        }
      }

      // Consume row terminator
      if (i < n && text[i] === '\r') i++;
      if (i < n && text[i] === '\n') i++;

      if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
        rows.push(row);
      }
    }

    if (rows.length < 2) return [];

    const headers = rows[0];
    const data = [];

    for (let r = 1; r < rows.length; r++) {
      const values = rows[r];
      if (values.length > 0) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] !== undefined ? values[index] : '';
        });
        data.push(row);
      }
    }

    return data;
  }

  async startProcessing() {
    if (this.csvData.length === 0) {
      this.showStatus('processingStatus', 'No CSV data loaded', 'warning');
      return;
    }

    // Resume = jump to the first record without a KEEP/DELETE label.
    // A record with a KEEP/DELETE tag counts as "decided" even if other
    // fields (sentiment, topic, date) were left blank.
    let startIndex = -1;
    for (let i = this.currentIndex; i < this.csvData.length; i++) {
      if (!this.hasKeepDeleteLabel(this.csvData[i])) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === -1) {
      // Nothing undecided from currentIndex onward — check earlier gaps
      startIndex = this.csvData.findIndex(row => !this.hasKeepDeleteLabel(row));
    }

    if (startIndex === -1) {
      this.showStatus('processingStatus', '🎉 All entries are already labeled KEEP/DELETE!', 'success');
      return;
    }

    this.currentIndex = startIndex;
    this.updateStepIndicators();
    await this.processCurrentEntry();
  }

  hasKeepDeleteLabel(entry) {
    const tag = entry[this.cols.keepDelete];
    return !!(tag && String(tag).trim());
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
    // Skip over records that already have a KEEP/DELETE decision
    while (this.currentIndex < this.csvData.length && this.hasKeepDeleteLabel(this.csvData[this.currentIndex])) {
      console.log(`Skipping already-decided entry at index ${this.currentIndex}`);
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
        // Use the preloaded tab and activate it (it may have been closed by the user)
        tab = preloadedTab;
        try {
          await chrome.tabs.update(tab.id, { active: true });
        } catch (e) {
          console.log('Preloaded tab was closed, opening new tab:', e.message);
          tab = await chrome.tabs.create({ url: link });
        }
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
        // No preloaded tab — navigate the active tab or create one if none exists
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
          tab = activeTab;
          await chrome.tabs.update(tab.id, { url: link });
        } else {
          tab = await chrome.tabs.create({ url: link });
        }

        // Wait for page to load, then inject content script
        let loadHandlerFired = false;
        const loadHandler = async (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            loadHandlerFired = true;
            clearTimeout(loadTimeoutId);
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
                this.showStatus('processingStatus', '❌ Error searching page — review manually', 'warning');
                this.updateLoadingIndicator('ready', 'Error - Try again');
                this.showReviewSection(); // must unlock isProcessing
              }
            }, 1000); // Reduced from 1500ms
          }
        };

        // 30-second safety net — if the page never fires 'complete', unblock the UI
        const loadTimeoutId = setTimeout(() => {
          if (!loadHandlerFired) {
            chrome.tabs.onUpdated.removeListener(loadHandler);
            this.showStatus('processingStatus', '⚠️ Page load timed out — you can review manually or skip', 'warning');
            this.updateLoadingIndicator('ready', 'Timed out');
            this.showReviewSection(); // unlock UI
          }
        }, 30000);

        chrome.tabs.onUpdated.addListener(loadHandler);
        this.showStatus('processingStatus', `🔄 Loading: ${this.truncateUrl(link)}`, 'info');
        this.updateLoadingIndicator('loading', 'Loading page...');
      }

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
        // Keep the existing date (e.g. from the collector pipeline) — never discard data
        finalDate = existingDate;
        console.log(`📅 Keeping existing date ${existingDate} — no better date found on page`);
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

  async scrapeArticle() {
    try {
      document.getElementById('scrapeArticleBtn').disabled = true;
      document.getElementById('scrapeStatus').innerHTML =
        '<span style="color: #718096; font-size: 12px;">Extracting article text...</span>';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await this.ensureContentScript(tab.id);

      const result = await chrome.tabs.sendMessage(tab.id, {
        action: 'extractArticleText'
      });

      if (result && result.text && result.text.trim()) {
        this.csvData[this.currentIndex][this.cols.content] = result.text.trim();
        await this.saveState();

        document.getElementById('scrapeControls').style.display = 'none';
        this.showStatus('processingStatus', `📰 Extracted ${result.text.trim().length.toLocaleString()} chars of article text`, 'success');
      } else {
        document.getElementById('scrapeStatus').innerHTML =
          '<span style="color: #e53e3e; font-size: 12px;">Could not extract article text from this page</span>';
        document.getElementById('scrapeArticleBtn').disabled = false;
      }
    } catch (error) {
      console.error('Error scraping article:', error);
      document.getElementById('scrapeStatus').innerHTML =
        `<span style="color: #e53e3e; font-size: 12px;">Error: ${error.message}</span>`;
      document.getElementById('scrapeArticleBtn').disabled = false;
    }
  }

  updateProgressInfo() {
    const processed = this.csvData.filter(row => this.hasKeepDeleteLabel(row)).length;
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
      if (this.currentIndex > 0) {
        prevBtn.disabled = false;
        prevBtn.innerHTML = `← Previous Entry (${this.currentIndex}) <kbd>Ctrl+,</kbd>`;
      } else {
        prevBtn.disabled = true;
        prevBtn.innerHTML = `← Previous Entry <kbd>Ctrl+,</kbd>`;
      }
    }

    const nextBtn = document.getElementById('nextEntryBtn');
    if (nextBtn) {
      if (this.currentIndex < this.csvData.length - 1) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = `Next Entry (${this.currentIndex + 2}) → <kbd>Ctrl+.</kbd>`;
      } else {
        nextBtn.disabled = true;
        nextBtn.innerHTML = `Next Entry → <kbd>Ctrl+.</kbd>`;
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

      // Move to previous entry
      this.currentIndex--;
      console.log(`🔙 New index: ${this.currentIndex}`);

      this.showStatus('processingStatus', `⏪ Going back to entry ${this.currentIndex + 1}`, 'info');

      // Process the previous entry (no skip — user explicitly wants to revisit)
      console.log(`🔙 Processing entry: ${this.csvData[this.currentIndex]?.[this.cols.company]} - ${this.csvData[this.currentIndex]?.link}`);

      // processCurrentEntryNoSkip will load the page and show review section without skipping filled entries
      await this.processCurrentEntryNoSkip();
      // Tab is reused (navigated in place) — nothing to close.

    } catch (error) {
      console.error('❌ Error going to previous entry:', error);
      this.showStatus('processingStatus', `❌ Error: ${error.message}`, 'warning');
      this.isProcessing = false;
      this.setProcessingState(false);
    }
  }

  async goToNextEntry() {
    console.log(`🔜 goToNextEntry called. Current index: ${this.currentIndex}`);

    if (this.isProcessing) return;
    if (this.currentIndex >= this.csvData.length - 1) {
      console.log(`⚠️ Cannot go forward - already at last entry`);
      this.showStatus('processingStatus', '⚠️ Already at last entry', 'warning');
      return;
    }

    try {
      this.isProcessing = true;
      this.setProcessingState(true);

      console.log(`🔜 Going from entry ${this.currentIndex + 1} to entry ${this.currentIndex + 2}`);

      // Clean up any preloaded tabs
      this.cleanupUnusedPreloadedTabs();

      // Move to next entry (no skipping — user explicitly wants to navigate)
      this.currentIndex++;

      this.showStatus('processingStatus', `⏩ Going to entry ${this.currentIndex + 1}`, 'info');

      // Process the next entry (this will load the page and show review section)
      await this.processCurrentEntryNoSkip();
      // Tab is reused (navigated in place) — nothing to close.

    } catch (error) {
      console.error('❌ Error going to next entry:', error);
      this.showStatus('processingStatus', `❌ Error: ${error.message}`, 'warning');
      this.isProcessing = false;
      this.setProcessingState(false);
    }
  }

  // Like processCurrentEntry but does NOT skip fully-filled entries
  async processCurrentEntryNoSkip() {
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
      this.isProcessing = false;
      this.setProcessingState(false);
      return;
    }

    const hasCorporation = !!(corporation && corporation.trim());

    try {
      const preloadedTab = this.preloadedTabs.get(link);
      let tab;

      if (preloadedTab) {
        tab = preloadedTab;
        await chrome.tabs.update(tab.id, { active: true });
        this.preloadedTabs.delete(link);

        this.showStatus('processingStatus', `⚡ Using preloaded page: ${this.truncateUrl(link)}`, 'info');
        this.updateLoadingIndicator('loading', hasCorporation ? 'Searching...' : 'Scanning for companies...');

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
            this.preloadNextPages();
          } catch (error) {
            console.error('Error in searchAndHighlight:', error);
            this.showStatus('processingStatus', `❌ Error searching page: ${error.message}`, 'warning');
            this.updateLoadingIndicator('ready', 'Error - Try again');
            this.showReviewSection();
          }
        }, 300);

      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = activeTab;

        await chrome.tabs.update(tab.id, { url: link });

        let loadHandlerFiredNoSkip = false;
        const loadHandler = async (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            loadHandlerFiredNoSkip = true;
            clearTimeout(loadTimeoutIdNoSkip);
            chrome.tabs.onUpdated.removeListener(loadHandler);

            this.updateLoadingIndicator('loading', hasCorporation ? 'Searching...' : 'Scanning for companies...');

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
                this.preloadNextPages();
              } catch (error) {
                console.error('Error in searchAndHighlight:', error);
                this.showStatus('processingStatus', '❌ Error searching page — review manually', 'warning');
                this.updateLoadingIndicator('ready', 'Error - Try again');
                this.showReviewSection(); // must unlock isProcessing
              }
            }, 1000);
          }
        };

        const loadTimeoutIdNoSkip = setTimeout(() => {
          if (!loadHandlerFiredNoSkip) {
            chrome.tabs.onUpdated.removeListener(loadHandler);
            this.showStatus('processingStatus', '⚠️ Page load timed out — you can review manually or skip', 'warning');
            this.updateLoadingIndicator('ready', 'Timed out');
            this.showReviewSection(); // unlock UI
          }
        }, 30000);

        chrome.tabs.onUpdated.addListener(loadHandler);
        this.showStatus('processingStatus', `🔄 Loading: ${this.truncateUrl(link)}`, 'info');
        this.updateLoadingIndicator('loading', 'Loading page...');
      }

      this.updateProgressInfo();

    } catch (error) {
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

    // Show scrape button only when content column exists and is empty
    const scrapeControls = document.getElementById('scrapeControls');
    if (this.cols.content) {
      const hasContent = (entry[this.cols.content] || '').trim();
      scrapeControls.style.display = hasContent ? 'none' : 'block';
      document.getElementById('scrapeStatus').innerHTML = '';
      document.getElementById('scrapeArticleBtn').disabled = false;
    } else {
      scrapeControls.style.display = 'none';
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
      // Pre-populate the edit field with the saved sub-topic before updateSubtopics()
      // fires saveTopicSelection(); otherwise the previous entry's edit value would
      // briefly be written into the current row.
      document.getElementById('subtopicEdit').value = subtopic || '';
      this.updateSubtopics();
      setTimeout(() => {
        const subtopicSelect = document.getElementById('subtopicSelect');
        const subtopicEdit = document.getElementById('subtopicEdit');
        if (subtopic) {
          // Try to match the stored (possibly already-edited) value to an archetype option.
          // If it doesn't match, leave the dropdown at the placeholder — the edit field still shows the saved text.
          const matchedSub = Array.from(subtopicSelect.options).find(
            opt => opt.value.toLowerCase() === subtopic.toLowerCase() ||
                   this.humanizeSubtopic(opt.value).toLowerCase() === subtopic.toLowerCase()
          );
          if (matchedSub) {
            subtopicSelect.value = matchedSub.value;
          } else {
            subtopicSelect.value = '';
          }
          subtopicEdit.value = subtopic;
        } else {
          subtopicSelect.value = '';
          subtopicEdit.value = '';
        }
      }, 100); // Small delay to ensure subtopics are populated
    } else {
      topicSelect.value = '';
      document.getElementById('subtopicSelect').innerHTML = '<option value="">Select Sub-topic...</option>';
      document.getElementById('subtopicEdit').value = '';
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
      'keepBtn', 'deleteBtn', 'prevEntryBtn', 'nextEntryBtn',
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

      // Capture the latest UI values so duplicates always reflect current inputs
      const currentSentiment = document.getElementById('sentimentPositive').classList.contains('selected') ? 'Positive'
        : document.getElementById('sentimentNeutral').classList.contains('selected') ? 'Neutral'
        : document.getElementById('sentimentNegative').classList.contains('selected') ? 'Negative' : '';
      const currentTopic = document.getElementById('topicSelect').value;
      // Sub-topic comes from the editable text field, which may contain a customized value
      // (e.g. [Treatment/Product] replaced with the actual product name).
      const currentSubtopic = document.getElementById('subtopicEdit').value;
      const currentDate = document.getElementById('dateInput').value;

      // Write latest UI values into the base entry before duplicating
      const baseEntry = this.csvData[this.currentIndex];
      if (currentSentiment) baseEntry[this.cols.sentiment] = currentSentiment;
      if (currentTopic) baseEntry[this.cols.topic] = currentTopic;
      if (currentSubtopic) baseEntry[this.cols.subtopic] = currentSubtopic;
      if (currentDate) baseEntry[this.cols.date] = currentDate;

      // Handle multi-company duplication
      if (this.selectedCompanies.length > 1) {
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

      if (this.bqMode) {
        await this.writeValidationToBigQuery(baseEntry, tag);
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
    document.getElementById('subtopicEdit').value = '';

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
        cols: this.cols,
        bqMode: this.bqMode,
        bqConfig: this.bqConfig
      });
    } catch (error) {
      console.error('Error saving state:', error);
      // QUOTA_BYTES_PER_ITEM or QUOTA_BYTES exceeded — article_text columns can be large
      if (error.message && (error.message.includes('QUOTA') || error.message.includes('quota'))) {
        this.showStatus('processingStatus', '⚠️ Storage full — download CSV now to avoid losing progress, then reload', 'warning');
      } else {
        this.showStatus('processingStatus', `⚠️ Could not save progress: ${error.message}`, 'warning');
      }
    }
  }

  async loadState() {
    try {
      const result = await chrome.storage.local.get([
        'csvData', 'topicData', 'topicHierarchy', 'variationsMap', 'currentIndex', 'cols',
        'bqMode', 'bqConfig'
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

      if (result.bqConfig) {
        this.bqConfig = { ...this.bqConfig, ...result.bqConfig };
        this.bqConfig.projectId = 'sri-benchmarking-databases';
        this.bqConfig.clientId = '434903546449-umed7pni0pcl0lfoevgbouedqq12hrmc.apps.googleusercontent.com';
      }
      if (result.bqMode !== undefined) {
        this.bqMode = result.bqMode;
      }
      // Restore BQ mode UI
      this.setMode(this.bqMode ? 'bq' : 'csv');
      if (this.bqConfig.projectId) document.getElementById('bqProjectId').value = this.bqConfig.projectId;
      if (this.bqConfig.datasetId) document.getElementById('bqDatasetId').value = this.bqConfig.datasetId;
      if (this.bqConfig.clientId) document.getElementById('bqClientId').value = this.bqConfig.clientId;
    } catch (error) {
      console.error('Error loading state:', error);
    }
  }

  // ─── BigQuery mode ───────────────────────────────────────────────────────

  setMode(mode) {
    this.bqMode = (mode === 'bq');
    document.getElementById('csvSection').style.display = this.bqMode ? 'none' : 'block';
    document.getElementById('bqSection').style.display = this.bqMode ? 'block' : 'none';
    document.getElementById('csvModeBtn').classList.toggle('mode-btn-active', !this.bqMode);
    document.getElementById('bqModeBtn').classList.toggle('mode-btn-active', this.bqMode);
  }

  bqSaveConfig() {
    const projectId = document.getElementById('bqProjectId').value.trim();
    const datasetId = document.getElementById('bqDatasetId').value.trim();
    const clientId = document.getElementById('bqClientId').value.trim();
    if (!projectId || !clientId) {
      this.showStatus('bqConfigStatus', '⚠️ Project ID and Client ID are required', 'warning');
      return;
    }
    this.bqConfig = { projectId, datasetId: datasetId || 'coverage_collector', clientId };
    this.saveState();
    this.showStatus('bqConfigStatus', '✅ Config saved', 'success');
    document.getElementById('bqConnect').disabled = false;
  }

  async bqConnect() {
    if (!this.bqConfig.clientId) {
      this.showStatus('bqAuthStatus', '⚠️ Save config first', 'warning');
      return;
    }
    this.log('OAuth: starting sign-in flow');
    this.showStatus('bqAuthStatus', '🔑 Opening Google sign-in…', 'info');
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/bigquery');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(this.bqConfig.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}`;
    try {
      const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
      const hash = new URL(responseUrl).hash.substring(1);
      const params = Object.fromEntries(hash.split('&').map(p => p.split('=')));
      if (!params.access_token) throw new Error('No access_token in response');
      this.bqToken = params.access_token;
      this.bqTokenExpiry = Date.now() + (parseInt(params.expires_in, 10) - 60) * 1000;
      this.log(`OAuth: signed in, token expires in ${params.expires_in}s`);
      document.getElementById('bqLoad').disabled = false;
      this.showStatus('bqAuthStatus', '✅ Signed in', 'success');
    } catch (err) {
      this.log(`OAuth error: ${err.message}`);
      this.showStatus('bqAuthStatus', `❌ Sign-in failed: ${err.message}`, 'warning');
    }
  }

  async bqGetToken() {
    if (this.bqToken && this.bqTokenExpiry && Date.now() < this.bqTokenExpiry) {
      return this.bqToken;
    }
    this.log('OAuth: token missing or expired, re-authenticating');
    await this.bqConnect();
    return this.bqToken;
  }

  async bqRequest(endpoint, method = 'GET', body = null) {
    const token = await this.bqGetToken();
    if (!token) throw new Error('Not authenticated');
    this.log(`BQ ${method} ${endpoint}`);
    const opts = {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`https://bigquery.googleapis.com/bigquery/v2/${endpoint}`, opts);
    if (method === 'DELETE' && resp.status === 204) {
      this.log(`BQ ${method} ${endpoint} → 204 No Content`);
      return null;
    }
    const json = await resp.json();
    if (!resp.ok) {
      const msg = json.error?.message || resp.statusText;
      this.log(`BQ error ${resp.status}: ${msg}`);
      throw new Error(`BQ API ${resp.status}: ${msg}`);
    }
    return json;
  }

  async bqRunQuery(sql, queryParameters = null) {
    const { projectId } = this.bqConfig;
    this.log(`BQ query:\n${sql.trim()}`);
    // Start async job
    const queryConfig = { query: sql, useLegacySql: false };
    if (queryParameters) queryConfig.queryParameters = queryParameters;
    const job = await this.bqRequest(`projects/${projectId}/jobs`, 'POST', {
      configuration: { query: queryConfig }
    });
    const jobId = job.jobReference.jobId;
    // Poll until done
    let status;
    do {
      await new Promise(r => setTimeout(r, 800));
      status = await this.bqRequest(`projects/${projectId}/jobs/${jobId}`);
    } while (status.status.state !== 'DONE');
    if (status.status.errorResult) {
      this.log(`BQ query failed: ${status.status.errorResult.message}`);
      throw new Error(status.status.errorResult.message);
    }
    this.log(`BQ query job ${jobId} complete`);
    // Paginate results
    const rows = [];
    const schema = status.statistics.query?.schema || status.schema;
    let pageToken = null;
    do {
      const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
      const page = await this.bqRequest(`projects/${projectId}/queries/${jobId}?maxResults=1000${pageParam}`);
      if (page.rows) {
        const fields = (page.schema || schema)?.fields || [];
        for (const row of page.rows) {
          const obj = {};
          fields.forEach((f, i) => { obj[f.name] = row.f[i].v; });
          rows.push(obj);
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);
    this.log(`BQ query returned ${rows.length} rows`);
    return rows;
  }

  async bqStreamInsert(table, rows) {
    const { projectId, datasetId } = this.bqConfig;
    const endpoint = `projects/${projectId}/datasets/${datasetId}/tables/${table}/insertAll`;
    this.log(`BQ insert → ${table} (${rows.length} row(s))`);
    const body = {
      skipInvalidRows: false,
      ignoreUnknownValues: true,
      rows: rows.map((r, i) => ({ insertId: `row-${Date.now()}-${i}`, json: r }))
    };
    const result = await this.bqRequest(endpoint, 'POST', body);
    if (result.insertErrors && result.insertErrors.length > 0) {
      const msgs = result.insertErrors.map(e => e.errors.map(x => x.message).join('; ')).join(' | ');
      this.log(`BQ insert errors: ${msgs}`);
      throw new Error(`BQ insert errors: ${msgs}`);
    }
    this.log(`BQ insert succeeded`);
    return result;
  }

  async bqEnsureValidatedTable() {
    const { projectId, datasetId } = this.bqConfig;
    // Check if table already exists with the correct schema
    try {
      const existing = await this.bqRequest(`projects/${projectId}/datasets/${datasetId}/tables/validated_results`);
      const cols = (existing.schema?.fields || []).map(f => f.name).join(', ');
      this.log(`validated_results exists with columns: ${cols}`);
      return; // exists — leave it alone
    } catch (err) {
      if (!err.message.includes('404')) throw err;
    }
    this.log('validated_results not found — creating from processed_serp_results schema');
    // Create from source table schema + validation columns
    const sourceTable = await this.bqRequest(`projects/${projectId}/datasets/${datasetId}/tables/processed_serp_results`);
    const fields = [
      ...(sourceTable.schema?.fields || []),
      { name: 'decision', type: 'STRING' },
      { name: 'validated_at', type: 'TIMESTAMP' }
    ];
    this.log(`Creating validated_results with ${fields.length} fields: ${fields.map(f => f.name).join(', ')}`);
    await this.bqRequest(`projects/${projectId}/datasets/${datasetId}/tables`, 'POST', {
      tableReference: { projectId, datasetId, tableId: 'validated_results' },
      schema: { fields }
    });
    this.log('validated_results created');
  }

  async bqLoadData() {
    if (!this.bqConfig.projectId || !this.bqConfig.datasetId) {
      this.showStatus('bqStatus', '⚠️ Save config first', 'warning');
      return;
    }
    this.log(`bqLoadData: project=${this.bqConfig.projectId} dataset=${this.bqConfig.datasetId}`);
    this.showStatus('bqStatus', '⏳ Loading from BigQuery…', 'info');
    try {
      await this.bqEnsureValidatedTable();
      const { projectId, datasetId } = this.bqConfig;
      const sql = `
        SELECT p.*
        FROM \`${projectId}.${datasetId}.processed_serp_results\` p
        LEFT JOIN \`${projectId}.${datasetId}.validated_results\` v
          ON p.company = v.company AND p.link = v.link
        WHERE v.link IS NULL
        ORDER BY p.company
      `;
      const rawRows = await this.bqRunQuery(sql);
      this.log(`LEFT JOIN query returned ${rawRows.length} unreviewed row(s)`);
      if (rawRows.length === 0) {
        this.showStatus('bqStatus', '✅ No unreviewed records found', 'success');
        return;
      }
      // Normalize rows to match extension's expected column names
      this.csvData = rawRows.map(r => {
        const row = { ...r };
        // Normalize sentiment to title case
        if (row.sentiment) {
          row.sentiment = row.sentiment.charAt(0).toUpperCase() + row.sentiment.slice(1).toLowerCase();
        }
        // Normalize timestamp dates to YYYY-MM-DD
        if (row.date && row.date.length > 10) {
          row.date = row.date.substring(0, 10);
        }
        return row;
      });
      this.currentIndex = 0;
      // Map BQ column names to the extension's internal cols object
      const keys = Object.keys(this.csvData[0]);
      this.cols.company = keys.find(k => k === 'company') || keys.find(k => k === 'corporation') || 'company';
      this.cols.sentiment = keys.find(k => k === 'sentiment') || keys.find(k => k === 'Sentiment') || 'sentiment';
      this.cols.topic = keys.find(k => k === 'topic') || keys.find(k => k === 'Topic') || 'topic';
      this.cols.subtopic = keys.find(k => k === 'sub_topic') || keys.find(k => k === 'Sub-topic') || keys.find(k => k === 'subtopic') || 'sub_topic';
      this.cols.date = keys.find(k => k === 'date') || keys.find(k => k === 'Date') || 'date';
      this.cols.content = keys.find(k => /^(content|full[_ ]?text|article[_ ]?text|body[_ ]?text|text)$/i.test(k)) || null;
      this.cols.keepDelete = 'KEEP/DELETE';
      // Ensure all rows have the KEEP/DELETE field
      this.csvData.forEach(row => { row['KEEP/DELETE'] = row['KEEP/DELETE'] || ''; });
      await this.saveState();
      this.showStatus('bqStatus', `✅ Loaded ${this.csvData.length} unreviewed records`, 'success');
      document.getElementById('startProcessing').disabled = false;
      document.getElementById('downloadCsv').disabled = false;
      this.updateProgressInfo();
    } catch (err) {
      console.error('BQ load error:', err);
      this.showStatus('bqStatus', `❌ ${err.message}`, 'warning');
    }
  }

  async writeValidationToBigQuery(entry, decision) {
    try {
      const { projectId, datasetId } = this.bqConfig;
      const { [this.cols.keepDelete]: _kd, ...sourceFields } = entry;
      const row = { ...sourceFields, decision, validated_at: new Date().toISOString() };

      const cols = Object.keys(row);
      // BQ param names must be [a-zA-Z][a-zA-Z0-9_]* — prefix with p_ to be safe
      const pname = c => `p_${c.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const colList = cols.map(c => `\`${c}\``).join(', ');
      const paramList = cols.map(c => `@${pname(c)}`).join(', ');
      const sql = `INSERT INTO \`${projectId}.${datasetId}.validated_results\` (${colList}) VALUES (${paramList})`;

      const queryParameters = cols.map(c => ({
        name: pname(c),
        parameterType: { type: c === 'validated_at' ? 'TIMESTAMP' : 'STRING' },
        parameterValue: { value: (row[c] === null || row[c] === undefined) ? null : String(row[c]) }
      }));

      this.log(`BQ DML insert: ${entry[this.cols.company]} / ${entry.link}`);
      await this.bqRunQuery(sql, queryParameters);
      this.log('BQ DML insert succeeded');
    } catch (err) {
      this.log(`BQ write error: ${err.message}`);
      const el = document.getElementById('processingStatus');
      if (el) { el.textContent = `⚠️ BQ write failed: ${err.message}`; el.className = 'status-warning'; }
    }
  }

  log(message) {
    const ts = new Date().toISOString().substring(11, 23);
    const panel = document.getElementById('debugLog');
    if (panel) {
      panel.textContent += `[${ts}] ${message}\n`;
      panel.scrollTop = panel.scrollHeight;
    }
    console.log(`[${ts}] ${message}`);
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