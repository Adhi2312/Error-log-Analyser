# 🚀 Error Log Analyzer

> AI-powered log analysis platform that extracts, redacts, and analyzes software errors from log files using a modern full-stack architecture.

![React](https://img.shields.io/badge/React-19-blue)
![Node](https://img.shields.io/badge/Node.js-Express-green)
![Postgres](https://img.shields.io/badge/PostgreSQL-Database-blue)
![Redis](https://img.shields.io/badge/Redis-BullMQ-red)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)

---

## 📖 Overview

Error Log Analyzer is a full-stack application that helps developers quickly inspect log files by:

- Uploading log/text files
- Detecting error entries
- Redacting sensitive information
- Generating structured AI-assisted analysis
- Supporting asynchronous processing using BullMQ and Redis

---

## ✨ Features

- 📂 Log file upload and error preview
- 🔍 Error extraction from logs
- 🔒 Sensitive data redaction
- 🤖 AI-assisted root cause analysis
- ⚡ Background processing using BullMQ
- 💾 PostgreSQL persistence
- 🔄 Automatic versioned database migrations
- 🎨 Responsive React UI

---

## 🏗️ Architecture

```text
                +----------------------+
                |      React UI        |
                +----------+-----------+
                           |
                     Axios API Calls
                           |
                +----------v-----------+
                |    Express Server    |
                +----------+-----------+
                           |
        +------------------+------------------+
        |                  |                  |
        |                  |                  |
     Parser           Redactor          Upload Service
        |                  |
        +---------+--------+
                  |
             BullMQ Queue
                  |
             Redis Worker
                  |
           AI Analysis Engine
                  |
             PostgreSQL DB
```

---

## 🛠️ Tech Stack

### Frontend

- React
- Tailwind CSS
- Axios
- React Icons

### Backend

- Node.js
- Express.js
- Multer

### Database

- PostgreSQL

### Queue

- Redis
- BullMQ

### AI

- NVIDIA NIM hosted inference API
- Configurable NVIDIA model and endpoint

### DevOps

- Docker
- Docker Compose

---

## 📁 Project Structure

```text
ERROR-LOG-ANALYZER/
│
├── backend/
│   ├── src/
│   │   ├── db/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── db.js
│   │   ├── queue.js
│   │   ├── server.js
│   │   └── worker.js
│   │
│   ├── uploads/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   └── package-lock.json
│
├── documents/
│
├── Frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── package-lock.json
│
├── .gitignore
└── README.md
```

---

## ⚙️ How It Works

1. Upload a log file.
2. Backend parses the log.
3. Errors are extracted.
4. Sensitive information is redacted.
5. Preview is displayed.
6. Every detected error is queued for background processing.
7. Workers analyze errors independently.
8. Batch progress and individual results are displayed.
9. Analysis is stored for future reference.

---

## 🚀 Getting Started

### Clone

```bash
git clone https://github.com/Adhi2312/Error-log-Analyser.git
cd ERROR-LOG-ANALYZER
```

### Backend

```bash
cd Backend
npm install
npm run migrate
npm start
```

Copy `backend/.env.example` to `backend/.env` and set `NVIDIA_API_KEY` before
starting the worker. The default hosted model is `openai/gpt-oss-20b`.

### Frontend

```bash
cd Frontend
npm install
npm start
```

---

## 🐳 Docker

```bash
docker compose -f backend/docker-compose.yml up --build
```

The API and worker run all pending migrations before they start. Applied files are
recorded in the `schema_migrations` table and will not run again. To apply migrations
without starting the application:

```bash
docker compose -f backend/docker-compose.yml run --rm backend npm run migrate
```

Create new migrations in `backend/src/db/migrations` using the next three-digit
prefix, for example `003_add_upload_owner.sql`. Never edit a migration after it has
been applied; add a new migration instead.





---

## 👥 Contributors



###  [Adhilingavignesh K](https://github.com/Adhi2312)
###  [Prithiv Raj K](https://github.com/Prithivraj22)



---

