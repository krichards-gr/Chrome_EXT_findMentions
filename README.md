# CSV Link Reviewer Extension - User Guide

## 🎯 What This Extension Does

The CSV Link Reviewer Extension automates the tedious process of reviewing websites linked in CSV datasets. Instead of manually opening each link, copying company names to search, and tracking your progress in spreadsheets, this extension:

- **Loads your CSV** and automatically navigates through each linked webpage
- **Highlights company mentions** on each page so you can quickly find relevant content  
- **Lets you tag each page** with sentiment, topics, date, and "Keep/Delete" status
- **Tracks decisions** for content curation
- **Exports enhanced CSV** with all your annotations

**Perfect for:** Corporate communications monitoring, news sentiment analysis, research data curation, competitive intelligence.

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Install Extension
1. Download extension files to a folder
2. Open Chrome → `chrome://extensions/` → Enable "Developer mode"  
3. Click "Load unpacked" → Select your extension folder
4. Look for the CSV Link Reviewer icon in your toolbar

### Step 2: Prepare Your CSV
Your CSV needs these two columns (exact names):
```csv
corporation,link
Apple Inc,https://example.com/apple-news
Microsoft,https://example.com/microsoft-article
Johnson & Johnson,https://example.com/jnj-report
```

### Step 3: Start Reviewing
1. **Click extension icon** → Sidebar opens
2. **Upload your CSV** → Wait for "✅ Loaded X entries" message
3. **Click "Start Processing"** → First webpage loads automatically
4. **Review the highlighted content** → Company name appears in yellow
5. **Make your selections:**
   - **Sentiment**: Click 👍 Positive, 😐 Neutral, or 👎 Negative
   - **Date**: Select the article date (optional)
   - **Decision**: Click ✓ KEEP or ✗ DELETE
6. **Move to next page** → Automatically happens when you tag KEEP/DELETE
7. **Download results** when complete

**That's it!** The extension handles navigation, search, highlighting, and progress tracking automatically.

---

## 📄 File Formats & Setup

### Required: Main CSV File
```csv
corporation,link
Apple Inc,https://example.com/apple-news
Microsoft Corporation,https://example.com/microsoft-report
```
- Must have `corporation` and `link` columns (case-sensitive)
- Links need `https://` or `http://`

### Optional: Company Variations File  
Use this when companies have multiple names/abbreviations:
```csv
Johnson & Johnson,JNJ
Johnson & Johnson,J&J
Apple Inc,Apple
Apple Inc,AAPL
```
- Helps find more mentions on each webpage
- First column = exact name from main CSV
- Second column = alternative name to search for
- **Now supports smart regex matching** for partial words and variations

### Optional: Custom Topics File
Create your own categorization system:
```csv
Topic,Sub
Marketing,Social Media
Marketing,Email Campaign
Finance,Budget Planning
Technology,Product Launch
```
- Adds dropdown menus for systematic categorization
- Headers must be exactly `Topic` and `Sub`

---

## 🖥️ Interface Overview

The extension sidebar has 4 main sections:

### 1. Upload Files
- **CSV Data File** (required): Your main dataset
- **Company Variations** (optional): Alternative company names  
- **Topics/Categories** (optional): Custom taxonomy
- Each shows status messages after upload

### 2. Start Processing  
- **Start Processing** button (enabled after CSV upload)
- Progress indicator showing current entry and % complete

### 3. Review Current Entry
- **Entry details**: Corporation name, link, current status
- **Search matches**: Shows how many company mentions found on page
- **Navigate matches**: ← → buttons jump between highlighted mentions
- **Sentiment**: 👍 Positive, 😐 Neutral, 👎 Negative  
- **Topic dropdowns**: Appear if you uploaded topics file
- **Date**: Date picker for article date
- **Navigation Controls**:
    - **Previous Entry**: Go back to change a decision on the previous item
    - **KEEP / DELETE**: Saves decision and loads next page

### 4. Download & Reset
- **Download CSV**: Export with all your annotations
- **Clear All Data**: Reset everything to start fresh

---

## ⌨️ Keyboard Shortcuts (Much Faster!)

### Navigation
- **← →** arrows: Jump between search matches on current page

### Labeling  
- **Ctrl+1**: Positive sentiment
- **Ctrl+2**: Neutral sentiment  
- **Ctrl+3**: Negative sentiment
- **Ctrl+K**: Tag as KEEP (moves to next page)
- **Ctrl+D**: Tag as DELETE (moves to next page)
- **Ctrl+P**: Go to Previous Entry

**Pro tip:** Use shortcuts in this order: Sentiment → Topics (if needed) → KEEP/DELETE for fastest workflow.

---

## 🔧 How It Works Behind the Scenes

### Stable & Fast Search
- **Smart Regex Search**: Uses advanced pattern matching to find company variations even if they aren't exact matches.
- **Performance Optimized**: Uses efficient DOM traversal to handle large pages without freezing your browser.
- **Race Condition Protection**: Buttons automatically lock while pages are loading or processing to prevent double-clicks and errors.

### Background Preloading  
- **Loads next 2 pages** in hidden background tabs while you review current page
- **Instant switching** when you tag KEEP/DELETE
- **Auto-cleanup** of unused tabs to keep browser tidy

### Data Management
- **Auto-saves** every selection immediately  
- **Remembers progress** if you close and reopen browser
- **Exports enhanced CSV** with new columns: KEEP/DELETE, Sentiment, Topic, Sub-topic, Date

---

## 🛠️ Troubleshooting

### "Buttons are grayed out/disabled"
- **This is normal!** The extension locks the buttons while it searches the page or loads the next entry. This prevents errors. Just wait a second for the "Ready" indicator.

### "CSV file is empty or invalid"
- Check file has `.csv` extension
- Verify column headers are exactly `corporation` and `link`
- Remove any special characters from headers

### "No matches found on this page"  
- Company name might be spelled differently on webpage
- Try creating a variations file with alternative names/abbreviations
- Check if page loaded completely (some sites are slow)

### Sub-topics not showing
- Ensure headers are exactly `Topic` and `Sub` (case-sensitive)
- Check CSV formatting (proper commas, no extra spaces)

### Extension not working
- Open `chrome://extensions/` and check for error messages
- Ensure Developer Mode is enabled
- Try disabling and re-enabling the extension

### Performance with large datasets (500+ entries)
- Process in smaller batches
- Download intermediate results periodically
- Consider breaking large CSV into multiple files

**Debug help:** Press F12 → Console tab to see detailed error messages and activity logs.

---

## 🔄 Data Export

Your final CSV will include all original columns plus:
- **KEEP/DELETE**: Your content curation decisions
- **Sentiment**: Positive/Neutral/Negative labels  
- **Topic**: Main category (if topics file used)
- **Sub-topic**: Subcategory (if topics file used)
- **Date**: The date you selected

Perfect for importing into analysis tools, databases, or sharing with your team.