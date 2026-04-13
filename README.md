# CSV Link Reviewer Extension - User Guide

## 🎯 What This Extension Does

The CSV Link Reviewer Extension automates the tedious process of reviewing websites linked in CSV / Excel datasets. Instead of manually opening each link, copying company names to search, and tracking progress in spreadsheets, this extension:

- **Loads your CSV or XLSX** and automatically navigates through each linked webpage
- **Highlights company mentions** on each page so you can quickly find relevant content
- **Lets you tag each page** with sentiment, topics, date, company, and a KEEP / DELETE decision
- **Extracts clean article text** from the current page into your dataset
- **Tracks decisions** and lets you resume exactly where you left off
- **Exports an enhanced file** with all your annotations

**Perfect for:** Corporate communications monitoring, news sentiment analysis, research data curation, competitive intelligence.

---

## 🚀 Quick Start

### Step 1: Install Extension
1. Download / clone the extension files to a folder
2. Open Chrome → `chrome://extensions/` → enable **Developer mode**
3. Click **Load unpacked** → select the extension folder
4. Pin the CSV Link Reviewer icon to your toolbar

### Step 2: Prepare Your Data File
The extension accepts **`.csv`, `.xlsx`, and `.xls`** files. Two columns are required:

```csv
company,link
Apple Inc,https://example.com/apple-news
Microsoft,https://example.com/microsoft-article
Johnson & Johnson,https://example.com/jnj-report
```

- The company column can be named **`company`** or **`corporation`**
- The `link` column must contain full URLs (`http://` or `https://`)
- Any additional columns in your file are preserved on export

### Step 3: Start Reviewing
1. **Click the extension icon** → the sidebar opens
2. **Upload your data file** → wait for the "✅ Loaded X entries" message
3. **Click "Start Processing"** → the first webpage loads automatically
4. **Review the highlighted matches** → company names are highlighted in yellow
5. **Make your selections:**
   - **Sentiment** — 👍 Positive, 😐 Neutral, or 👎 Negative
   - **Topic / Sub-topic** — if you uploaded a topics file
   - **Date** — optional date picker
   - **Company** — if a row has no corporation, checkboxes let you pick one or more
   - **Decision** — ✓ KEEP or ✗ DELETE
6. **Advance automatically** whenever you tag KEEP or DELETE
7. **Download results** when you're done

---

## 📄 File Formats & Setup

### Required: Main Data File (CSV or Excel)
```csv
company,link
Apple Inc,https://example.com/apple-news
Microsoft Corporation,https://example.com/microsoft-report
```
- Must contain `company` (or `corporation`) and `link` columns
- If your file already has `Sentiment`, `Topic`, `Sub-topic`, `Date`, `KEEP/DELETE`, or article-text columns, the extension will reuse them instead of creating new ones
- `.xlsx` files with multiple sheets will prompt you to pick a sheet

### Optional: Company Variations File
Use this when companies have multiple names or abbreviations:
```csv
Johnson & Johnson,JNJ
Johnson & Johnson,J&J
Apple Inc,Apple
Apple Inc,AAPL
```
- Helps find more mentions on each page
- First column = the exact name from your main file
- Second column = an alternative name to search for
- Uses **smart regex matching** for partial words and variations

### Optional: Custom Topics File
Define your own categorization system:
```csv
Topic,Sub
Marketing,Social Media
Marketing,Email Campaign
Finance,Budget Planning
Technology,Product Launch
```
- Adds **Topic / Sub-topic** dropdowns during review
- Headers must be exactly `Topic` and `Sub`

---

## 🖥️ Interface Overview

The sidebar has four main sections:

### 1. Upload Files
- **Data file** (required) — CSV / XLSX
- **Company variations** (optional)
- **Topics / categories** (optional)
- Each shows a status message after upload

### 2. Start Processing
- **Start Processing** button (enabled after upload)
- On restart it **resumes** from where you left off (see below)
- Progress indicator showing current entry, count, and percent complete

### 3. Review Current Entry
- **Entry details** — company name, link, current status
- **Search matches** — how many mentions were found on the page
- **Navigate matches** — ← / → jump between highlighted mentions
- **Company selection** — when the row has no corporation, check one or more companies detected on the page; multiple selections create duplicate rows automatically
- **Sentiment** — 👍 Positive, 😐 Neutral, 👎 Negative
- **Topic / Sub-topic** dropdowns — when a topics file is loaded
- **Date** picker
- **📰 Extract Article Text** — pulls clean body text from the current page into a `content` / article-text column
- **Navigation controls**
  - **← Previous Entry** — go back to change a previous decision
  - **Next Entry →** — skip forward without tagging
  - **✓ KEEP / ✗ DELETE** — save decision and auto-advance

### 4. Download & Reset
- **Download CSV** — export with every annotation
- **Clear All Data** — reset everything to start fresh

---

## 🔁 Resume Behavior

When you re-open the extension (or click **Start Processing** again after a break), the extension **jumps to the latest record without a KEEP / DELETE label**.

That means:
- Rows you already tagged KEEP or DELETE are treated as "done" — even if you skipped sentiment, topic, or date on them
- Rows without a KEEP / DELETE decision are still considered pending
- The progress counter (`X/Y entries processed`) counts rows that have a KEEP / DELETE label

In practice: if you batch-delete a run of irrelevant articles without adding other labels, resume will still take you forward to the next undecided row rather than sending you back to those partially-labeled rows.

---

## ⌨️ Keyboard Shortcuts

### Navigation
- **← →** — jump between highlighted matches on the current page
- **Ctrl+P** — previous entry
- **Ctrl+N** — next entry

### Labeling
- **Ctrl+1** — Positive sentiment
- **Ctrl+2** — Neutral sentiment
- **Ctrl+3** — Negative sentiment
- **Ctrl+K** — tag as KEEP (auto-advances)
- **Ctrl+D** — tag as DELETE (auto-advances)

**Pro tip:** Sentiment → Topics (if used) → KEEP/DELETE is the fastest workflow.

---

## 🔧 How It Works Behind the Scenes

### Smart, fast search
- **Regex-based matching** finds company variations even when they aren't exact
- **Efficient DOM traversal** handles large pages without freezing the browser
- **Race-condition protection** locks buttons while the page is loading / searching to prevent double-clicks

### Background preloading
- **Preloads the next 2 pages** in hidden background tabs
- **Instant switching** when you tag KEEP / DELETE
- **Auto-cleans** unused tabs to keep the browser tidy

### Multi-company rows
- If a row has no corporation, checkboxes let you select one or more companies found on the page
- Selecting multiple companies and tagging KEEP / DELETE creates **duplicate rows** — one per company — all inheriting the current sentiment, topic, date, and decision

### Article text extraction
- The **📰 Extract Article Text** button pulls clean body text from the current page into your dataset
- If your file already has a content / article-text column, the extracted text is saved there; otherwise a new `content` column is used

### Data management
- **Auto-saves** every selection immediately
- **Remembers progress** if you close and reopen the browser
- **Exports** an enhanced file with KEEP/DELETE, Sentiment, Topic, Sub-topic, Date, and (if used) article text

---

## 🛠️ Troubleshooting

### "Buttons are grayed out / disabled"
- Normal — the extension locks buttons while it searches the page or loads the next entry. Wait for the "Ready" indicator.

### "File is empty or invalid"
- Check the file extension (`.csv`, `.xlsx`, or `.xls`)
- Verify column headers include `company` (or `corporation`) and `link`
- Remove special characters from headers

### "No matches found on this page"
- The company name may be spelled differently on the page
- Try adding entries to a variations file
- Confirm the page finished loading (some sites are slow)

### Sub-topics not showing
- Headers must be exactly `Topic` and `Sub`
- Check formatting (commas, no extra spaces)

### Extension not working
- Open `chrome://extensions/` and look for error messages
- Make sure Developer Mode is enabled
- Try disabling and re-enabling the extension

### Performance with large datasets (500+ entries)
- Process in smaller batches
- Download intermediate results periodically
- Consider splitting the file

**Debug help:** Press F12 → Console tab to see detailed logs.

---

## 🔄 Data Export

Your exported file includes every original column plus:
- **KEEP/DELETE** — your content curation decisions
- **Sentiment** — Positive / Neutral / Negative
- **Topic** — main category (when a topics file is loaded)
- **Sub-topic** — subcategory (when a topics file is loaded)
- **Date** — the date you selected
- **Article text / content** — populated when you use the article extractor

Ready for import into analysis tools, databases, or team review.
