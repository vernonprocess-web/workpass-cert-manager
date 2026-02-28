# WorkPass & Cert Manager

WorkPass & Cert Manager is a specialized web application designed to help businesses manage their workers' critical documents, work permits, and safety certifications. It centralizes worker data, automating extraction from raw document scans to ensure compliance and easy reporting.

## Core Purpose

Managing a large workforce often entails handling a maze of physical IDs, certification cards, and work permits with strict expiration dates. This application serves as a single source of truth for all worker credentials:
- **Centralized Data:** Manually or automatically build a digital database of your workers.
- **Automated Ingestion (OCR):** Upload physical scans of Work Permits and Certifications to instantly extract details (FIN, DOB, expiry dates, serial numbers).
- **Compliance Tracking:** Easily filter by upcoming expirations and instantly export full worker profiles (along with embedded original document scans) directly to Excel for record-keeping and audits.

## Tech Stack

The application is built for high speed, low cost, and maximal portability using modern serverless infrastructure:

- **Frontend:** Pure Vanilla HTML, CSS, and JavaScript. No bulky frameworks, ensuring lightning-fast load times. Hosted on **Cloudflare Pages**.
- **Backend / API:** Built with **Hono** running on **Cloudflare Workers**. Provides a blazing-fast edge API.
- **Database:** **Cloudflare D1** (Serverless SQLite) for relational data storage (Workers, Certifications, Documents).
- **Storage:** **Cloudflare R2** for secure object storage of all raw uploaded images and PDF scans.
- **AI / OCR Integration:** **Google Gemini API** (Gemini 1.5 Flash/Pro) tightly integrated into the backend to parse raw images and structured data from unstructured Work Permits and course certificates.
- **Exporting:** Uses **ExcelJS** to compress and physically embed scanned arrays into downloadable structured `.xlsx` workbooks.

## Main User Flows

### 1. Dashboard & Worker Database
The system opens to a dashboard aggregating total active workers and upcoming expirations. The `Workers` tab allows you to browse, search, and paginate through your entire workforce database, acting as a high-level view of all personnel.

### 2. Upload & OCR (Data Ingestion)
To prevent manual data entry fatigue, users navigate to the `Upload & OCR` screen:
1. Photos of Work Permits or course certificates are uploaded.
2. The images are securely saved to an internal Cloudflare R2 bucket.
3. The R2 image stream is passed to the Gemini AI API, acting as an advanced Vision OCR engine.
4. Gemini extracts structured text (Name, FIN, Issue Date) and attempts to pair the credential to an existing worker in the D1 database, or flags it as an entirely new record for manual verification.

### 3. Worker Profile
Clicking on any individual worker opens their dedicated **Worker Profile**:
- **Worker Details:** A 3-column layout displaying extracted IC fields alongside direct previews of their "Work Permit Front" and "Work Permit Back" scanned images.
- **Certifications Log:** A dedicated, sortable table tracking every credential associated with that worker, including Provider names, issuance dates, and highlighted expiry statuses.
- **Export Engine:** A powerful "Export Profile" button compiles all textual data *and compresses every uploaded image*, programmatically stamping them into a multi-sheet `.xlsx` offline Excel profile.

## Deployment & CI/CD
The source code is inherently connected to GitHub Actions `.github/workflows/deploy.yml`. Merging changes to the `main` branch automatically triggers Wrangler to securely apply any required D1 database schema migrations, update the Worker edge API, and roll out the static frontend securely.
